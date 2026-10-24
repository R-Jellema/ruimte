import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

/*
 * Set RUIMTE_IOS_PHYSICAL_DEVICE_ID to an explicitly selected spare phone's CoreDevice id.
 * A selected phone or bridge that is unavailable fails acceptance rather than passing without a read.
 */
const deviceId = process.env.RUIMTE_IOS_PHYSICAL_DEVICE_ID;
describe.skipIf(process.platform !== 'darwin' || !deviceId)('iPhone battery', () => {
    test('a paired phone says its own level and whether it is on power', async () => {
        const { createPhysicalBatteryReader, IosPhysicalBackend } = await import('./ios-physical.ts');
        const reader = createPhysicalBatteryReader(join(import.meta.dir, '..', '..', '..', 'ios-device-bridge', 'target', 'release', 'ios-device-bridge'));
        const backend = new IosPhysicalBackend(undefined, undefined, null, undefined, reader);
        expect(reader).not.toBeNull();
        const phone = (await backend.list()).find((device) => device.deviceId === deviceId && device.state === 'booted');
        expect(phone).toBeDefined();
        const power = await backend.power(deviceId!);
        expect(power).not.toBeNull();
        expect(power!.level).toBeGreaterThanOrEqual(0);
        expect(power!.level).toBeLessThanOrEqual(100);
        expect(typeof power!.charging).toBe('boolean');
        expect(typeof power!.plugged).toBe('boolean');
        expect(power!.simulated).toBeUndefined();
    }, 60_000);
});
