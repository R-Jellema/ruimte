import { describe, expect, test } from 'bun:test';
import { offersMachineRestart, machineLost } from './machine-lost';

describe('when the workspace says its machine stopped answering', () => {
    test('only once a try to bring the link back failed, and until it is open again', () => {
        expect(machineLost({ status: 'open', attempts: 0 })).toBe(false);
        // A link that is opening for the first time is a wait, not a machine that went away.
        expect(machineLost({ status: 'connecting', attempts: 0 })).toBe(false);
        expect(machineLost({ status: 'closed', attempts: 1 })).toBe(true);
        expect(machineLost({ status: 'connecting', attempts: 2 })).toBe(true);
        expect(machineLost({ status: 'closed', attempts: 0, failure: 'No network path to the machine' })).toBe(true);
    });
});

describe('the restart the lost screen offers', () => {
    const older = { failure: 'This machine runs an older Ruimte. Update Ruimte there, or restart it to pick up the update.' };
    const bridge = { restartNow: async () => undefined as never };

    test('only for this computer, refused as older, with a shell that restarts the service', () => {
        expect(offersMachineRestart('local', older, bridge)).toBe(true);
        expect(offersMachineRestart('studio', older, bridge)).toBe(false);
        expect(offersMachineRestart('local', { failure: 'No network path to the machine' }, bridge)).toBe(false);
        expect(offersMachineRestart('local', older, {})).toBe(false);
        expect(offersMachineRestart('local', older, null)).toBe(false);
    });
});
