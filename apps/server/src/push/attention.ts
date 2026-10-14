import { PushAttentionResultSchema, type PushAttentionEntry } from '@ruimte/contracts';
import type { z } from 'zod';
import { JsonFileStore } from '../json-file-store.ts';

const RETENTION_MS = 30 * 24 * 60 * 60_000;
const MAX_ENTRIES = 1000;

export class PushAttention {
    private readonly entries = new Map<string, PushAttentionEntry>();
    /*
     * The first moment this ledger ran on a version whose clients mark nodes from it. Entries from
     * before were only ever about notifications, and up to 30 days of them would otherwise all turn
     * into marks after an update.
     */
    readonly marksFrom: number;

    private readonly file: JsonFileStore<z.infer<typeof PushAttentionResultSchema>>;
    private readonly now: () => number;

    constructor(path?: string, now: () => number = Date.now) {
        this.file = new JsonFileStore(path, PushAttentionResultSchema, 'push attention starts empty');
        this.now = now;
        // A ledger that will not read only costs which notifications were read, never the start.
        const saved = this.file.read();
        for (const entry of saved?.entries ?? []) {
            this.entries.set(entry.nodeId, entry);
        }
        const marksFrom = saved?.marksFrom;
        this.marksFrom = marksFrom ?? this.now();
        this.prune();
        if (marksFrom === undefined) {
            this.save();
        }
    }

    snapshot(): PushAttentionEntry[] {
        this.prune();
        return [...this.entries.values()];
    }

    notify(nodeId: string): PushAttentionEntry {
        const previous = this.entries.get(nodeId);
        const entry = { nodeId, issuedAt: Math.max(this.now(), (previous?.issuedAt ?? 0) + 1), readThrough: previous?.readThrough ?? 0 };
        this.entries.set(nodeId, entry);
        this.save();
        return entry;
    }

    read(nodeId: string, issuedAt: number): PushAttentionEntry | null {
        const previous = this.entries.get(nodeId);
        // A delayed acknowledgment may clear an older turn, but never the next one.
        if (!previous || issuedAt > previous.issuedAt || issuedAt <= previous.readThrough) {
            return null;
        }
        const entry = { ...previous, readThrough: issuedAt };
        this.entries.set(nodeId, entry);
        this.save();
        return entry;
    }

    isRead(nodeId: string, issuedAt: number): boolean {
        return (this.entries.get(nodeId)?.readThrough ?? 0) >= issuedAt;
    }

    private prune(): void {
        for (const [id, entry] of this.entries) {
            if (entry.issuedAt < this.now() - RETENTION_MS) {
                this.entries.delete(id);
            }
        }
        while (this.entries.size > MAX_ENTRIES) {
            const oldest = [...this.entries.values()].sort((left, right) => left.issuedAt - right.issuedAt)[0]!;
            this.entries.delete(oldest.nodeId);
        }
    }

    private save(): void {
        this.prune();
        this.file.write({ entries: [...this.entries.values()], marksFrom: this.marksFrom });
    }
}
