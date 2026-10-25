import { describe, expect, test } from 'bun:test';
import { groupsBetweenItems } from './saved-groups';

function saved(name: string, createdAt: number, turnId?: string) {
    return { name, version: { createdAt, provenance: { maker: 'agent' as const, machineId: 'mac', ...(turnId === undefined ? {} : { turnId }) } } };
}

function names(groups: ReturnType<typeof groupsBetweenItems<ReturnType<typeof saved>>>): string[][] {
    return groups.map((group) => group.map((entry) => entry.name));
}

describe('which saved versions stand together in the thread', () => {
    test('versions of one turn stay one group, also with a command begun between them', () => {
        expect(names(groupsBetweenItems([saved('v2', 30, 't1'), saved('v1', 10, 't1')], [20]))).toEqual([['v1', 'v2']]);
    });

    test('versions of two turns split where a row of the thread began between them', () => {
        expect(names(groupsBetweenItems([saved('v1', 10, 't1'), saved('v2', 30, 't2')], [20]))).toEqual([['v1'], ['v2']]);
    });

    test('versions without a turn stand together while nothing began between them', () => {
        expect(names(groupsBetweenItems([saved('a', 10), saved('b', 15), saved('c', 30)], [20]))).toEqual([['a', 'b'], ['c']]);
    });
});
