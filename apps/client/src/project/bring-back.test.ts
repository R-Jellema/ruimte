import { describe, expect, test } from 'bun:test';
import type { RequestMap, RequestType } from '@ruimte/contracts';
import { bringBack } from './bring-back';

function there(files: number, branch: string | null, log: Array<{ type: string; payload: unknown }>) {
    return {
        async request<T extends RequestType>(type: T, payload: RequestMap[T]['payload']): Promise<RequestMap[T]['result']> {
            log.push({ type, payload });
            if (type === 'git.status') {
                return { repo: true, branch, files: Array.from({ length: files }, (_value, i) => ({ path: `f${i}` })) } as never;
            }
            return { bundleId: 'bundle-one', size: 3, sha256: 'b'.repeat(64), commit: 'c9', base: null } as never;
        },
        async readBytes(payload: { offset: number }) {
            return { mime: 'x', size: 3, version: 'v', offset: payload.offset, bytes: new Uint8Array([1, 2, 3]) };
        }
    };
}

function here(log: Array<{ type: string; payload: unknown }>, features: RequestType[] = ['git.identity']) {
    return {
        connection: { features } as never,
        async request<T extends RequestType>(type: T, payload: RequestMap[T]['payload']): Promise<RequestMap[T]['result']> {
            log.push({ type, payload });
            if (type === 'git.identity') {
                return { identities: [{ path: '/work', rootCommits: ['r'], heads: ['h1', 'h2'] }] } as never;
            }
            if (type === 'git.bundlePut') {
                return { received: (payload as { offset: number }).offset + 3 } as never;
            }
            return { path: '/work-trees/atlas', branch: 'ruimte/atlas', commit: 'c9' } as never;
        }
    };
}

const REQUEST = { cwd: '/there/atlas', folder: '/work', projectId: 'atlas', machine: 'Studio', title: 'Agent' };

describe('bringBack', () => {
    test('a checkout with changes comes back as its files', async () => {
        const thereLog: Array<{ type: string; payload: unknown }> = [];
        await bringBack({ ...REQUEST, there: there(2, 'atlas', thereLog), here: here([]) });
        expect(thereLog.find((entry) => entry.type === 'git.bundle')?.payload).toMatchObject({ path: '/there/atlas', from: 'files', haves: ['h1', 'h2'] });
    });

    test('a clean checkout comes back as its branch, into a remote branch named after the machine', async () => {
        const thereLog: Array<{ type: string; payload: unknown }> = [];
        const hereLog: Array<{ type: string; payload: unknown }> = [];
        const result = await bringBack({ ...REQUEST, there: there(0, 'atlas', thereLog), here: here(hereLog) });
        expect(thereLog.find((entry) => entry.type === 'git.bundle')?.payload).toMatchObject({ from: 'branch', branch: 'atlas' });
        expect(hereLog.find((entry) => entry.type === 'git.fetchBundle')?.payload).toMatchObject({
            projectId: 'atlas',
            into: 'remote-ref',
            machine: 'Studio',
            branch: 'atlas'
        });
        expect(result).toMatchObject({ name: 'atlas', path: '/work-trees/atlas' });
    });

    test('a detached checkout comes back as its HEAD, named after the node', async () => {
        const thereLog: Array<{ type: string; payload: unknown }> = [];
        const result = await bringBack({ ...REQUEST, there: there(0, null, thereLog), here: here([]) });
        expect(thereLog.find((entry) => entry.type === 'git.bundle')?.payload).toMatchObject({ from: 'head' });
        expect(result.name).toBe('Agent');
    });

    test('a machine that names no git.identity is not asked for it and gets the whole history', async () => {
        const thereLog: Array<{ type: string; payload: unknown }> = [];
        const hereLog: Array<{ type: string; payload: unknown }> = [];
        await bringBack({ ...REQUEST, there: there(2, 'atlas', thereLog), here: here(hereLog, []) });
        expect(hereLog.some((entry) => entry.type === 'git.identity')).toBe(false);
        expect(thereLog.find((entry) => entry.type === 'git.bundle')?.payload).toMatchObject({ haves: [] });
    });
});
