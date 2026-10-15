import { BYTES_CHUNK_MAX, type GitBundlePayload, type GitFetchBundleResult } from '@ruimte/contracts';
import { readPiece } from '@/transport/piece';
import type { Transport } from '@/transport/transport';

/* What a bundle moves over: a machine to read it from and a machine to write it to. */
export type BundleSource = Pick<Transport, 'request' | 'readBytes'>;
export type BundleTarget = Pick<Transport, 'request'>;

function base64(bytes: Uint8Array): string {
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return btoa(binary);
}

/*
 * Reads a bundle one piece at a time from the machine that wrote it and hands each piece to the
 * machine that takes it in. A piece goes on only after the last one landed, and a transfer that
 * stops starts over from the first piece: the receiving machine takes offset 0 as a new start.
 */
export async function moveBundle(from: BundleSource, to: BundleTarget, bundleId: string, size: number, onSent?: (sent: number) => void): Promise<void> {
    for (let offset = 0; offset < size;) {
        const piece = await readPiece(from, { resource: { kind: 'bundle', bundleId }, offset, length: Math.min(BYTES_CHUNK_MAX, size - offset) });
        if (piece.size !== size || piece.bytes.byteLength === 0) {
            throw new Error('The bundle changed while it was being sent.');
        }
        const { received } = await to.request('git.bundlePut', { bundleId, offset, data: base64(piece.bytes), total: size });
        offset += piece.bytes.byteLength;
        if (received !== offset) {
            throw new Error('The other machine lost a piece of the bundle.');
        }
        onSent?.(offset);
    }
}

export interface Handoff {
    /* The machine the files are on and the one that takes them. */
    from: BundleSource;
    to: BundleTarget;
    /* What `git.bundle` is asked on `from`. */
    bundle: GitBundlePayload;
    /* The project on `to` the bundle is taken into, and the name of the branch it gets. */
    projectId: string;
    branch: string;
    into: 'worktree' | 'remote-ref';
    /* How `to` names the machine the bundle came from. */
    machine: string;
    /* Called once the size is known, before the first piece moves. */
    onSize?(size: number): void;
    onSent?(sent: number): void;
}

/* A checkout of one machine as a worktree (or a remote branch) of the other: bundle it, move it, take it in. */
export async function handOff(handoff: Handoff): Promise<GitFetchBundleResult> {
    const made = await handoff.from.request('git.bundle', handoff.bundle);
    handoff.onSize?.(made.size);
    await moveBundle(handoff.from, handoff.to, made.bundleId, made.size, handoff.onSent);
    return await handoff.to.request('git.fetchBundle', {
        projectId: handoff.projectId,
        bundleId: made.bundleId,
        sha256: made.sha256,
        branch: handoff.branch,
        into: handoff.into,
        machine: handoff.machine
    });
}
