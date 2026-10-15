import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AndroidBackend } from './android.ts';
import { locateAndroidSdk } from './android-sdk.ts';

/* A whole one-pixel png, which a media scanner indexes where a header alone would be refused. */
const PIXEL_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

/*
 * Whether a picture Ruimte adds shows up in the gallery of a running Android device, which says
 * which media scan it honors. It leaves the picture on the device, so run it on a spare one.
 */
const sdk = locateAndroidSdk();
const backend = new AndroidBackend();
const booted = sdk === null ? undefined : (await backend.list().catch(() => [])).find((device) => device.state === 'booted');

describe.skipIf(booted === undefined)('media on an Android device', () => {
    test('a picture added to the device is in its media store', async () => {
        const folder = await mkdtemp(join(tmpdir(), 'ruimte-android-media-'));
        const name = `ruimte-media-${Date.now()}.png`;
        try {
            await writeFile(join(folder, name), PIXEL_PNG);
            await backend.action(booted!.deviceId, {
                backendId: 'android',
                platform: 'android',
                deviceId: booted!.deviceId,
                action: 'addMedia',
                paths: [join(folder, name)]
            });
            await Bun.sleep(2_000);
            const serial = (await new Response(Bun.spawn([sdk!.adb, 'devices']).stdout).text())
                .split('\n')
                .map((line) => line.split('\t')[0]!)
                .find((entry) => entry !== '' && !entry.startsWith('List'));
            const query = Bun.spawn([sdk!.adb, '-s', serial!, 'shell', 'content query --uri content://media/external/images/media --projection _display_name']);

            expect(await new Response(query.stdout).text()).toContain(name);
        } finally {
            await rm(folder, { recursive: true, force: true });
        }
    });
});
