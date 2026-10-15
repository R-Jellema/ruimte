import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import type { ProjectView } from '@ruimte/contracts';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { answerDevices, FAKE_EMULATOR, FAKE_SIMULATOR, referenceOf, type FakeDevices } from '../../testing/fake-devices';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';

const PHONE: ProjectView = { kind: 'device', id: 'phone', name: FAKE_SIMULATOR.name, device: referenceOf(FAKE_SIMULATOR) };
const PIXEL: ProjectView = { kind: 'device', id: 'pixel', name: FAKE_EMULATOR.name, device: referenceOf(FAKE_EMULATOR) };

let machine: FakeMachine;
let devices: FakeDevices;
let workspace: FakeWorkspace;
let page: Mounted;
let downloads: string[];
let clipboardWrites: unknown[];
let restores: Array<() => void>;

function button(label: string): HTMLElement | null {
    return document.body.querySelector<HTMLElement>(`button[aria-label="${label}"]`);
}

function buttonWithText(text: string): HTMLElement | null {
    return [...document.body.querySelectorAll<HTMLElement>('button')].find((candidate) => candidate.textContent?.trim() === text) ?? null;
}

async function openTools(view: ProjectView): Promise<void> {
    workspace = await openFakeWorkspace(machine, { views: [view] }, { activeViewId: view.id, views: {} });
    page = mount();
    await page.renderApp();
    await until(() => button('Device tools') !== null);
    await clickOn(button('Device tools'));
    await until(() => button('Copy screenshot') !== null);
}

beforeEach(() => {
    machine = new FakeMachine();
    devices = answerDevices(machine);
    downloads = [];
    clipboardWrites = [];
    const click = spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
        downloads.push(this.download);
    });
    const hadClipboardItem = 'ClipboardItem' in globalThis;
    if (!hadClipboardItem) {
        (globalThis as { ClipboardItem?: unknown }).ClipboardItem = class {
            readonly items: Record<string, unknown>;
            constructor(items: Record<string, unknown>) {
                this.items = items;
            }
        };
    }
    const write = spyOn(navigator.clipboard, 'write').mockImplementation(async (items) => {
        clipboardWrites.push(...items);
    });
    restores = [
        () => click.mockRestore(),
        () => write.mockRestore(),
        () => {
            if (!hadClipboardItem) {
                delete (globalThis as { ClipboardItem?: unknown }).ClipboardItem;
            }
        }
    ];
});

afterEach(async () => {
    await page.unmount();
    workspace.close();
    devices.restore();
    for (const restore of restores) {
        restore();
    }
});

describe('capturing a device', () => {
    test('copies and saves a screenshot the machine took for the person', async () => {
        await openTools(PHONE);

        await clickOn(button('Copy screenshot'));
        await until(() => clipboardWrites.length === 1);
        await clickOn(button('Save screenshot'));
        await until(() => downloads.length === 1);

        expect(machine.requests('device.capture')).toEqual([
            { backendId: 'simctl', platform: 'ios', deviceId: FAKE_SIMULATOR.deviceId },
            { backendId: 'simctl', platform: 'ios', deviceId: FAKE_SIMULATOR.deviceId }
        ]);
        expect(downloads[0]).toMatch(/^iPhone 18 Pro \d{4}-\d{2}-\d{2} at \d{2}\.\d{2}\.\d{2}\.png$/);
        expect(devices.read).toContain(`/home/.ruimte/device-captures/${FAKE_SIMULATOR.deviceId}-1.png`);
    });

    test('records the screen, shows it runs over the screen and downloads the video when it stops there', async () => {
        await openTools(PIXEL);

        expect(document.body.textContent).toContain('Android stops a recording by itself after 3 minutes.');
        await clickOn(buttonWithText('Record'));
        await until(() => button('Stop recording') !== null);
        expect(page.host.querySelector('[role="status"]')).not.toBeNull();

        await clickOn(page.host.querySelector('[role="status"] button'));
        await until(() => downloads.length === 1);

        expect(machine.requests('device.record').map((request) => request.mode)).toEqual(['start', 'stop']);
        expect(downloads[0]).toMatch(/^Pixel 9 .*\.mp4$/);
        expect(page.host.querySelector('[role="status"]')).toBeNull();
    });

    test('leaves capture out on a machine that does not answer it', async () => {
        machine.answersOnly(['device.list', 'device.open', 'device.detail', 'device.action', 'device.input']);
        workspace = await openFakeWorkspace(machine, { views: [PHONE] }, { activeViewId: PHONE.id, views: {} });
        page = mount();
        await page.renderApp();
        await until(() => button('Device tools') !== null);
        await clickOn(button('Device tools'));
        await until(() => document.body.textContent?.includes('Permissions') === true);

        expect(button('Copy screenshot')).toBeNull();
    });
});
