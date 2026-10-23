import { describe, expect, test } from 'bun:test';
import { BYTES_CHUNK_MAX, type RequestMap, type RequestType } from '@ruimte/contracts';
import { handOff, moveBundle, type BundleSource, type BundleTarget, type Handoff } from './bundle-transfer';

const BUNDLE = new Uint8Array(600_000).map((_value, i) => i % 251);

function source(log: string[], untrusted = false): BundleSource {
    return {
        async request(type) {
            log.push(type);
            if (type === 'git.bundle') {
                return {
                    bundleId: 'bundle-one',
                    size: BUNDLE.length,
                    sha256: 'a'.repeat(64),
                    commit: 'c1',
                    base: null,
                    ...(untrusted ? { untrusted: true } : {})
                } as never;
            }
            throw new Error(`unexpected ${type}`);
        },
        async readBytes(payload) {
            log.push(`read ${payload.offset}+${payload.length}`);
            return {
                mime: 'application/x-git-bundle',
                size: BUNDLE.length,
                version: 'v1',
                offset: payload.offset,
                bytes: BUNDLE.slice(payload.offset, payload.offset + payload.length)
            };
        }
    };
}

function target(log: string[], received: Uint8Array[], fetched: unknown[] = []): BundleTarget {
    return {
        async request<T extends RequestType>(type: T, payload: RequestMap[T]['payload']): Promise<RequestMap[T]['result']> {
            log.push(type);
            if (type === 'git.fetchBundle') {
                fetched.push(payload);
            }
            if (type === 'git.bundlePut') {
                const put = payload as RequestMap['git.bundlePut']['payload'];
                const piece = Uint8Array.from(atob(put.data), (character) => character.charCodeAt(0));
                received.push(piece);
                return { received: put.offset + piece.length } as never;
            }
            return { path: '/there/worktree', branch: 'ruimte/atlas', commit: 'c1' } as never;
        }
    };
}

describe('moveBundle', () => {
    test('moves 600 KB in three pieces that add up to the bundle, each one after the last landed', async () => {
        const log: string[] = [];
        const received: Uint8Array[] = [];
        const sent: number[] = [];

        await moveBundle(source(log), target(log, received), 'bundle-one', BUNDLE.length, (bytes) => sent.push(bytes));

        expect(received).toHaveLength(3);
        expect(received.map((piece) => piece.length)).toEqual([BYTES_CHUNK_MAX, BYTES_CHUNK_MAX, BUNDLE.length - 2 * BYTES_CHUNK_MAX]);
        expect(Buffer.concat(received)).toEqual(Buffer.from(BUNDLE));
        expect(sent).toEqual([BYTES_CHUNK_MAX, 2 * BYTES_CHUNK_MAX, BUNDLE.length]);
        expect(log).toEqual([
            `read 0+${BYTES_CHUNK_MAX}`,
            'git.bundlePut',
            `read ${BYTES_CHUNK_MAX}+${BYTES_CHUNK_MAX}`,
            'git.bundlePut',
            `read ${2 * BYTES_CHUNK_MAX}+${BUNDLE.length - 2 * BYTES_CHUNK_MAX}`,
            'git.bundlePut'
        ]);
    });

    test('stops before putting a second piece when the bundle size changes', async () => {
        const log: string[] = [];
        const received: Uint8Array[] = [];
        const original = source(log);
        let reads = 0;
        const changing: BundleSource = {
            ...original,
            readBytes: async (payload) => {
                const piece = await original.readBytes!(payload);
                return { ...piece, size: ++reads === 1 ? BUNDLE.length : BUNDLE.length + 1 };
            }
        };
        await expect(moveBundle(changing, target(log, received), 'bundle-one', BUNDLE.length)).rejects.toThrow('changed');
        expect(reads).toBe(2);
        expect(received).toHaveLength(1);
        expect(received[0]).toEqual(BUNDLE.slice(0, BYTES_CHUNK_MAX));
        expect(log).toEqual([`read 0+${BYTES_CHUNK_MAX}`, 'git.bundlePut', `read ${BYTES_CHUNK_MAX}+${BYTES_CHUNK_MAX}`]);
    });

    test('stops when the other machine did not keep a piece', async () => {
        const forgetful: BundleTarget = { request: async () => ({ received: 0 }) as never };
        await expect(moveBundle(source([]), forgetful, 'bundle-one', BUNDLE.length)).rejects.toThrow('lost');
    });
});

describe('handOff', () => {
    test('bundles on one machine, moves it, and takes it in on the other with the hash it was written with', async () => {
        const log: string[] = [];
        const fetched: unknown[] = [];
        const result = await handOff({
            from: source(log),
            to: target(log, [], fetched),
            bundle: { path: '/here', from: 'files', haves: [], name: 'Handoff' },
            projectId: 'there-project',
            branch: 'atlas',
            into: 'worktree',
            machine: 'Studio'
        });
        expect(result.path).toBe('/there/worktree');
        expect(log[0]).toBe('git.bundle');
        expect(log.at(-1)).toBe('git.fetchBundle');
        expect(fetched).toEqual([
            { projectId: 'there-project', bundleId: 'bundle-one', sha256: 'a'.repeat(64), branch: 'atlas', into: 'worktree', machine: 'Studio' }
        ]);
    });

    test('tells the machine that takes it in that the machine it came from never vouched for it, and says nothing otherwise', async () => {
        const fetched: unknown[] = [];
        const handoff: Omit<Handoff, 'from' | 'to'> = {
            bundle: { path: '/here', from: 'files', haves: [], name: 'Handoff' },
            projectId: 'p',
            branch: 'atlas',
            into: 'worktree',
            machine: 'Studio'
        };
        await handOff({ ...handoff, from: source([]), to: target([], [], fetched) });
        await handOff({ ...handoff, from: source([], true), to: target([], [], fetched) });

        expect(fetched.map((payload) => (payload as { untrusted?: boolean }).untrusted)).toEqual([undefined, true]);
    });
});
