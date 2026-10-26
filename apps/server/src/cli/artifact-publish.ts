import { stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { ARTIFACT_LIMITS } from '@ruimte/contracts';
import { parseRefusalBody } from '@adecore/agents/context';

const HELP_LINE = 'detail\truimte-context help artifact publish';
const USAGE_LINE = 'usage\tartifact publish\t--file <path> [--file <path> ...] [--title T] [--kind K] [--key K] [--request-id R]';

// A piece that met a dropped connection or another writer is asked about and sent again this often before the publish gives up.
const RETRIES = 3;

const REQUEST_ID = /^[A-Za-z0-9_-]{1,64}$/;

type PreparedPublish = { argv: string[] } | { refusal: { code: string; message: string; lines: string[] } } | { failure: string } | { unreachable: unknown };

interface UploadState {
    sizes: number[];
    done: { artifactId: string; versionId: string } | null;
}

function refusal(code: string, message: string, lines: string[] = [HELP_LINE]): PreparedPublish {
    return { refusal: { code, message, lines } };
}

/* Every value of a flag that may come more than once, and the words without it. */
function takeAll(argv: readonly string[], name: string): { values: string[]; rest: string[] } {
    const values: string[] = [];
    const rest: string[] = [];
    for (let i = 0; i < argv.length; i++) {
        const word = argv[i]!;
        if (word === `--${name}`) {
            values.push(argv[i + 1] ?? '');
            i++;
        } else if (word.startsWith(`--${name}=`)) {
            values.push(word.slice(name.length + 3));
        } else {
            rest.push(word);
        }
    }
    return { values, rest };
}

class UploadFailed extends Error {}

class UploadRefused extends Error {
    readonly code: string;

    constructor(code: string, message: string) {
        super(message);
        this.code = code;
    }
}

async function answer(response: Response): Promise<unknown> {
    if (response.ok) {
        return response.json();
    }
    const body = await response.text();
    const parsed = response.status === 422 ? parseRefusalBody(body) : null;
    if (parsed) {
        throw new UploadRefused(parsed.code, parsed.message);
    }
    throw new UploadFailed(`The daemon answered ${response.status}${body.trim() === '' ? '' : `: ${body.trim()}`}`);
}

/*
 * Sends one file from where the daemon says it stands, piece by piece. A piece the daemon did not
 * expect there, or a connection that dropped, is asked about again, so an interrupted publish goes on
 * where it stopped instead of starting over.
 */
async function sendFile(url: string, headers: Record<string, string>, index: number, path: string, size: number, from: number): Promise<void> {
    let offset = from;
    let retries = 0;
    // At least one piece, so an empty file arrives too.
    do {
        const piece = new Uint8Array(
            await Bun.file(path)
                .slice(offset, Math.min(offset + ARTIFACT_LIMITS.uploadChunkBytes, size))
                .arrayBuffer()
        );
        try {
            const sent = (await answer(await fetch(`${url}?file=${index}&offset=${offset}`, { method: 'PUT', headers, body: piece }))) as { size: number };
            offset = sent.size;
        } catch (e) {
            const again = e instanceof TypeError || (e instanceof UploadRefused && e.code === 'upload-mismatch');
            if (!again || retries >= RETRIES) {
                throw e;
            }
            retries++;
            const state = (await answer(await fetch(url, { headers }))) as UploadState;
            offset = state.sizes[index] ?? 0;
        }
    } while (offset < size);
}

/*
 * The words `artifact publish` sends, once its files are with the daemon: each read here, in the
 * agent's own process and sandbox, and sent in raw pieces under an upload named after the request
 * id, since the daemon never opens a path an agent names. Any other word is passed on.
 */
export async function prepareArtifactPublish(canvasUrl: string, argv: readonly string[], headers: Record<string, string>): Promise<PreparedPublish> {
    const { values: paths, rest } = takeAll(argv, 'file');
    if (paths.length === 0 || paths.some((path) => path === '')) {
        return refusal('bad-arguments', 'artifact publish needs --file <path> for each file, a file of your own', [USAGE_LINE, HELP_LINE]);
    }
    if (paths.length > ARTIFACT_LIMITS.filesPerVersion) {
        return refusal('too-large', `${paths.length} files were named and a version holds at most ${ARTIFACT_LIMITS.filesPerVersion}`);
    }
    const sizes: number[] = [];
    for (const path of paths) {
        const info = await stat(path).catch(() => null);
        if (!info?.isFile()) {
            return refusal('unreadable', `${path} could not be published: there is no regular file there that this process may read`);
        }
        sizes.push(info.size);
    }
    if (sizes.reduce((sum, size) => sum + size, 0) > ARTIFACT_LIMITS.versionBytes) {
        return refusal('too-large', 'These files are more than the 2 GiB a version holds together');
    }
    const given = takeAll(rest, 'request-id');
    const requestId = given.values[0] ?? `p${randomUUID().replaceAll('-', '')}`;
    if (!REQUEST_ID.test(requestId) || given.values.length > 1) {
        return refusal('bad-arguments', '--request-id takes one id of 1 to 64 letters, digits, dashes and underscores', [USAGE_LINE, HELP_LINE]);
    }
    const url = `${canvasUrl}/artifact-upload/${requestId}`;
    try {
        const state = (await answer(await fetch(`${url}?request=${requestId}`, { headers }))) as UploadState;
        if (state.done === null) {
            for (const [index, path] of paths.entries()) {
                const from = state.sizes[index];
                if (from !== undefined && from > sizes[index]!) {
                    return refusal(
                        'upload-mismatch',
                        `${path} is shorter than what an earlier run under this request id sent; publish it under another --request-id`
                    );
                }
                if (from === undefined || from < sizes[index]!) {
                    await sendFile(url, headers, index, path, sizes[index]!, from ?? 0);
                }
            }
        }
    } catch (e) {
        if (e instanceof UploadRefused) {
            return refusal(e.code, e.message);
        }
        return e instanceof UploadFailed ? { failure: e.message } : { unreachable: e };
    }
    const files = paths.map((path, index) => ({ name: basename(path), size: sizes[index]! }));
    return { argv: [...given.rest, `--request-id=${requestId}`, `--upload=${requestId}`, `--files=${JSON.stringify(files)}`] };
}
