import { CodedError } from '@adecore/agents';
import { ARTIFACT_LIMITS } from '@ruimte/contracts';
import type { Artifacts } from '../artifacts/artifacts.ts';
import { errorText } from '../error-text.ts';
import { bearerCaller, CANVAS_PATH, refusal } from './canvas-route.ts';

export const ARTIFACT_UPLOAD_PATH = `${CANVAS_PATH}/artifact-upload`;

// A piece and room for nothing else: the body is the bytes as they are.
export const ARTIFACT_UPLOAD_BODY_BYTES = ARTIFACT_LIMITS.uploadChunkBytes;

const UPLOAD_ID = /^[A-Za-z0-9_-]{1,64}$/;

interface UploadRouteDeps {
    targetForToken(token: string): string | null;
    artifacts: Pick<Artifacts, 'uploadState' | 'uploadAppend'>;
}

function uploadRefusal(code: string, message: string): Response {
    return refusal(code, message, ['detail\truimte-context help artifact publish']);
}

function wholeNumber(value: string | null): number | null {
    const number = Number(value);
    return value !== null && value !== '' && Number.isSafeInteger(number) && number >= 0 ? number : null;
}

/*
 * `GET /canvas/artifact-upload/<upload>` says what an agent's upload holds so far, and `PUT` with
 * `?file=N&offset=O` adds a piece of raw bytes to it. The same bearer as every verb, so an upload is
 * the session's own; `artifact publish` then turns it into a version.
 */
export async function handleArtifactUpload(request: Request, url: URL, deps: UploadRouteDeps): Promise<Response> {
    const caller = bearerCaller(request, deps.targetForToken);
    if (!caller) {
        return new Response('Unknown token', { status: 401 });
    }
    const upload = url.pathname.slice(ARTIFACT_UPLOAD_PATH.length + 1);
    if (!UPLOAD_ID.test(upload)) {
        return uploadRefusal('bad-arguments', 'An upload id is 1 to 64 letters, digits, dashes and underscores');
    }
    try {
        if (request.method === 'GET') {
            return Response.json(await deps.artifacts.uploadState(caller, upload, url.searchParams.get('request')));
        }
        if (request.method !== 'PUT') {
            return new Response('Method not allowed', { status: 405 });
        }
        const file = wholeNumber(url.searchParams.get('file'));
        const offset = wholeNumber(url.searchParams.get('offset'));
        if (file === null || offset === null) {
            return uploadRefusal('bad-arguments', 'A piece names its file and offset as whole numbers');
        }
        const bytes = new Uint8Array(await request.arrayBuffer());
        // A body sent without a length stops only at the server's ceiling.
        if (bytes.byteLength > ARTIFACT_UPLOAD_BODY_BYTES) {
            return uploadRefusal('too-large', `A piece is at most ${ARTIFACT_UPLOAD_BODY_BYTES} bytes`);
        }
        return Response.json({ size: await deps.artifacts.uploadAppend(caller, upload, file, offset, bytes) });
    } catch (e) {
        if (e instanceof CodedError) {
            return uploadRefusal(e.code, e.message);
        }
        console.error('An artifact upload failed:', errorText(e));
        return new Response('The upload failed', { status: 500 });
    }
}
