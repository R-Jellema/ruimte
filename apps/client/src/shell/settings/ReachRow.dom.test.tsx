import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { REQUEST_SCHEMAS, type EndpointInfo, type ReachCheck, type RequestType } from '@ruimte/contracts';
import type { DesktopBridge } from '@/desktop/bridge';
import { LOCAL_ENDPOINT_ID } from '@/state/endpoints';
import { useUi } from '@/state/ui';
import { useWindow } from '@/state/window';
import { adoptEndpointInfo } from '@/transport/server-info';
import { clickOn, mount, until, type Mounted } from '../../../testing/dom';
import { connectFakeMachine, FakeMachine } from '../../../testing/fake-machine';

const NOW = Date.UTC(2026, 9, 1);

const scope = globalThis as unknown as { window: { ruimteDesktop?: DesktopBridge } };

const INFO: EndpointInfo = { id: 'machine-1', label: 'Studio', platform: 'darwin', version: '1.0.0', reachability: 'loopback', authenticated: false };

function reach(cause: string, severity: ReachCheck['severity']): ReachCheck {
    return {
        checkedAt: NOW,
        cause,
        severity,
        facts: {
            broker: { url: 'wss://broker.ruimte.app', connected: true },
            granted: true,
            probes: [],
            lanDoor: { wanted: true, listening: true, port: 4220, addresses: 1 },
            tunnel: 'utun4'
        }
    };
}

let page: Mounted;
let release: () => void;
let machine: FakeMachine;

function everything(): string {
    return document.body.textContent ?? '';
}

function checkAgain(): HTMLButtonElement | null {
    return document.querySelector<HTMLButtonElement>('[aria-label="Check again whether other devices reach This machine"]');
}

async function open(setUp: (machine: FakeMachine) => void): Promise<void> {
    machine = new FakeMachine();
    setUp(machine);
    release = connectFakeMachine(machine);
    scope.window.ruimteDesktop = {
        platform: 'darwin',
        pickFolder: async () => null,
        openExternal: async () => undefined,
        openGuestDevTools: () => undefined,
        isFullscreen: async () => false,
        onFullscreen: () => () => undefined
    };
    page = mount();
    await page.renderApp();
    await act(async () => adoptEndpointInfo(LOCAL_ENDPOINT_ID, INFO));
    await act(async () => useUi.getState().setSettings({ open: true, section: 'machines' }));
}

beforeEach(() => {
    useWindow.getState().setBooting(false);
});

afterEach(async () => {
    await act(async () => useUi.getState().setSettings({ open: false }));
    await page.unmount();
    release();
    delete scope.window.ruimteDesktop;
});

describe('Settings > Machines > this machine > Reachable from other devices', () => {
    test('says what the machine found and what to do, and checks again on request', async () => {
        await open((fake) =>
            fake.answer('endpoint.reach', (payload) => ({ reach: payload.check === true ? reach('ok', 'ok') : reach('vpn-blocks-udp', 'relayed') }))
        );
        await until(() => everything().includes('Traffic leaves through utun4'));
        expect(everything()).toContain('Let Ruimte bypass the VPN (split tunneling)');
        expect(machine.requests('endpoint.reach')).toEqual([{}]);

        await clickOn(checkAgain());
        await until(() => everything().includes('Other devices reach this machine, directly or through the relay.'));
        expect(machine.requests('endpoint.reach')).toEqual([{}, { check: true }]);
    });

    test('a check that fails says why', async () => {
        await open((fake) =>
            fake.answer('endpoint.reach', () => {
                throw new Error('the machine went away');
            })
        );
        await until(() => everything().includes('The check did not finish: the machine went away'));
    });

    test('is not offered by a machine from before the check', async () => {
        await open((fake) => fake.answersOnly((Object.keys(REQUEST_SCHEMAS) as RequestType[]).filter((type) => type !== 'endpoint.reach')));
        await until(() => everything().includes('Worktree folder'));
        expect(checkAgain()).toBeNull();
        expect(machine.requests('endpoint.reach')).toEqual([]);
    });
});
