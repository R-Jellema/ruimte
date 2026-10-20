import { describe, expect, test } from 'bun:test';
import { normalize } from 'node:path';
import { locateAndroidSdk, type AndroidSdkEnvironment } from './android-sdk.ts';

function environment(overrides: Partial<AndroidSdkEnvironment> & { files?: string[] }): AndroidSdkEnvironment {
    // The SDK joins its paths in the form of the platform the test runs on.
    const files = new Set((overrides.files ?? []).map((file) => normalize(file)));
    return {
        env: {},
        platform: 'darwin',
        home: '/Users/bas',
        which: () => null,
        realpath: (path) => path,
        exists: (path) => files.has(path),
        ...overrides
    };
}

describe('locateAndroidSdk', () => {
    test('finds the SDK that holds the adb on PATH when no variable names it', () => {
        const sdk = locateAndroidSdk(
            environment({
                which: (command) => (command === 'adb' ? '/usr/local/bin/adb' : null),
                realpath: () => '/Users/bas/Development/Environment/android-sdk/platform-tools/adb',
                files: ['/Users/bas/Development/Environment/android-sdk/platform-tools/adb', '/Users/bas/Development/Environment/android-sdk/emulator/emulator']
            })
        );

        expect(sdk).toEqual({
            adb: normalize('/Users/bas/Development/Environment/android-sdk/platform-tools/adb'),
            emulator: normalize('/Users/bas/Development/Environment/android-sdk/emulator/emulator'),
            avdHome: normalize('/Users/bas/.android/avd')
        });
    });

    test('prefers ANDROID_HOME and honors a moved AVD folder', () => {
        const sdk = locateAndroidSdk(
            environment({
                env: { ANDROID_HOME: '/opt/android', ANDROID_AVD_HOME: '/data/avd' },
                files: ['/opt/android/platform-tools/adb', '/Users/bas/Library/Android/sdk/platform-tools/adb']
            })
        );

        expect(sdk).toEqual({ adb: normalize('/opt/android/platform-tools/adb'), emulator: null, avdHome: '/data/avd' });
    });

    test('falls back to the default folder of the platform', () => {
        const sdk = locateAndroidSdk(
            environment({
                platform: 'linux',
                home: '/home/bas',
                files: ['/home/bas/Android/Sdk/platform-tools/adb', '/home/bas/Android/Sdk/emulator/emulator']
            })
        );

        expect(sdk?.emulator).toBe(normalize('/home/bas/Android/Sdk/emulator/emulator'));
    });

    test('keeps a lone adb on PATH that sits in no SDK, and nothing without one', () => {
        expect(locateAndroidSdk(environment({ which: () => '/opt/homebrew/bin/adb' }))).toEqual({
            adb: '/opt/homebrew/bin/adb',
            emulator: null,
            avdHome: normalize('/Users/bas/.android/avd')
        });
        expect(locateAndroidSdk(environment({}))).toBeNull();
    });
});
