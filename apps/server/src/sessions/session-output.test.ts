import { afterEach, beforeEach, expect, jest, test } from 'bun:test';
import { Recorder, makeHarness, type Harness } from './test-helpers.ts';

let harness: Harness;
beforeEach(async () => {
    harness = await makeHarness();
});
afterEach(async () => {
    jest.useRealTimers();
    await harness.cleanup();
});

test('idle output goes immediately while a burst stays batched without losing order', async () => {
    const recorder = new Recorder();
    harness.manager.subscribe('client', recorder.sink());
    await harness.manager.create({ sessionId: 'session', cols: 80, rows: 24, shell: '/bin/sh', args: [], cwd: harness.home });
    await harness.manager.attach('session', 'client', 80, 24);
    recorder.events.length = 0;
    jest.useFakeTimers();
    jest.setSystemTime(1000);
    const pty = harness.adapter.forSession('session');
    pty.emit('a');
    expect(recorder.output).toBe('a');
    pty.emit('b');
    pty.emit('c');
    jest.advanceTimersByTime(15);
    expect(recorder.output).toBe('a');
    jest.advanceTimersByTime(1);
    expect(recorder.output).toBe('abc');
    expect(recorder.events.filter((event) => event.event === 'session.output').map((event) => event.payload.data)).toEqual(['a', 'bc']);
    jest.advanceTimersByTime(100);
    pty.emit('d');
    expect(recorder.output).toBe('abcd');
    pty.emit('e');
    pty.exit(0);
    expect(recorder.output).toBe('abcde');
    expect(recorder.exitOf('session')).toBe(0);
});
