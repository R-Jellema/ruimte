import { beforeEach, describe, expect, test } from 'bun:test';
import type { RemoteStatusEvent, Task } from '@ruimte/contracts';
import { waitingMachinesOf } from '@/canvas/remote-wait';
import { isUnstarted, isWaiting, useRemoteStatus } from './remote-status';

function task(id: string, patch: Partial<Task> = {}): Task {
    return {
        id,
        projectId: 'project',
        parentId: 'parent',
        childId: `child-${id}`,
        title: id,
        prompt: id,
        status: 'open',
        result: null,
        createdAt: 1,
        settledAt: null,
        wake: 'pending',
        ...patch
    };
}

const WAITING: RemoteStatusEvent = { machineId: 'machine-b', state: 'waiting', owed: 1, nextAttemptAt: 5, unstartedNodeIds: ['child-one'] };

beforeEach(() => useRemoteStatus.setState({ byEndpoint: {} }));

describe('the link state of a machine', () => {
    test('is kept per machine that works and per machine it works in, and a closed link leaves no trace', () => {
        const store = useRemoteStatus.getState();
        store.receive('a', WAITING);
        store.receive('a', { machineId: 'machine-c', state: 'open', owed: 0 });
        store.receive('z', WAITING);
        expect(isWaiting(useRemoteStatus.getState().byEndpoint['a']?.['machine-b'])).toBe(true);
        expect(isWaiting(useRemoteStatus.getState().byEndpoint['a']?.['machine-c'])).toBe(false);

        store.receive('a', { machineId: 'machine-b', state: 'closed', owed: 0 });
        expect(useRemoteStatus.getState().byEndpoint['a']?.['machine-b']).toBeUndefined();
        expect(useRemoteStatus.getState().byEndpoint['z']?.['machine-b']).toBeDefined();
    });

    test('forgets what one machine told when its socket goes', () => {
        useRemoteStatus.getState().receive('a', WAITING);
        useRemoteStatus.getState().forget('a');
        expect(useRemoteStatus.getState().byEndpoint['a']).toBeUndefined();
    });
});

describe('a task that has not started', () => {
    test('is one the machine still waits to be asked, while the link is not open', () => {
        expect(isUnstarted(WAITING, 'child-one')).toBe(true);
        expect(isUnstarted(WAITING, 'child-two')).toBe(false);
        expect(isUnstarted({ ...WAITING, state: 'connecting' }, 'child-one')).toBe(true);
        expect(isUnstarted({ ...WAITING, state: 'open' }, 'child-one')).toBe(false);
        expect(isUnstarted(undefined, 'child-one')).toBe(false);
    });

    test('is none for a task the machine took, whose result is what waits on the link', () => {
        const { unstartedNodeIds: _started, ...taken } = WAITING;
        expect(isWaiting(taken)).toBe(true);
        expect(isUnstarted(taken, 'child-one')).toBe(false);
    });
});

describe('the machines a node waits for', () => {
    const machineOf = (childId: string): string | undefined => (childId === 'child-local' ? undefined : 'machine-b');
    const tasks = Object.fromEntries(
        [task('one'), task('local'), task('done', { status: 'done' }), task('other', { parentId: 'elsewhere' })].map((entry) => [entry.id, entry])
    );

    test('are those an open task of it was given to and that have not taken it yet', () => {
        expect(waitingMachinesOf(tasks, 'parent', machineOf, { 'machine-b': WAITING })).toEqual(['machine-b']);
        expect(waitingMachinesOf(tasks, 'parent', machineOf, { 'machine-b': { ...WAITING, state: 'connecting' } })).toEqual(['machine-b']);
    });

    test('are none while the link is open, or once the machine took the task, or when the link is unknown', () => {
        expect(waitingMachinesOf(tasks, 'parent', machineOf, { 'machine-b': { ...WAITING, state: 'open' } })).toEqual([]);
        const { unstartedNodeIds: _started, ...taken } = WAITING;
        expect(waitingMachinesOf(tasks, 'parent', machineOf, { 'machine-b': taken })).toEqual([]);
        expect(waitingMachinesOf(tasks, 'parent', machineOf, undefined)).toEqual([]);
    });

    test('are none for a node that gave nothing to a machine', () => {
        expect(waitingMachinesOf(tasks, 'elsewhere', () => undefined, { 'machine-b': WAITING })).toEqual([]);
    });
});
