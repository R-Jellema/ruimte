import { describe, expect, test } from 'bun:test';
import type { DeviceInfo } from '@ruimte/contracts';
import { dropAction, isInstallable } from './device-files';

const capabilities = { boot: true, shutdown: true, stream: true, input: true, screenshot: true, tools: ['installApp', 'addMedia'] };
const simulator: Pick<DeviceInfo, 'platform' | 'kind' | 'capabilities'> = { platform: 'ios', kind: 'simulator', capabilities };
const phone: Pick<DeviceInfo, 'platform' | 'kind' | 'capabilities'> = { platform: 'android', kind: 'physical', capabilities };

describe('dropAction', () => {
    test('installs the one app bundle the device takes', () => {
        expect(dropAction(simulator, ['/work/build/Atlas.app/'])).toEqual({ action: 'installApp', path: '/work/build/Atlas.app/' });
        expect(dropAction(phone, ['/work/app-debug.apk'])).toEqual({ action: 'installApp', path: '/work/app-debug.apk' });
        expect(isInstallable(simulator, '/work/Atlas.ipa')).toBe(false);
        expect(isInstallable({ platform: 'ios', kind: 'physical' }, '/work/Atlas.ipa')).toBe(true);
    });

    test('adds pictures and videos, and takes nothing else', () => {
        expect(dropAction(simulator, ['/work/a.PNG', '/work/b.mov'])).toEqual({ action: 'addMedia', paths: ['/work/a.PNG', '/work/b.mov'] });
        expect(dropAction(simulator, ['/work/a.png', '/work/notes.txt'])).toBeNull();
        expect(dropAction(simulator, ['/work/Atlas.ipa'])).toBeNull();
        expect(dropAction({ ...simulator, capabilities: { ...capabilities, tools: [] } }, ['/work/a.png'])).toBeNull();
    });
});
