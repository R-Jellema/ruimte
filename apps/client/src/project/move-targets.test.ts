import { describe, expect, test } from 'bun:test';
import type { ProjectSummary } from '@ruimte/contracts';
import type { Endpoint } from '../state/endpoints';
import type { ProjectRow } from '../state/project-list';
import { moveTargetsOf } from './move-targets';

function summary(projectId: string, patch: Partial<ProjectSummary> = {}): ProjectSummary {
    return {
        projectId,
        name: projectId,
        color: '#000',
        folder: `/repo/${projectId}`,
        lastOpenedAt: 0,
        closedAt: null,
        available: true,
        icon: { kind: 'initial', value: projectId[0]!.toUpperCase() },
        nameSource: 'chosen',
        ...patch
    };
}

function endpoint(id: string): Endpoint {
    return { id, label: id, httpBaseUrl: `http://${id}`, wsBaseUrl: `ws://${id}`, reachability: 'lan', daemonId: id, daemonPublicKey: null };
}

const endpoints = [endpoint('a'), endpoint('b')];

function rows(endpointId: string, ...summaries: ProjectSummary[]): ProjectRow[] {
    return summaries.map((entry) => ({ endpointId, summary: entry }));
}

describe('where a chat can move without a dialog', () => {
    test('names the projects touched last, five at most', () => {
        const all = Array.from({ length: 7 }, (_, i) => summary(`p${i}`, { lastOpenedAt: i }));
        expect(moveTargetsOf(rows('a', ...all), endpoints, 'a').map((entry) => entry.projectId)).toEqual(['p6', 'p5', 'p4', 'p3', 'p2']);
    });

    test('leaves out the Chats project, a project whose folder is gone and the projects of another machine', () => {
        const list = [
            ...rows(
                'a',
                summary('chats', { scratch: true, lastOpenedAt: 9 }),
                summary('gone', { available: false, lastOpenedAt: 8 }),
                summary('kept', { lastOpenedAt: 1 })
            ),
            ...rows('b', summary('elsewhere', { lastOpenedAt: 7 }))
        ];
        expect(moveTargetsOf(list, endpoints, 'a').map((entry) => entry.projectId)).toEqual(['kept']);
    });

    test('puts a project that was just closed where its touch puts it', () => {
        const list = rows('a', summary('open', { lastOpenedAt: 5 }), summary('closed', { lastOpenedAt: 1, closedAt: 9 }));
        expect(moveTargetsOf(list, endpoints, 'a').map((entry) => entry.projectId)).toEqual(['closed', 'open']);
    });

    test('names nothing for a machine this client does not know', () => {
        expect(moveTargetsOf(rows('c', summary('p1')), endpoints, 'c')).toEqual([]);
    });
});
