import { settleLanguage } from './settle.test';
import { beforeEach, describe, expect, test } from 'bun:test';
import { FakeEditorEngine } from '@adecore/editor/fake';
import { useToasts } from '@/state/toasts';
import { EditorLanguage } from './ruimte-editor-language';
import { FakeLanguageTransport } from './fake-daemon';
import { ProjectLanguage } from './ruimte-project-language';

const uri = 'file:///work/app/src/a.php';
const at = (line: number, character: number) => ({ line, character });
const range = (line: number) => ({ start: at(line, 4), end: at(line, 17) });
const item = { name: 'createSession', kind: 6, uri, range: range(1), selectionRange: range(1), data: { name: 'createSession' } };

async function setup(
    providers: Record<string, unknown> = { 'textDocument/prepareCallHierarchy': {}, 'callHierarchy/incomingCalls': {}, 'callHierarchy/outgoingCalls': {} }
) {
    const transport = new FakeLanguageTransport();
    transport.providers = providers;
    transport.answers.set('language.request', (payload) => {
        const method = (payload as { method: string }).method;
        return { result: method === 'textDocument/prepareCallHierarchy' ? [item] : [], server: 'php', version: 1 };
    });
    const project = new ProjectLanguage(transport, 'p1', '/work/app');
    const editor = new FakeEditorEngine().mount({} as HTMLElement, { text: '<?php\n    function createSession() {}\n', theme: 'light' });
    const language = new EditorLanguage(project, editor, uri, 'php');
    await language.document.ready;
    await settleLanguage();
    return { editor, language, transport };
}

beforeEach(() => {
    useToasts.setState({ toasts: [] });
});

describe('call hierarchy through the wire', () => {
    test('opens the tree for the symbol at the caret', async () => {
        const { editor, language } = await setup();
        editor.moveCaret(at(1, 8));
        await language.callHierarchy.open();
        expect(useToasts.getState().toasts).toEqual([]);
        expect(language.popups.getState().callHierarchy).toMatchObject({ name: 'createSession', direction: 'incoming' });
    });

    test('tells when the server of the document offers no call hierarchy', async () => {
        const { editor, language } = await setup({});
        editor.moveCaret(at(1, 8));
        await language.callHierarchy.open();
        expect(language.popups.getState().callHierarchy ?? null).toBeNull();
        expect(useToasts.getState().toasts).toMatchObject([{ kind: 'error' }]);
    });
});
