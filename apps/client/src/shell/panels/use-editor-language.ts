import { createHolder, lspLanguageIdOf } from '@adecore/editor-react';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { storedPathOf } from '@ruimte/contracts';
import { pathToFileUri } from '@adecore/lsp';
import type { Editor } from '@adecore/editor';
import { EditorLanguage } from '@/language/ruimte-editor-language';
import { customLanguageIdOf } from '@/language/language-ids-host';
import { draftFiles } from '@/language/project-files';
import { acquireProjectLanguage } from '@/language/ruimte-project-language';
import { useEndpointId } from '@/state/keys';
import { useProject } from '@/state/project';
import { useTransport } from '@/transport/context';

/*
 * The language id of a file that no catalog server knows but a server of a person's own serves, once the
 * machine has said which servers the project has, and again when they change. Null while nothing serves it.
 */
function useOwnLanguageId(enabled: boolean, path: string, language: string | undefined): string | null {
    const transport = useTransport();
    const endpointId = useEndpointId();
    const projectId = useProject((s) => s.current?.projectId ?? null);
    const folder = useProject((s) => s.current?.folder ?? null);
    const holder = useMemo(() => createHolder<string>(), []);

    useEffect(() => {
        if (!enabled || projectId === null || folder === null) {
            return;
        }
        const held = acquireProjectLanguage(transport, projectId, folder, draftFiles(endpointId, transport, projectId));
        const stored = storedPathOf(folder, path);
        const read = (): void => holder.set(customLanguageIdOf(held.language.status.getSnapshot(), language, stored));
        read();
        const stop = held.language.status.subscribe(read);
        return () => {
            stop();
            holder.set(null);
            held.release();
        };
    }, [transport, endpointId, enabled, projectId, folder, path, language, holder]);

    return useSyncExternalStore(holder.subscribe, holder.get);
}

/*
 * The language servers' side of an open editor, or null where there is none: no project to run a
 * server in, or a file whose language no server here serves. The document stays open on the
 * daemon exactly as long as the editor lives.
 */
export function useEditorLanguage(editor: Editor | null, path: string, language: string | undefined): EditorLanguage | null {
    const transport = useTransport();
    const endpointId = useEndpointId();
    const projectId = useProject((s) => s.current?.projectId ?? null);
    const folder = useProject((s) => s.current?.folder ?? null);
    const holder = useMemo(() => createHolder<EditorLanguage>(), []);
    const builtIn = lspLanguageIdOf(language);
    const ownId = useOwnLanguageId(editor !== null && builtIn === null, path, language);
    const languageId = builtIn ?? ownId;

    useEffect(() => {
        if (editor === null || projectId === null || folder === null || languageId === null) {
            return;
        }
        const held = acquireProjectLanguage(transport, projectId, folder, draftFiles(endpointId, transport, projectId));
        const editorLanguage = new EditorLanguage(held.language, editor, pathToFileUri(path), languageId);
        holder.set(editorLanguage);
        return () => {
            holder.set(null);
            editorLanguage.dispose();
            held.release();
        };
    }, [transport, endpointId, editor, projectId, folder, path, languageId, holder]);

    return useSyncExternalStore(holder.subscribe, holder.get);
}
