import { describe, expect, test } from 'bun:test';
import { EVENT_SCHEMAS, REQUEST_SCHEMAS } from './index.ts';
import { DeviceInfoSchema, DeviceTargetPayloadSchema, deviceButtons, devicePermissions, deviceTools, type DeviceInfo } from './device.ts';
import { liveStreamContentType, liveStreamFormatOf } from './live-stream.ts';

describe('device contracts', () => {
    test('accepts a simulator identity and lifecycle state', () => {
        expect(
            DeviceInfoSchema.parse({
                deviceId: '8BCA442C-9449-42E4-846A-5E421C37BACE',
                backendId: 'simctl',
                platform: 'ios',
                kind: 'simulator',
                name: 'iPhone 18 Pro',
                runtime: 'iOS 27.0',
                state: 'shutdown',
                capabilities: { boot: true, shutdown: true, stream: true, input: true, screenshot: true }
            })
        ).toMatchObject({ platform: 'ios', state: 'shutdown' });
    });

    test('requires the platform on lifecycle requests', () => {
        expect(DeviceTargetPayloadSchema.safeParse({ deviceId: 'phone-1' }).success).toBe(false);
    });

    test('keeps pointer coordinates independent from the rendered view size', () => {
        expect(
            REQUEST_SCHEMAS['device.input'].payload.safeParse({
                platform: 'ios',
                backendId: 'simctl',
                deviceId: 'phone-1',
                input: { kind: 'pointer', phase: 'move', x: 0.25, y: 0.75 }
            }).success
        ).toBe(true);
        expect(
            REQUEST_SCHEMAS['device.input'].payload.safeParse({
                platform: 'ios',
                backendId: 'simctl',
                deviceId: 'phone-1',
                input: { kind: 'pointer', phase: 'move', x: 2, y: 0.75 }
            }).success
        ).toBe(false);
        expect(
            REQUEST_SCHEMAS['device.input'].payload.safeParse({
                platform: 'ios',
                backendId: 'simctl',
                deviceId: 'phone-1',
                input: { kind: 'pointer', phase: 'down', x: 0.5, y: 0.97, edge: 'bottom' }
            }).success
        ).toBe(true);
    });

    test('accepts scroll, multi-touch and system gestures with bounded coordinates', () => {
        const target = { platform: 'ios', backendId: 'simctl', deviceId: 'phone-1' } as const;
        expect(
            REQUEST_SCHEMAS['device.input'].payload.safeParse({
                ...target,
                input: { kind: 'scroll', deltaX: 14, deltaY: -32, x: 0.4, y: 0.6 }
            }).success
        ).toBe(true);
        expect(
            REQUEST_SCHEMAS['device.input'].payload.safeParse({
                ...target,
                input: { kind: 'multiPointer', phase: 'move', first: { x: 0.2, y: 0.5 }, second: { x: 0.8, y: 0.5 } }
            }).success
        ).toBe(true);
        expect(REQUEST_SCHEMAS['device.input'].payload.safeParse({ ...target, input: { kind: 'button', button: 'appSwitcher' } }).success).toBe(true);
        expect(
            REQUEST_SCHEMAS['device.input'].payload.safeParse({
                ...target,
                input: { kind: 'multiPointer', phase: 'move', first: { x: -0.1, y: 0.5 }, second: { x: 0.8, y: 0.5 } }
            }).success
        ).toBe(false);
    });

    test('supports HTTP and replaceable event streams', () => {
        expect(REQUEST_SCHEMAS['device.open'].payload.safeParse({ backendId: 'simctl', platform: 'ios', deviceId: 'phone-1', stream: 'http' }).success).toBe(
            true
        );
        expect(REQUEST_SCHEMAS['device.open'].payload.safeParse({ backendId: 'simctl', platform: 'ios', deviceId: 'phone-1', stream: 'events' }).success).toBe(
            true
        );
        expect(
            EVENT_SCHEMAS['device.frame'].safeParse({
                deviceId: 'phone-1',
                backendId: 'simctl',
                platform: 'ios',
                sequence: 1,
                width: 1179,
                height: 2556,
                data: 'AQID'
            }).success
        ).toBe(true);
    });

    test('validates simulator settings and typed actions', () => {
        expect(
            REQUEST_SCHEMAS['device.action'].payload.safeParse({
                backendId: 'simctl',
                platform: 'ios',
                deviceId: 'phone-1',
                action: 'setLocation',
                latitude: 52.3676,
                longitude: 4.9041
            }).success
        ).toBe(true);
        expect(
            REQUEST_SCHEMAS['device.action'].payload.safeParse({
                backendId: 'simctl',
                platform: 'ios',
                deviceId: 'phone-1',
                action: 'setLocation',
                latitude: 120,
                longitude: 4.9041
            }).success
        ).toBe(false);
        expect(
            REQUEST_SCHEMAS['device.action'].payload.safeParse({
                backendId: 'simctl',
                platform: 'ios',
                deviceId: 'phone-1',
                action: 'setPermission',
                appId: 'com.example.app',
                permission: 'camera',
                decision: 'grant'
            }).success
        ).toBe(true);
    });

    test('reads what a device announces and keeps only what this version knows', () => {
        const emulator: DeviceInfo = DeviceInfoSchema.parse({
            deviceId: 'Pixel_9_Pro_API_35',
            backendId: 'android',
            platform: 'android',
            kind: 'simulator',
            name: 'Pixel 9 Pro API 35',
            runtime: 'API 35',
            state: 'booted',
            capabilities: {
                boot: true,
                shutdown: true,
                stream: true,
                input: true,
                screenshot: false,
                buttons: ['back', 'home', 'crown'],
                tools: ['appearance', 'hologram'],
                permissions: ['camera', 'telepathy']
            }
        });
        expect(deviceButtons(emulator)).toEqual(['back', 'home']);
        expect(deviceTools(emulator)).toEqual(['appearance']);
        expect(devicePermissions(emulator)).toEqual(['camera']);
    });

    test('gives a device from an older daemon the buttons and tools that daemon had', () => {
        const capabilities = { boot: true, shutdown: true, stream: true, input: true, screenshot: true };
        expect(deviceButtons({ capabilities })).toEqual(['home', 'swipeHome', 'appSwitcher', 'lock', 'siri']);
        expect(deviceTools({ capabilities, platform: 'ios', kind: 'simulator' })).toContain('push');
        expect(deviceTools({ capabilities, platform: 'ios', kind: 'simulator' })).not.toContain('capture');
        expect(deviceTools({ capabilities, platform: 'ios', kind: 'physical' })).toEqual([]);
    });

    test('parses the tools, buttons and settings a person drives from the node', () => {
        const target = { platform: 'ios', backendId: 'simctl', deviceId: 'phone-1' } as const;
        const actions = [
            { action: 'setStatusBar', value: 'clean' },
            { action: 'setBattery', level: 40, charging: true },
            { action: 'resetBattery' },
            { action: 'biometric', sensor: 'face', event: 'match' },
            { action: 'shake' },
            { action: 'memoryWarning' },
            { action: 'setAllPermissions', appId: 'com.example.app', decision: 'grant' },
            { action: 'installApp', path: '/work/atlas/build/Atlas.app' },
            { action: 'addMedia', paths: ['/work/atlas/shot.png'] },
            { action: 'erase' },
            { action: 'setFold', value: 'tabletop' },
            { action: 'setHinge', degrees: 130 },
            { action: 'setCamera', appId: 'com.example.app', source: 'file', path: '/work/atlas/qr.png' }
        ];
        for (const action of actions) {
            expect(REQUEST_SCHEMAS['device.action'].payload.safeParse({ ...target, ...action }).success).toBe(true);
        }
        expect(REQUEST_SCHEMAS['device.action'].payload.safeParse({ ...target, action: 'setBattery', level: 101, charging: false }).success).toBe(false);
        expect(REQUEST_SCHEMAS['device.action'].payload.safeParse({ ...target, action: 'addMedia', paths: [] }).success).toBe(false);
        expect(REQUEST_SCHEMAS['device.action'].payload.safeParse({ ...target, action: 'setHinge', degrees: 200 }).success).toBe(false);
        expect(REQUEST_SCHEMAS['device.input'].payload.safeParse({ ...target, input: { kind: 'key', phase: 'down', usage: 0x04 } }).success).toBe(true);
        expect(REQUEST_SCHEMAS['device.input'].payload.safeParse({ ...target, input: { kind: 'key', phase: 'down', usage: 0 } }).success).toBe(false);
        expect(REQUEST_SCHEMAS['device.input'].payload.safeParse({ ...target, input: { kind: 'button', button: 'volumeUp' } }).success).toBe(true);
        expect(
            REQUEST_SCHEMAS['device.detail'].result.safeParse({
                ...target,
                settings: { statusBar: 'clean', battery: { level: 80, charging: false }, biometricEnrolled: true, hinge: 90, panel: 'inner', recording: true }
            }).success
        ).toBe(true);
    });

    test('parses capture, record and clipboard requests', () => {
        const target = { platform: 'android', backendId: 'android', deviceId: 'emulator-5554' } as const;
        expect(REQUEST_SCHEMAS['device.capture'].payload.safeParse(target).success).toBe(true);
        expect(REQUEST_SCHEMAS['device.capture'].result.safeParse({ path: '/home/.ruimte/device-captures/shot.png', width: 1080, height: 2400 }).success).toBe(
            true
        );
        expect(REQUEST_SCHEMAS['device.record'].payload.safeParse({ ...target, mode: 'start' }).success).toBe(true);
        expect(REQUEST_SCHEMAS['device.record'].payload.safeParse({ ...target, mode: 'pause' }).success).toBe(false);
        expect(REQUEST_SCHEMAS['device.record'].result.safeParse({ recording: false, path: '/home/.ruimte/device-captures/clip.mp4' }).success).toBe(true);
        expect(REQUEST_SCHEMAS['device.clipboard'].payload.safeParse(target).success).toBe(true);
        expect(REQUEST_SCHEMAS['device.clipboard'].payload.safeParse({ ...target, text: 'héllo 👋', paste: true }).success).toBe(true);
        expect(REQUEST_SCHEMAS['device.clipboard'].result.safeParse({ text: '' }).success).toBe(true);
    });

    test('keeps an announced tool a newer daemon added beside the new ones this version knows', () => {
        const capabilities = {
            boot: true,
            shutdown: true,
            stream: true,
            input: true,
            screenshot: true,
            tools: ['capture', 'teleport', 'clipboard'],
            buttons: ['volumeUp', 'crown']
        };
        expect(deviceTools({ capabilities, platform: 'android', kind: 'simulator' })).toEqual(['capture', 'clipboard']);
        expect(deviceButtons({ capabilities })).toEqual(['volumeUp']);
    });

    test('names H.264 frames and their stream', () => {
        expect(
            EVENT_SCHEMAS['device.frame'].safeParse({
                deviceId: 'emulator-5554',
                backendId: 'android',
                platform: 'android',
                sequence: 1,
                width: 916,
                height: 2048,
                format: 'h264',
                data: ''
            }).success
        ).toBe(true);
        expect(liveStreamFormatOf(liveStreamContentType('h264'))).toBe('h264');
        expect(liveStreamFormatOf('application/x-ruimte-jpeg-stream')).toBe('jpeg');
        expect(liveStreamFormatOf('video/mp4')).toBeNull();
    });
});
