import { describe, expect, test } from 'bun:test';
import type { DeviceInfo } from '@ruimte/contracts';
import { deviceTargetOf, matchLaunchDevice } from './device-target';

describe('deviceTargetOf', () => {
    test('reads the device of flutter run, and knows a browser or a desktop is none', () => {
        expect(deviceTargetOf('flutter run -d 8BCA442C-9449-42E4-846A-5E421C37BACE')).toEqual({ id: '8BCA442C-9449-42E4-846A-5E421C37BACE' });
        expect(deviceTargetOf('fvm flutter run --device-id=emulator-5554 --flavor dev')).toEqual({ id: 'emulator-5554' });
        expect(deviceTargetOf('flutter run')).toEqual({});
        expect(deviceTargetOf('flutter run -d chrome')).toBeNull();
        expect(deviceTargetOf('flutter run -d web-server --web-port 8080')).toBeNull();
    });

    test('reads the simulator of simctl launch and install', () => {
        expect(deviceTargetOf('xcrun simctl launch 8BCA442C com.example.app')).toEqual({ platform: 'ios', id: '8BCA442C' });
        expect(deviceTargetOf('xcrun simctl install booted build/App.app')).toEqual({ platform: 'ios' });
        expect(deviceTargetOf('xcrun simctl list')).toBeNull();
    });

    test('reads the destination of xcodebuild by id or by name', () => {
        expect(deviceTargetOf("xcodebuild -scheme App -destination 'id=8BCA442C' build")).toEqual({ platform: 'ios', id: '8BCA442C' });
        expect(deviceTargetOf('xcodebuild test -destination "platform=iOS Simulator,name=iPhone 18 Pro,OS=27.0"')).toEqual({
            platform: 'ios',
            name: 'iPhone 18 Pro'
        });
        expect(deviceTargetOf('xcodebuild -scheme App build')).toBeNull();
    });

    test('reads the device of expo run on either platform', () => {
        expect(deviceTargetOf('npx expo run:ios --device "iPhone 18 Pro"')).toEqual({ platform: 'ios', id: 'iPhone 18 Pro', name: 'iPhone 18 Pro' });
        expect(deviceTargetOf('bunx expo run:android')).toEqual({ platform: 'android' });
    });

    test('reads the simulator, udid or device id of react-native run', () => {
        expect(deviceTargetOf('npx react-native run-ios --simulator "iPhone 18 Pro"')).toEqual({ platform: 'ios', name: 'iPhone 18 Pro' });
        expect(deviceTargetOf('npx react-native run-ios --udid 8BCA442C')).toEqual({ platform: 'ios', id: '8BCA442C' });
        expect(deviceTargetOf('npx react-native run-android --deviceId R5CT')).toEqual({ platform: 'android', id: 'R5CT' });
    });

    test('reads the serial of adb -s, and leaves every other command alone', () => {
        expect(deviceTargetOf('adb -s emulator-5554 logcat')).toEqual({ platform: 'android', id: 'emulator-5554' });
        expect(deviceTargetOf('bun run dev')).toBeNull();
    });

    test('finds the device a target names by its id, and else by its name, on its platform', () => {
        const capabilities = { boot: true, shutdown: true, stream: true, input: true, screenshot: true };
        const phone: DeviceInfo = {
            deviceId: 'C0FFEE',
            backendId: 'simctl',
            platform: 'ios',
            kind: 'simulator',
            name: 'iPhone 18 Pro',
            runtime: 'iOS 27.0',
            state: 'booted',
            capabilities
        };
        const pixel: DeviceInfo = { ...phone, deviceId: 'Pixel_9', backendId: 'android', platform: 'android', name: 'Pixel 9', runtime: 'API 36' };

        expect(matchLaunchDevice({ id: 'C0FFEE' }, [pixel, phone])).toBe(phone);
        expect(matchLaunchDevice({ platform: 'ios', id: 'iPhone 18 Pro', name: 'iPhone 18 Pro' }, [pixel, phone])).toBe(phone);
        expect(matchLaunchDevice({ platform: 'android', id: 'C0FFEE' }, [pixel, phone])).toBeNull();
        expect(matchLaunchDevice({}, [pixel, phone])).toBeNull();
    });
});
