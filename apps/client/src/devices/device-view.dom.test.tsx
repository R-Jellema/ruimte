import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ProjectView } from '@ruimte/contracts';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { answerDevices, FAKE_SIMULATOR, referenceOf, type FakeDevices } from '../../testing/fake-devices';
import { mount, until, type Mounted } from '../../testing/dom';

const PHONE: ProjectView = { kind: 'device', id: 'phone', name: FAKE_SIMULATOR.name, device: referenceOf(FAKE_SIMULATOR) };

let machine: FakeMachine;
let devices: FakeDevices;
let workspace: FakeWorkspace;
let page: Mounted;

beforeEach(async () => {
    machine = new FakeMachine();
    devices = answerDevices(machine);
    workspace = await openFakeWorkspace(machine, { views: [PHONE] }, { activeViewId: PHONE.id, views: {} });
    page = mount();
    await page.renderApp();
});

afterEach(async () => {
    await page.unmount();
    workspace.close();
    devices.restore();
});

describe('a device view', () => {
    test('opens the device it names on its machine and draws its screen', async () => {
        await until(() => machine.requests('device.open').length > 0);

        expect(machine.requests('device.open')[0]).toMatchObject({ backendId: 'simctl', platform: 'ios', deviceId: FAKE_SIMULATOR.deviceId });
        await until(() => page.host.querySelector(`canvas[aria-label="${FAKE_SIMULATOR.name} screen"]`) !== null);
    });
});
