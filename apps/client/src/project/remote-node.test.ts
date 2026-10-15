import { describe, expect, test } from 'bun:test';
import { createRemoteNode, type RemoteNodeSteps } from './remote-node';

function steps(log: string[], overrides: Partial<RemoteNodeSteps> = {}): RemoteNodeSteps {
    return {
        linked: false,
        bindThere: async () => void log.push('peer.bind'),
        linkHere: async () => void log.push('remote.link'),
        makeWorktree: async () => null,
        addNode: () => {
            log.push('add');
            return 'node-1';
        },
        removeNode: () => void log.push('remove'),
        save: async () => void log.push('save'),
        holdMirror: () => {
            log.push('hold');
            return () => log.push('release');
        },
        ...overrides
    };
}

describe('making a node on another machine', () => {
    test('links the machine, saves the node and only then lets the other machine hear of it', async () => {
        const log: string[] = [];
        expect(await createRemoteNode(steps(log))).toBe('node-1');
        expect(log).toEqual(['peer.bind', 'remote.link', 'hold', 'add', 'save', 'release']);
    });

    test('asks neither side again for a machine that links the project already', async () => {
        const log: string[] = [];
        await createRemoteNode(steps(log, { linked: true }));
        expect(log).toEqual(['hold', 'add', 'save', 'release']);
    });

    test('a save that is refused takes the node back out and still lets go of the mirror', async () => {
        const log: string[] = [];
        let attempts = 0;
        const refusing = steps(log, {
            save: async () => {
                log.push('save');
                attempts += 1;
                if (attempts === 1) {
                    throw new Error('refused');
                }
            }
        });
        await expect(createRemoteNode(refusing)).rejects.toThrow('refused');
        expect(log).toEqual(['peer.bind', 'remote.link', 'hold', 'add', 'save', 'remove', 'save', 'release']);
    });

    test('a link that fails makes no node', async () => {
        const log: string[] = [];
        await expect(
            createRemoteNode(
                steps(log, {
                    linkHere: async () => {
                        throw new Error('no');
                    }
                })
            )
        ).rejects.toThrow('no');
        expect(log).toEqual(['peer.bind']);
    });
});
