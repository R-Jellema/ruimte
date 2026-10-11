import { mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import { isNotFound } from '@adecore/agents/fs';
import { PROJECT_WRITE_IO, type ProjectWriteIO } from './project-write.ts';

const IntentSchema = z.object({
    version: z.literal(1),
    files: z.array(z.object({ path: z.string(), before: z.string().nullable(), after: z.string().nullable() }))
});

/* `null` before means the file is absent; `null` after means it is left as it is. */
export interface PairedFile {
    path: string;
    before: string | null;
    after: string | null;
}

/* A file moved under a write before its first byte was written: nothing changed, so nothing waits on recovery. */
export class PairedWriteRaced extends Error {}

/* An interrupted write that cannot finish without overwriting an edit made since. */
export class PairedWriteStuck extends Error {}

async function textAt(path: string): Promise<string | null> {
    try {
        return await readFile(path, 'utf8');
    } catch (e) {
        if (isNotFound(e)) {
            return null;
        }
        throw e;
    }
}

async function apply(intentPath: string, files: readonly PairedFile[], io: ProjectWriteIO): Promise<void> {
    for (const file of files) {
        if (file.after !== null && (await textAt(file.path)) !== file.after) {
            await mkdir(dirname(file.path), { recursive: true });
            await io.write(file.path, file.after, 0o644, { durable: true });
        }
    }
    await io.remove(intentPath);
}

async function moved(files: readonly PairedFile[], accepts: (current: string | null, file: PairedFile) => boolean): Promise<PairedFile | null> {
    for (const file of files) {
        if (!accepts(await textAt(file.path), file)) {
            return file;
        }
    }
    return null;
}

/*
 * Writes files that belong together so that a crash leaves them all before or all after. The intent
 * is durable before the first file changes; recovery finishes it forward. The files are written in the
 * order given, so the one that carries a revision goes last.
 */
export async function writePaired(intentPath: string, files: readonly PairedFile[], io: ProjectWriteIO = PROJECT_WRITE_IO): Promise<void> {
    await mkdir(dirname(intentPath), { recursive: true });
    await io.write(intentPath, JSON.stringify({ version: 1, files }), 0o600, { durable: true });
    if ((await moved(files, (current, file) => current === file.before)) !== null) {
        await io.remove(intentPath);
        throw new PairedWriteRaced('The files changed on disk while they were saved; nothing was written');
    }
    await apply(intentPath, files, io);
}

/* Finishes an interrupted `writePaired`, unless a file was edited since; then it says which intent to delete. */
export async function recoverPaired(intentPath: string, io: ProjectWriteIO = PROJECT_WRITE_IO): Promise<'none' | 'recovered'> {
    const text = await textAt(intentPath);
    if (text === null) {
        return 'none';
    }
    const { files } = IntentSchema.parse(JSON.parse(text));
    const edited = await moved(files, (current, file) => current === file.before || current === file.after);
    if (edited !== null) {
        throw new PairedWriteStuck(`${edited.path} changed since an interrupted save started. Delete ${intentPath} to keep the files as they are now.`);
    }
    await apply(intentPath, files, io);
    return 'recovered';
}
