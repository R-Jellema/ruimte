import i18next from 'i18next';
import { useEffect, useState } from 'react';
import type { ByteResource } from '@ruimte/contracts';
import { credentialFor } from '@/endpoint/credentials';
import { endpointById, useEndpoints } from '@/state/endpoints';
import { transportFor } from '@/transport';
import { BlobCache, type BlobLease, type BlobState } from './blob-cache';
import { readResource } from './byte-transfer';
import { readPiece } from './piece';
import { bytesStreamUrl } from './bytes-stream';
import { bytesWorkerReady } from './bytes-worker-host';
import { useEndpointConnection } from './status';

/*
 * Bytes a machine serves that something on screen draws, with what pins one version of them: an
 * attachment id never changes, a project icon has a version, and a file has its mtime and size. Media
 * (a video or sound) is a file a player reads in ranges, which over a direct connection is never loaded
 * whole.
 */
export type MachineResource =
    | { kind: 'attachment'; chatId: string; attachmentId: string }
    | { kind: 'projectIcon'; projectId: string; theme: 'light' | 'dark'; version: string }
    | { kind: 'file'; path: string; mtime: number; size: number }
    | { kind: 'media'; path: string; mtime: number; size: number }
    // An entry of the archive at `path`, pinned by the archive's own mtime and size.
    | { kind: 'archive-entry'; path: string; entry: string; mtime: number; size: number };

export type MachineUrl = BlobState;

// Enough for a chat full of screenshots to scroll back without a refetch; what is on screen does not count.
const IDLE_BYTES = 64 * 1024 * 1024;

const cache = new BlobCache({ maxIdleBytes: IDLE_BYTES });

const NOTHING: MachineUrl = { url: null, failure: null };

/*
 * The credential rides in the URL since an `<img>` cannot send a header, and so does the version, so
 * the browser keeps the answer for good. The machine is the one the thing on screen belongs to, never
 * simply the active one. Null for a machine this client no longer knows.
 */
export function httpUrlFor(endpointId: string, resource: MachineResource): string | null {
    const endpoint = endpointById(endpointId);
    // An entry is unpacked by the machine whole, so it has no route of its own and always comes as pieces.
    if (!endpoint || resource.kind === 'archive-entry') {
        return null;
    }
    const credential = credentialFor(endpoint);
    if (resource.kind === 'attachment') {
        const query = credential ? `?token=${encodeURIComponent(credential)}` : '';
        return `${endpoint.httpBaseUrl}/attachments/${encodeURIComponent(resource.chatId)}/${encodeURIComponent(resource.attachmentId)}${query}`;
    }
    const query =
        resource.kind === 'projectIcon'
            ? new URLSearchParams({ v: resource.version, theme: resource.theme })
            : new URLSearchParams({ path: resource.path, v: `${resource.mtime}-${resource.size}` });
    if (credential) {
        query.set('token', credential);
    }
    if (resource.kind === 'projectIcon') {
        return `${endpoint.httpBaseUrl}/projects/${encodeURIComponent(resource.projectId)}/icon?${query.toString()}`;
    }
    return `${endpoint.httpBaseUrl}/fs/file?${query.toString()}`;
}

function wireResourceOf(resource: MachineResource): ByteResource {
    if (resource.kind === 'attachment') {
        return { kind: 'attachment', chatId: resource.chatId, attachmentId: resource.attachmentId };
    }
    if (resource.kind === 'projectIcon') {
        return { kind: 'projectIcon', projectId: resource.projectId, theme: resource.theme };
    }
    if (resource.kind === 'archive-entry') {
        return { kind: 'file', path: resource.path, entry: resource.entry };
    }
    return { kind: 'file', path: resource.path };
}

/* A file's bytes whole, for something that reads them rather than draws them, over the same way `useMachineUrl` picks. */
export async function readMachineFile(
    endpointId: string,
    file: { path: string; mtime: number; size: number; entry?: string },
    maxBytes: number
): Promise<ArrayBuffer> {
    if (endpointById(endpointId)?.direct === true || file.entry !== undefined) {
        const transport = transportFor(endpointId);
        if (!transport) {
            throw new Error(i18next.t('machines:connection.unknownMachine'));
        }
        const resource: ByteResource = file.entry === undefined ? { kind: 'file', path: file.path } : { kind: 'file', path: file.path, entry: file.entry };
        const blob = await readResource((piece) => readPiece(transport, piece), resource, { maxBytes });
        return blob.arrayBuffer();
    }
    const url = httpUrlFor(endpointId, { kind: 'file', ...file });
    if (url === null) {
        throw new Error(i18next.t('machines:connection.unknownMachine'));
    }
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    return response.arrayBuffer();
}

export function machineResourceKey(endpointId: string, resource: MachineResource): string {
    if (resource.kind === 'attachment') {
        return JSON.stringify([endpointId, resource.kind, resource.chatId, resource.attachmentId]);
    }
    if (resource.kind === 'projectIcon') {
        return JSON.stringify([endpointId, resource.kind, resource.projectId, resource.theme, resource.version]);
    }
    if (resource.kind === 'archive-entry') {
        return JSON.stringify([endpointId, resource.kind, resource.path, resource.entry, resource.mtime, resource.size]);
    }
    return JSON.stringify([endpointId, resource.kind, resource.path, resource.mtime, resource.size]);
}

/*
 * The one way something on screen turns bytes on a machine into a URL. Over a socket that is the HTTP
 * route. Across two networks a direct connection has no HTTP to count on, so the bytes come over the
 * channel into a blob URL from a shared cache, tried again when the connection opens. Media streams
 * through the bytes worker instead, and falls back to a blob while the worker does not control the page.
 */
export function useMachineUrl(resource: MachineResource | null, endpointId?: string): MachineUrl {
    const activeId = useEndpoints((s) => s.activeId);
    const machineId = endpointId ?? activeId;
    const direct = useEndpoints((s) => s.endpoints.find((entry) => entry.id === machineId)?.direct === true);
    // One way per kind: an archive entry comes in pieces over any link, everything else over HTTP unless the link is direct.
    const pieced = direct || resource?.kind === 'archive-entry';
    const open = useEndpointConnection(machineId).status === 'open';
    const key = resource === null ? null : machineResourceKey(machineId, resource);
    // What the request asks for, as a string, so the dependency is stable where `resource` is a new object on every render.
    const wire = resource === null ? null : JSON.stringify(wireResourceOf(resource));
    const [held, setHeld] = useState<{ key: string; lease: BlobLease; state: MachineUrl } | null>(null);
    // Once per mount, so a worker that takes control halfway does not swap the source under a player.
    const [workerReady] = useState(bytesWorkerReady);
    const streamed = direct && workerReady && resource?.kind === 'media';

    useEffect(() => {
        if (!pieced || streamed || key === null || wire === null) {
            return;
        }
        const payload = JSON.parse(wire) as ByteResource;
        const lease = cache.acquire(key, () => {
            const transport = transportFor(machineId);
            if (!transport) {
                return Promise.reject(new Error(i18next.t('machines:connection.unknownMachine')));
            }
            return readResource((piece) => readPiece(transport, piece), payload);
        });
        const update = (): void => setHeld({ key, lease, state: lease.current() });
        update();
        const unsubscribe = lease.subscribe(update);
        return () => {
            unsubscribe();
            lease.release();
            setHeld((current) => (current?.lease === lease ? null : current));
        };
    }, [pieced, streamed, key, wire, machineId]);

    const lease = held !== null && held.key === key ? held.lease : null;
    useEffect(() => {
        if (open) {
            lease?.retry();
        }
    }, [open, lease]);

    if (resource === null) {
        return NOTHING;
    }
    if (!pieced) {
        const url = httpUrlFor(machineId, resource);
        return url === null ? { url: null, failure: i18next.t('machines:connection.unknownMachine') } : { url, failure: null };
    }
    if (streamed && resource.kind === 'media') {
        return { url: bytesStreamUrl({ machine: machineId, path: resource.path, mtime: resource.mtime, size: resource.size }), failure: null };
    }
    return held !== null && held.key === key ? held.state : NOTHING;
}
