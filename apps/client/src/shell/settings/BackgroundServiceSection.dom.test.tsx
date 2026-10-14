import { afterEach, describe, expect, test } from 'bun:test';
import type { BackgroundServiceState, DesktopBridge, MachineMode } from '@/desktop/bridge';
import { mount, until, type Mounted } from '../../../testing/dom';
import { machineBridge } from '../../../testing/machine-bridge';
import { BackgroundServiceSection } from './BackgroundServiceSection';

const scope = globalThis as unknown as { window: { ruimteDesktop?: DesktopBridge } };

const STATE: BackgroundServiceState = { support: 'supported', keepRunning: true, owner: 'service', failure: null, linger: null };

let page: Mounted;

function everything(): string {
    return document.body.textContent ?? '';
}

async function open(machine: DesktopBridge['machine'] | MachineMode): Promise<void> {
    scope.window.ruimteDesktop = {
        platform: 'darwin',
        pickFolder: async () => null,
        openExternal: async () => undefined,
        openGuestDevTools: () => undefined,
        isFullscreen: async () => false,
        onFullscreen: () => () => undefined,
        backgroundService: {
            state: async () => STATE,
            onState: () => () => undefined,
            setKeepRunning: async () => STATE,
            enableLinger: async () => STATE,
            stopMachine: () => undefined
        },
        ...(machine === undefined ? {} : { machine: typeof machine === 'string' ? machineBridge(machine) : machine })
    };
    page = mount();
    await page.render(<BackgroundServiceSection />);
    // The section draws once the shell answered with its state.
    await until(() => everything().includes('Stop the machine'));
}

afterEach(async () => {
    await page.unmount();
    delete scope.window.ruimteDesktop;
});

describe('the way back to an app that only connects', () => {
    test('is offered where the shell can switch and this app runs a machine', async () => {
        await open('local');
        expect(everything()).toContain('Stop running a machine here');
    });

    test('is not offered by a shell that cannot switch', async () => {
        await open(undefined);
        expect(everything()).not.toContain('Stop running a machine here');
    });

    test('is not offered where this app runs no machine', async () => {
        await open('none');
        expect(everything()).not.toContain('Stop running a machine here');
    });
});
