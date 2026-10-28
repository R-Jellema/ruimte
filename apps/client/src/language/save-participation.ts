import type { Editor } from '@adecore/editor';
import type { LanguageService, TextDocumentSaveReason } from '@adecore/lsp';
import type { DraftSaveReason } from '@/state/text-drafts';

export interface SaveTarget {
    readonly editor: Pick<Editor, 'isReadOnly'>;
    readonly service: Pick<LanguageService, 'willSave'>;
    readonly uri: string;
    prepareSave(reason?: TextDocumentSaveReason): Promise<void>;
}

/*
 * What the language servers do before a draft is written. Only a person's save takes the edits a server wants
 * made first; autosave and a blur only tell the servers a save is coming, so nothing moves under the caret.
 */
export function participateInSave(language: SaveTarget, reason: DraftSaveReason): Promise<void> {
    if (language.editor.isReadOnly?.() === true) {
        return Promise.resolve();
    }

    if (reason === 'manual') {
        return language.prepareSave(1);
    }

    void language.service.willSave?.(language.uri, reason === 'afterDelay' ? 2 : 3);

    return Promise.resolve();
}
