import { describe, expect, test } from 'bun:test';
import { FakeRecorder } from './device-test-helpers.ts';

describe('DeviceRecordings', () => {
    test('keeps one recording per device and answers its file once the recorder exited', async () => {
        const recorder = new FakeRecorder();
        const recordings = recorder.recordings();

        recordings.start('phone-1', '/captures/phone-1.mp4', ['record', 'phone-1'], null);
        expect(recordings.stateOf('phone-1')).toBe('recording');
        expect(() => recordings.start('phone-1', '/captures/again.mp4', ['record'], null)).toThrow('This device is already being recorded');

        expect(await recordings.stop('phone-1', (process) => process.interrupt())).toBe('/captures/phone-1.mp4');
        expect(recorder.signals).toEqual(['SIGINT']);
        expect(recordings.stateOf('phone-1')).toBeNull();
        await expect(recordings.stop('phone-1', () => undefined)).rejects.toMatchObject({ code: 'device-not-recording' });
    });

    test('stops at its limit by itself and still hands over the file', async () => {
        const recorder = new FakeRecorder();
        const recordings = recorder.recordings();
        recordings.start('phone-1', '/captures/phone-1.mp4', ['record'], 600_000);

        recorder.pass(600_000);
        await Promise.resolve();

        expect(recorder.signals).toEqual(['SIGINT']);
        expect(recordings.stateOf('phone-1')).toBe('ended');
        expect(recordings.settingsOf('phone-1')).toEqual({ recording: true, recordingEnded: true });
        expect(await recordings.stop('phone-1', () => undefined)).toBe('/captures/phone-1.mp4');
        expect(recorder.signals).toEqual(['SIGINT']);
        expect(recordings.settingsOf('phone-1')).toEqual({ recording: false });
    });

    test('starts no new recording over one that ended on its own until that one was stopped', async () => {
        const recorder = new FakeRecorder();
        const recordings = recorder.recordings();
        recordings.start('phone-1', '/captures/first.mp4', ['record'], null);
        recorder.finish(0);
        await Promise.resolve();

        expect(() => recordings.start('phone-1', '/captures/second.mp4', ['record'], null)).toThrow('was not saved yet');
        expect(await recordings.stop('phone-1', () => undefined)).toBe('/captures/first.mp4');
        recordings.start('phone-1', '/captures/second.mp4', ['record'], null);
        expect(recordings.stateOf('phone-1')).toBe('recording');
    });

    test('kills a recorder that does not finish its file and says the video was lost', async () => {
        const recorder = new FakeRecorder();
        recorder.exitOnInterrupt = false;
        const recordings = recorder.recordings();
        recordings.start('phone-1', '/captures/phone-1.mp4', ['record'], null);

        const stopping = recordings.stop('phone-1', (process) => process.interrupt());
        await Promise.resolve();
        recorder.pass(15_000);

        await expect(stopping).rejects.toMatchObject({ code: 'device-capture-failed' });
        expect(recorder.signals).toEqual(['SIGINT', 'SIGKILL']);
    });
});
