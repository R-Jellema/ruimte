import { z } from 'zod';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
    DevicePermissionSchema,
    type DeviceAction,
    type DeviceButton,
    type DeviceInfo,
    type DevicePermission,
    type DeviceSettings,
    type DeviceTextSize,
    type DeviceToggleSetting,
    type DeviceTool
} from '@ruimte/contracts';
import { simulatorTree, type DeviceTree } from './device-tree.ts';
import { DeviceHelperSource, type DeviceHelperLauncher } from './helper-source.ts';
import { DeviceError, KEY_LEFT_COMMAND, KEY_V, PASTE_SETTLE_MS, typeInRuns, type DeviceBackend, type DeviceKeyboard } from './manager.ts';
import { DeviceRecordings } from './recordings.ts';
import type { SimulatorTreeReader } from './simulator-tree.ts';

interface CommandResult {
    exitCode: number;
    stdout: string;
    stderr: string;
}

export type SimctlRunner = (arguments_: string[], stdin?: string) => Promise<CommandResult>;

const SimctlDeviceSchema = z.object({
    udid: z.string().min(1),
    isAvailable: z.boolean(),
    state: z.string(),
    name: z.string().min(1)
});

const SimctlListSchema = z.object({ devices: z.record(z.string(), z.array(SimctlDeviceSchema)) });

function runtimeName(identifier: string): string {
    const value = identifier.replace('com.apple.CoreSimulator.SimRuntime.', '');
    const match = /^(.*)-(\d+)-(\d+)$/.exec(value);
    return match ? `${match[1]} ${match[2]}.${match[3]}` : value;
}

function stateOf(state: string): DeviceInfo['state'] {
    if (state === 'Booted') {
        return 'booted';
    }
    return state === 'Shutdown' ? 'shutdown' : 'transitioning';
}

async function defaultRunner(arguments_: string[], stdin?: string): Promise<CommandResult> {
    // simctl reads and writes the pasteboard in the locale's encoding, and a daemon under launchd has none, which turns ü into √º.
    const utf8 = stdin !== undefined || arguments_[0] === 'pbpaste';
    const process = Bun.spawn(['xcrun', 'simctl', ...arguments_], {
        stdin: stdin === undefined ? 'ignore' : 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
        env: utf8 ? { ...Bun.env, LC_ALL: 'en_US.UTF-8' } : undefined
    });
    const fed = stdin !== undefined && process.stdin ? Promise.all([process.stdin.write(stdin), process.stdin.end()]) : null;
    const [exitCode, stdout, stderr] = await Promise.all([process.exited, new Response(process.stdout).text(), new Response(process.stderr).text(), fed]);
    return { exitCode, stdout, stderr };
}

const IOS_BUTTONS: DeviceButton[] = ['home', 'swipeHome', 'appSwitcher', 'lock', 'siri'];

/* What a simulator announces; each tool joins once its action does something. */
const IOS_SIMULATOR_TOOLS: DeviceTool[] = [
    'openUrl',
    'launchApp',
    'terminateApp',
    'appearance',
    'textSize',
    'liquidGlass',
    'colorFilter',
    'reduceMotion',
    'increaseContrast',
    'reduceTransparency',
    'showBorders',
    'voiceOver',
    'location',
    'clearLocation',
    'permissions',
    'push',
    'capture',
    'record',
    'clipboard'
];

/* A recording a person forgot keeps going no longer than this, so it cannot fill the disk. */
const RECORDING_LIMIT_MS = 10 * 60 * 1000;

const IOS_TEXT_SIZES: Record<DeviceTextSize, string> = {
    small: 'small',
    default: 'large',
    large: 'extra-extra-large',
    'extra-large': 'accessibility-large'
};

const IOS_TOGGLE_OPTIONS: Partial<Record<DeviceToggleSetting, string>> = {
    reduceMotion: 'reduce-motion',
    reduceTransparency: 'reduce-transparency',
    showBorders: 'show-borders',
    voiceOver: 'voiceover'
};

const IOS_PERMISSION_SERVICES: Record<DevicePermission, string> = {
    camera: 'camera',
    microphone: 'microphone',
    photos: 'photos',
    contacts: 'contacts',
    calendar: 'calendar',
    reminders: 'reminders',
    location: 'location',
    motion: 'motion',
    'media-library': 'media-library',
    faceid: 'faceid'
};

function textSizeFromIos(category: string): DeviceTextSize {
    const exact = (Object.entries(IOS_TEXT_SIZES) as Array<[DeviceTextSize, string]>).find(([, value]) => value === category);
    if (exact) {
        return exact[0];
    }
    if (category.startsWith('accessibility')) {
        return 'extra-large';
    }
    if (category.includes('extra')) {
        return 'large';
    }
    return ['extra-small', 'small', 'medium'].includes(category) ? 'small' : 'default';
}

function axHelperPath(): string | null {
    const besideExecutable = join(dirname(process.execPath), 'native', 'serve-sim-ax-settings');
    if (existsSync(besideExecutable)) {
        return besideExecutable;
    }
    try {
        const middleware = Bun.resolveSync('serve-sim/middleware', import.meta.dir);
        const dependency = join(dirname(middleware), 'simax', 'serve-sim-ax-settings');
        return existsSync(dependency) ? dependency : null;
    } catch {
        return null;
    }
}

export class IosSimulatorBackend implements DeviceBackend {
    readonly id = 'simctl';
    readonly platform = 'ios' as const;
    readonly kinds = ['simulator'] as const;
    private readonly run: SimctlRunner;
    private readonly launch: DeviceHelperLauncher | null;
    private readonly sleep: (ms: number) => Promise<void>;
    private readonly treeReader: ((udid: string) => SimulatorTreeReader) | null;
    private readonly readers = new Map<string, SimulatorTreeReader>();
    private readonly recordings: DeviceRecordings;

    constructor(
        run: SimctlRunner = defaultRunner,
        launch: DeviceHelperLauncher | null = null,
        sleep: (ms: number) => Promise<void> = (ms) => Bun.sleep(ms),
        treeReader: ((udid: string) => SimulatorTreeReader) | null = null,
        recordings: DeviceRecordings = new DeviceRecordings()
    ) {
        this.run = run;
        this.launch = launch;
        this.sleep = sleep;
        this.treeReader = treeReader;
        this.recordings = recordings;
    }

    async list(): Promise<DeviceInfo[]> {
        const result = await this.command(['list', 'devices', 'available', '--json']);
        let json: unknown;
        try {
            json = JSON.parse(result.stdout);
        } catch {
            throw new DeviceError('invalid-simctl-output', 'simctl returned a device list Ruimte could not read');
        }
        const parsed = SimctlListSchema.safeParse(json);
        if (!parsed.success) {
            throw new DeviceError('invalid-simctl-output', 'simctl returned a device list Ruimte could not read');
        }
        return Object.entries(parsed.data.devices).flatMap(([runtime, devices]) =>
            devices
                .filter((device) => device.isAvailable && runtime.includes('.iOS-'))
                .map((device) => ({
                    deviceId: device.udid,
                    backendId: this.id,
                    platform: this.platform,
                    kind: 'simulator' as const,
                    name: device.name,
                    runtime: runtimeName(runtime),
                    state: stateOf(device.state),
                    capabilities: {
                        boot: true,
                        shutdown: true,
                        stream: this.launch !== null,
                        input: this.launch !== null,
                        screenshot: true,
                        buttons: IOS_BUTTONS,
                        tools: [...IOS_SIMULATOR_TOOLS],
                        permissions: [...DevicePermissionSchema.options]
                    }
                }))
        );
    }

    async boot(deviceId: string): Promise<DeviceInfo> {
        const current = await this.find(deviceId);
        if (current.state === 'booted') {
            return current;
        }
        await this.command(['boot', deviceId]);
        return this.find(deviceId);
    }

    async shutdown(deviceId: string): Promise<DeviceInfo> {
        const current = await this.find(deviceId);
        if (current.state === 'shutdown') {
            return current;
        }
        this.recordings.drop(deviceId);
        await this.command(['shutdown', deviceId]);
        return this.find(deviceId);
    }

    async detail(deviceId: string): Promise<DeviceSettings> {
        const read = async (arguments_: string[]): Promise<string | undefined> => {
            try {
                return (await this.command(arguments_)).stdout.trim().toLowerCase();
            } catch {
                return undefined;
            }
        };
        const helper = axHelperPath();
        const [appearance, contentSize, contrast, axOutput] = await Promise.all([
            read(['ui', deviceId, 'appearance']),
            read(['ui', deviceId, 'content_size']),
            read(['ui', deviceId, 'increase_contrast']),
            helper ? read(['spawn', deviceId, helper, 'status']) : undefined
        ]);
        let ax: Record<string, string> = {};
        if (axOutput) {
            try {
                ax = z.record(z.string(), z.string()).parse(JSON.parse(axOutput));
            } catch {
                ax = {};
            }
        }
        const onOff = (value: string | undefined): boolean | undefined => (value === 'on' ? true : value === 'off' ? false : undefined);
        const reduceMotion = onOff(ax['reduce-motion']);
        const reduceTransparency = onOff(ax['reduce-transparency']);
        const showBorders = onOff(ax['show-borders']);
        const voiceOver = onOff(ax.voiceover);
        const colorFilter = ['none', 'grayscale', 'red-green', 'green-red', 'blue-yellow'].includes(ax['color-filter'] ?? '')
            ? (ax['color-filter'] as DeviceSettings['colorFilter'])
            : undefined;
        return {
            ...(appearance === 'light' || appearance === 'dark' ? { appearance } : {}),
            ...(contentSize ? { textSize: textSizeFromIos(contentSize) } : {}),
            ...(contrast ? { increaseContrast: contrast === 'enabled' } : {}),
            ...(reduceMotion === undefined ? {} : { reduceMotion }),
            ...(reduceTransparency === undefined ? {} : { reduceTransparency }),
            ...(showBorders === undefined ? {} : { showBorders }),
            ...(voiceOver === undefined ? {} : { voiceOver }),
            ...(ax['liquid-glass'] === 'clear' || ax['liquid-glass'] === 'tinted' ? { liquidGlass: ax['liquid-glass'] } : {}),
            ...(colorFilter === undefined ? {} : { colorFilter }),
            recording: this.recordings.isRecording(deviceId)
        };
    }

    async action(deviceId: string, action: DeviceAction): Promise<DeviceSettings> {
        switch (action.action) {
            case 'setAppearance':
                await this.command(['ui', deviceId, 'appearance', action.value]);
                break;
            case 'setTextSize':
                await this.command(['ui', deviceId, 'content_size', IOS_TEXT_SIZES[action.value]]);
                break;
            case 'setToggle':
                if (action.setting === 'increaseContrast') {
                    await this.command(['ui', deviceId, 'increase_contrast', action.value ? 'enabled' : 'disabled']);
                } else {
                    const option = IOS_TOGGLE_OPTIONS[action.setting];
                    if (!option) {
                        throw new DeviceError('device-action-unavailable', 'This setting is not available for iOS simulators');
                    }
                    await this.ax(deviceId, ['set', option, action.value ? 'on' : 'off']);
                }
                break;
            case 'setLiquidGlass':
                await this.ax(deviceId, ['set', 'liquid-glass', action.value]);
                break;
            case 'setColorFilter':
                await this.ax(deviceId, ['set', 'color-filter', action.value]);
                break;
            case 'setLocation':
                await this.command(['location', deviceId, 'set', `${action.latitude},${action.longitude}`]);
                break;
            case 'clearLocation':
                await this.command(['location', deviceId, 'clear']);
                break;
            case 'setPermission':
                await this.command(['privacy', deviceId, action.decision, IOS_PERMISSION_SERVICES[action.permission], action.appId]);
                break;
            case 'openUrl':
                await this.command(['openurl', deviceId, action.url]);
                break;
            case 'launchApp':
                await this.command(['launch', deviceId, action.appId]);
                break;
            case 'terminateApp':
                await this.command(['terminate', deviceId, action.appId]);
                break;
            case 'sendPush':
                await this.command(['push', deviceId, action.appId, '-'], JSON.stringify({ aps: { alert: action.payload } }));
                break;
            default:
                throw new DeviceError('device-action-unavailable', 'This tool is not available for iOS simulators');
        }
        return this.detail(deviceId);
    }

    createSource(deviceId: string): DeviceHelperSource {
        if (this.launch === null) {
            throw new DeviceError('device-capture-unavailable', 'The native iOS simulator helper is not installed');
        }
        return new DeviceHelperSource(deviceId, this.launch);
    }

    async screenshot(deviceId: string): Promise<Uint8Array> {
        const directory = await mkdtemp(join(tmpdir(), 'ruimte-simulator-shot-'));
        try {
            const path = join(directory, 'screen.png');
            await this.command(['io', deviceId, 'screenshot', '--type=png', path]);
            return new Uint8Array(await readFile(path));
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    }

    async startRecording(deviceId: string, file: string): Promise<void> {
        this.recordings.start(deviceId, file, ['xcrun', 'simctl', 'io', deviceId, 'recordVideo', '--codec=h264', '--force', file], RECORDING_LIMIT_MS);
    }

    /* simctl writes the end of the video only on an interrupt, so a kill would leave an empty file. */
    stopRecording(deviceId: string): Promise<string> {
        return this.recordings.stop(deviceId, (process) => process.interrupt());
    }

    async readClipboard(deviceId: string): Promise<string> {
        return (await this.command(['pbpaste', deviceId])).stdout;
    }

    async writeClipboard(deviceId: string, text: string): Promise<void> {
        await this.command(['pbcopy', deviceId], text);
    }

    /* Read through the device bridge, which stays running for this simulator until `closeTree`. */
    async tree(deviceId: string): Promise<DeviceTree> {
        if (this.treeReader === null) {
            throw new DeviceError('device-tree-unavailable', "The device bridge that reads a simulator's accessibility is not installed on this machine");
        }
        let reader = this.readers.get(deviceId);
        if (!reader) {
            reader = this.treeReader(deviceId);
            this.readers.set(deviceId, reader);
        }
        return simulatorTree(await reader.read());
    }

    closeTree(deviceId: string): void {
        this.readers.get(deviceId)?.close();
        this.readers.delete(deviceId);
    }

    /* Pastes the text in through the simulator's pasteboard, which it replaces. */
    async type(deviceId: string, text: string, keyboard: () => Promise<DeviceKeyboard>): Promise<void> {
        const session = await keyboard();
        await typeInRuns(
            text,
            (usage) => session.keys([usage]),
            async (run) => {
                await this.command(['pbcopy', deviceId], run);
                await session.keys([KEY_LEFT_COMMAND, KEY_V]);
                await this.sleep(PASTE_SETTLE_MS);
            }
        );
    }

    private async ax(deviceId: string, arguments_: string[]): Promise<void> {
        const helper = axHelperPath();
        if (!helper) {
            throw new DeviceError('device-action-unavailable', 'The simulator accessibility helper is not installed');
        }
        await this.command(['spawn', deviceId, helper, ...arguments_]);
    }

    private async command(arguments_: string[], stdin?: string): Promise<CommandResult> {
        let result: CommandResult;
        try {
            result = await this.run(arguments_, stdin);
        } catch {
            throw new DeviceError('simctl-unavailable', 'Xcode and simctl are required for iOS simulators');
        }
        if (result.exitCode !== 0) {
            throw new DeviceError('simctl-failed', result.stderr.trim() || 'simctl failed');
        }
        return result;
    }

    private async find(deviceId: string): Promise<DeviceInfo> {
        const device = (await this.list()).find((candidate) => candidate.deviceId === deviceId);
        if (!device) {
            throw new DeviceError('device-not-found', 'The iOS simulator is no longer available');
        }
        return device;
    }
}
