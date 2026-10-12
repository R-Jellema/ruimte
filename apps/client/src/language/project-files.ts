import i18next from 'i18next';
import { draftPathsUnder, forgetDeleted, moveFile } from '@/state/file-moves';
import { endpointKey } from '@/state/keys';
import { textDrafts, type TextDrafts } from '@/state/text-drafts';
import { useToasts } from '@/state/toasts';
import type { Transport } from '@/transport/transport';
import type { ProjectFiles, StagedFile } from '@adecore/editor-react';

/* How many files a toast names before it says how many more there are. */
const NAMED_FILES = 3;

function nameOf(path: string): string {
    return path.slice(path.lastIndexOf('/') + 1);
}

/* The files of one machine as the editors keep their text: a draft where there is one, and otherwise what the machine has. */
export function draftFiles(endpointId: string, transport: Transport, projectId: string | null = null, drafts: TextDrafts = textDrafts): ProjectFiles {
    const isFolder = async (path: string): Promise<boolean> => {
        try {
            await transport.request('fs.list', { path, depth: 1 });
            return true;
        } catch {
            return false;
        }
    };
    /* Paths that took an unsaved draft along in a move: the move saved it, so the mtime a read of it gave is out of date. */
    const savedByMove = new Set<string>();
    const diskOf = async (file: StagedFile): Promise<StagedFile['disk']> => {
        if (!savedByMove.delete(file.path)) {
            return file.disk;
        }
        try {
            const read = await transport.request('fs.read', { path: file.path });
            return read.kind === 'text' ? { text: read.text, mtime: read.mtime } : file.disk;
        } catch {
            return file.disk;
        }
    };
    return {
        read: async (path) => {
            const draft = drafts.draft(endpointId, path);
            if (draft !== undefined) {
                return { text: draft.text, mtime: draft.mtime };
            }
            try {
                const read = await transport.request('fs.read', { path });
                return read.kind === 'text' ? { text: read.text, mtime: read.mtime } : null;
            } catch {
                return null;
            }
        },
        save: async (files) => {
            for (const file of files) {
                drafts.stage(endpointId, file.path, await diskOf(file), file.text);
                if (!(await drafts.save(endpointId, file.path))) {
                    return i18next.t('panels:language.edit.notSaved', { name: nameOf(file.path) });
                }
            }
            return null;
        },
        rename: async (from, to) => {
            try {
                const unsaved = draftPathsUnder(endpointId, from, true);
                await moveFile(transport, endpointId, projectId, from, to, { edits: false, focus: true }, drafts);
                unsaved.forEach((path) => savedByMove.add(to + path.slice(from.length)));
                return null;
            } catch (error) {
                return error instanceof Error ? error.message : String(error);
            }
        },
        create: async (path, text) => {
            try {
                await transport.request('fs.create', { path, kind: 'file', text });
                return null;
            } catch (error) {
                return error instanceof Error ? error.message : String(error);
            }
        },
        delete: async (path) => {
            try {
                await transport.request('fs.delete', { path });
                forgetDeleted(endpointId, path);
                return null;
            } catch (error) {
                return error instanceof Error ? error.message : String(error);
            }
        },
        isUnsaved: (path) => draftPathsUnder(endpointId, path, true).length > 0,
        isFolder,
        exists: async (path) => {
            try {
                await transport.request('fs.read', { path });
                return true;
            } catch {
                return isFolder(path);
            }
        },
        stage: (files: readonly StagedFile[]) => {
            for (const file of files) {
                drafts.stage(endpointId, file.path, file.disk, file.text);
            }
            const names = files.slice(0, NAMED_FILES).map((file) => nameOf(file.path));
            const more = files.length - names.length;
            useToasts.getState().show({
                id: `language-staged-${endpointKey(endpointId, files[0]!.path)}`,
                kind: 'success',
                persist: true,
                title: i18next.t('panels:language.edit.staged', { count: files.length }),
                description: more > 0 ? i18next.t('panels:language.edit.stagedMore', { names: names.join(', '), count: more }) : names.join(', '),
                action: {
                    label: i18next.t('panels:language.edit.saveAll'),
                    run: () => {
                        for (const file of files) {
                            void drafts.save(endpointId, file.path);
                        }
                    }
                }
            });
        }
    };
}
