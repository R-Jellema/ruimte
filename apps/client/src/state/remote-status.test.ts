import { beforeEach, describe, expect, test } from 'bun:test';
import type { RemoteStatusEvent, Task } from '@ruimte/contracts';
import { waitingMachinesOf } from '@/canvas/remote-wait';
import { isWaiting, useRemoteStatus } from './remote-status';

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

const WAITING: RemoteStatusEvent = { machineId: 'machine-b', state: 'waiting', owed: 1, nextAttemptAt: 5 };

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

describe('the machines a node waits for', () => {
    const machineOf = (childId: string): string | undefined => (childId === 'child-local' ? undefined : 'machine-b');
    const tasks = Object.fromEntries(
        [task('one'), task('local'), task('done', { status: 'done' }), task('other', { parentId: 'elsewhere' })].map((entry) => [entry.id, entry])
    );

    test('are those an open task of it was given to while the link waits', () => {
        expect(waitingMachinesOf(tasks, 'parent', machineOf, { 'machine-b': WAITING })).toEqual(['machine-b']);
    });

    test('are none while the link is open, closed or unknown', () => {
        expect(waitingMachinesOf(tasks, 'parent', machineOf, { 'machine-b': { ...WAITING, state: 'open' } })).toEqual([]);
        expect(waitingMachinesOf(tasks, 'parent', machineOf, { 'machine-b': { ...WAITING, state: 'connecting' } })).toEqual([]);
        expect(waitingMachinesOf(tasks, 'parent', machineOf, undefined)).toEqual([]);
    });

    test('are none for a node that gave nothing to a machine', () => {
        expect(waitingMachinesOf(tasks, 'elsewhere', () => undefined, { 'machine-b': WAITING })).toEqual([]);
    });
});
