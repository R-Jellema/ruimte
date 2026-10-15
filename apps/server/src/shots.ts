import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/* A shot is read once, by the agent that asked for it; a day later it is only a file nobody opens. */
const SHOT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/* A person saves a capture or a recording where they want it; the machine's copy is gone after a week. */
const CAPTURE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/* Under `$RUIMTE_HOME`, and one of the folders a client may read from there. */
export const DEVICE_CAPTURES_FOLDER = 'device-captures';

/* An id comes from the project file, so it never becomes a path of its own. */
function fileSafe(id: string): string {
    return id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'shot';
}

/* Files past their age, taken away as a new one is written, so nothing here grows without end. */
async function sweep(folder: string, now: number, maxAgeMs: number): Promise<void> {
    const oldest = now - maxAgeMs;
    const names = await readdir(folder).catch(() => []);
    for (const name of names) {
        const taken = Number(/-(\d+)\.(png|mp4)$/.exec(name)?.[1]);
        if (Number.isFinite(taken) && taken < oldest) {
            await rm(join(folder, name)).catch(() => undefined);
        }
    }
}

/* Writes a png an agent asked for under the machine's own folder, outside any project, and answers its path. */
export async function writeShot(home: string, id: string, image: Uint8Array): Promise<string> {
    const folder = join(home, 'screenshots');
    await mkdir(folder, { recursive: true });
    const now = Date.now();
    await sweep(folder, now, SHOT_MAX_AGE_MS);
    const path = join(folder, `${fileSafe(id)}-${now}.png`);
    await writeFile(path, image);
    return path;
}

/* A new file for a person's capture or recording of a device, which the client reads over `bytes.read`. */
export async function captureFile(home: string, id: string, extension: 'png' | 'mp4', now = Date.now()): Promise<string> {
    const folder = join(home, DEVICE_CAPTURES_FOLDER);
    await mkdir(folder, { recursive: true });
    await sweep(folder, now, CAPTURE_MAX_AGE_MS);
    return join(folder, `${fileSafe(id)}-${now}.${extension}`);
}

export async function writeCapture(home: string, id: string, image: Uint8Array, now = Date.now()): Promise<string> {
    const path = await captureFile(home, id, 'png', now);
    await writeFile(path, image);
    return path;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/* The size a png says it has in its header chunk, which comes first by the format's rule; null for anything else. */
export function pngSize(image: Uint8Array): { width: number; height: number } | null {
    if (image.byteLength < 24 || PNG_SIGNATURE.some((byte, index) => image[index] !== byte)) {
        return null;
    }
    const view = new DataView(image.buffer, image.byteOffset, image.byteLength);
    if (String.fromCharCode(...image.subarray(12, 16)) !== 'IHDR') {
        return null;
    }
    const width = view.getUint32(16);
    const height = view.getUint32(20);
    return width > 0 && height > 0 ? { width, height } : null;
}
