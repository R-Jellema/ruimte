import { describe, expect, test } from 'bun:test';
import { FakeLanguageService } from '@adecore/editor-react/testing';
import { participateInSave, type SaveTarget } from './save-participation';

const uri = 'file:///work/app/src/a.ts';

function target(readOnly = false) {
    const service = new FakeLanguageService();
    const prepared: number[] = [];
    const language: SaveTarget = {
        editor: { isReadOnly: () => readOnly },
        service,
        uri,
        prepareSave: async (reason = 1) => {
            prepared.push(reason);
        }
    };

    return { service, prepared, language };
}

describe('participateInSave', () => {
    test("lets the servers edit the text before a person's save", async () => {
        const { service, prepared, language } = target();
        await participateInSave(language, 'manual');

        expect(prepared).toEqual([1]);
        expect(service.calls).toEqual([]);
    });

    test('only announces an autosave and a blur, with their reasons', async () => {
        const { service, prepared, language } = target();
        await participateInSave(language, 'afterDelay');
        await participateInSave(language, 'focusOut');

        expect(prepared).toEqual([]);
        expect(service.calls.map((call) => ({ method: call.method, params: call.params }))).toEqual([
            { method: 'textDocument/willSave', params: { reason: 2 } },
            { method: 'textDocument/willSave', params: { reason: 3 } }
        ]);
    });

    test('leaves a read-only editor alone', async () => {
        const { service, prepared, language } = target(true);
        await participateInSave(language, 'manual');
        await participateInSave(language, 'afterDelay');

        expect(prepared).toEqual([]);
        expect(service.calls).toEqual([]);
    });
});
