import { EditorLanguage as SharedEditorLanguage, KEY_PRIORITY, realTimers, type Timers } from '@adecore/editor-react';
import type { Editor } from '@adecore/editor';
import { InlineEditFeature } from '@/editor-ai/inline-edit';
import { ExplainFeature } from './explain';
import { GhostTextFeature } from './ghost-text';
import { SelectionChatFeature } from './selection-chat';
import type { ProjectLanguage } from './ruimte-project-language';

export class EditorLanguage extends SharedEditorLanguage {
    declare readonly project: ProjectLanguage;
    readonly explain: ExplainFeature;
    readonly ghost: GhostTextFeature;
    readonly selectionChat: SelectionChatFeature;
    readonly inlineEdit: InlineEditFeature;

    constructor(project: ProjectLanguage, editor: Editor, uri: string, languageId: string, timers: Timers = realTimers) {
        super(project, editor, uri, languageId, timers);
        this.explain = new ExplainFeature(this);
        this.ghost = new GhostTextFeature(this, undefined, false);
        // Ruimte gives its ghost suggestion Tab before shared completion and snippet handlers.
        this.onDispose(this.onKey((event) => this.ghost.handleKey(event), KEY_PRIORITY.pick + 1));
        this.selectionChat = new SelectionChatFeature(this);
        this.inlineEdit = new InlineEditFeature(this);
    }
}
