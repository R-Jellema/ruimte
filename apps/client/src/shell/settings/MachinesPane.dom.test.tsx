import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import type { DesktopBridge } from '@/desktop/bridge';
import { useUi } from '@/state/ui';
import { useWindow } from '@/state/window';
import { clickOn, mount, until, type Mounted } from '../../../testing/dom';
import { machineBridge } from '../../../testing/machine-bridge';

const scope = globalThis as unknown as { window: { ruimteDesktop?: DesktopBridge } };

let page: Mounted;
let chosen: string[];
let found: boolean;
let choose: (mode: 'local' | 'none') => Promise<void>;

function text(): string {
    return page.host.textContent ?? document.body.textContent ?? '';
}

function everything(): string {
    return document.body.textContent ?? '';
}

function button(label: string): HTMLButtonElement | null {
    return [...document.querySelectorAll('button')].find((element) => element.textContent?.trim() === label) ?? null;
}

function row(label: string): HTMLElement | null {
    return [...document.querySelectorAll<HTMLElement>('[role="tab"], [role="option"], button')].find((element) => element.textContent?.includes(label)) ?? null;
}

async function open(machine: DesktopBridge['machine']): Promise<void> {
    scope.window.ruimteDesktop = {
        platform: 'darwin',
        pickFolder: async () => null,
        openExternal: async () => undefined,
        openGuestDevTools: () => undefined,
        isFullscreen: async () => false,
        onFullscreen: () => () => undefined,
        ...(machine === undefined ? {} : { machine })
    };
    page = mount();
    await page.renderApp();
    await act(async () => useUi.getState().setSettings({ open: true, section: 'machines' }));
}

beforeEach(() => {
    chosen = [];
    found = false;
    choose = async (mode) => {
        chosen.push(mode);
    };
    useWindow.getState().setBooting(false);
});

afterEach(async () => {
    await act(async () => useUi.getState().setSettings({ open: false }));
    await page.unmount();
    delete scope.window.ruimteDesktop;
});

describe('Settings > Machines of an app that runs no machine', () => {
    test('lists this computer, and its detail offers to run a machine, restarting only after a confirm', async () => {
        await open(machineBridge('none', { found: async () => found, choose: (mode) => choose(mode) }));
        await until(() => row('No machine runs here') !== null);
        await clickOn(row('This computer'));
        await until(() => everything().includes('Run a machine on this computer'));
        await clickOn(button('Set up'));
        await until(() => everything().includes('Restart Ruimte to run a machine here?'));
        expect(chosen).toEqual([]);
        await clickOn(button('Restart'));
        expect(chosen).toEqual(['local']);
    });

    test('offers the machine that already runs here', async () => {
        found = true;
        await open(machineBridge('none', { found: async () => found, choose: (mode) => choose(mode) }));
        await until(() => row('A machine runs here, not connected') !== null);
        await clickOn(row('This computer'));
        await until(() => button('Use this machine') !== null);
        expect(everything()).toContain('Use the machine on this computer');
    });

    test('a choice that could not be saved stays in the dialog with its reason', async () => {
        choose = () => Promise.reject(new Error('disk full'));
        await open(machineBridge('none', { found: async () => found, choose: (mode) => choose(mode) }));
        await until(() => row('This computer') !== null);
        await clickOn(row('This computer'));
        await until(() => button('Set up') !== null);
        await clickOn(button('Set up'));
        await clickOn(button('Restart'));
        await until(() => everything().includes('disk full'));
        expect(everything()).toContain('Restart Ruimte to run a machine here?');
    });

    test('an app that runs a machine has no row for this computer', async () => {
        await open(undefined);
        await until(() => everything().includes('Machines'));
        expect(row('No machine runs here')).toBeNull();
        expect(text()).not.toContain('Run a machine on this computer');
    });
});
