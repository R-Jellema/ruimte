import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import type { DesktopBridge } from '@/desktop/bridge';
import { useEndpoints, type Endpoint } from '@/state/endpoints';
import { useUi } from '@/state/ui';
import { useWindow } from '@/state/window';
import { clickOn, mount, until, type Mounted } from '../../../../testing/dom';
import { connectFakeMachine, FakeMachine } from '../../../../testing/fake-machine';
import { machineBridge } from '../../../../testing/machine-bridge';

const scope = globalThis as unknown as { window: { ruimteDesktop?: DesktopBridge } };

// A machine of the list, so the pane has a row of its own to wait for beside the one under test.
const ATTIC: Endpoint = {
    id: 'attic',
    label: 'Attic',
    httpBaseUrl: 'http://127.0.0.1:1',
    wsBaseUrl: 'ws://127.0.0.1:1',
    reachability: 'lan',
    daemonId: null,
    daemonPublicKey: null
};

let page: Mounted;
let chosen: string[];
let release: (() => void) | null;

function everything(): string {
    return document.body.textContent ?? '';
}

function button(label: string): HTMLButtonElement | null {
    return [...document.querySelectorAll('button')].find((element) => element.textContent?.trim() === label) ?? null;
}

async function open(platform: string, machine: DesktopBridge['machine']): Promise<void> {
    scope.window.ruimteDesktop = {
        platform,
        pickFolder: async () => null,
        openExternal: async () => undefined,
        openGuestDevTools: () => undefined,
        isFullscreen: async () => false,
        onFullscreen: () => () => undefined,
        ...(machine === undefined ? {} : { machine })
    } as DesktopBridge;
    useEndpoints.getState().add(ATTIC);
    page = mount();
    await page.renderApp();
    await act(async () => useUi.getState().setSettings({ open: true, section: 'computer' }));
    await until(() => everything().includes('Allow computer use on Attic'));
}

beforeEach(() => {
    chosen = [];
    release = null;
    useWindow.getState().setBooting(false);
});

afterEach(async () => {
    await act(async () => useUi.getState().setSettings({ open: false }));
    await page.unmount();
    release?.();
    useEndpoints.getState().remove(ATTIC.id);
    delete scope.window.ruimteDesktop;
});

describe('Settings > Computer Use of an app that runs no machine', () => {
    test('a Mac shows the row off, and the button opens the restart question', async () => {
        await open(
            'darwin',
            machineBridge('none', {
                choose: async (mode) => {
                    chosen.push(mode);
                }
            })
        );
        expect(everything()).toContain('Allow computer use on this Mac');
        expect(everything()).toContain('Run a machine here first.');
        const switchControl = document.querySelector<HTMLElement>('[role="switch"][aria-label="Allow computer use on this Mac"]');
        expect(switchControl).not.toBeNull();
        expect(switchControl?.getAttribute('aria-checked')).toBe('false');
        expect(switchControl?.hasAttribute('disabled') || switchControl?.getAttribute('aria-disabled') === 'true').toBe(true);
        await clickOn(button('Set up a machine…'));
        await until(() => everything().includes('Restart Ruimte to run a machine here?'));
        await clickOn(button('Restart'));
        expect(chosen).toEqual(['local']);
    });

    test('another system has no row', async () => {
        await open('linux', machineBridge('none'));
        expect(everything()).not.toContain('Allow computer use on this Mac');
    });

    test('an app that runs a machine has no row', async () => {
        // An app with a machine connects to it, so a fake stands behind the pool instead of a socket.
        release = connectFakeMachine(new FakeMachine());
        await open('darwin', machineBridge('local'));
        expect(everything()).not.toContain('Allow computer use on this Mac');
    });
});
