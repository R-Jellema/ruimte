import { describe, expect, it } from 'bun:test';
import { mergeAnswers, mergeProviders } from './merge.ts';

describe('merging the answers of several servers', () => {
    it('concatenates suggestions in server order, says which server made each, and is incomplete when one list is', () => {
        const merged = mergeAnswers('textDocument/completion', [
            { server: 'typescript', result: [{ label: 'a' }] },
            { server: 'tailwind', result: { isIncomplete: true, items: [{ label: 'b' }, { label: 'c' }] } },
            { server: 'eslint', result: null }
        ]);
        expect(merged.result).toEqual({ isIncomplete: true, items: [{ label: 'a' }, { label: 'b' }, { label: 'c' }] });
        expect(merged.itemServers).toEqual(['typescript', 'tailwind', 'tailwind']);
    });

    it("materializes each server's list defaults before merging without overriding item fields", () => {
        const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 2 } };
        const insert = { ...range, end: { line: 0, character: 1 } };
        const first = {
            isIncomplete: false,
            itemDefaults: { editRange: range, insertTextFormat: 2, insertTextMode: 2, commitCharacters: [';'] },
            items: [
                { label: 'call', textEditText: 'call($1)' },
                { label: 'own', insertTextFormat: 1, insertTextMode: 1, commitCharacters: [], textEdit: { range: insert, newText: 'own' } }
            ]
        };
        const merged = mergeAnswers('textDocument/completion', [
            { server: 'typescript', result: first },
            {
                server: 'tailwind',
                result: {
                    isIncomplete: true,
                    itemDefaults: { editRange: { insert, replace: range }, insertTextFormat: 1 },
                    items: [{ label: 'flex', insertText: 'flex-row' }]
                }
            }
        ]);
        expect(merged).toEqual({
            result: {
                isIncomplete: true,
                items: [
                    {
                        label: 'call',
                        textEditText: 'call($1)',
                        insertTextFormat: 2,
                        insertTextMode: 2,
                        commitCharacters: [';'],
                        textEdit: { range, newText: 'call($1)' }
                    },
                    { label: 'own', insertTextFormat: 1, insertTextMode: 1, commitCharacters: [], textEdit: { range: insert, newText: 'own' } },
                    { label: 'flex', insertText: 'flex-row', insertTextFormat: 1, textEdit: { insert, replace: range, newText: 'flex' } }
                ]
            },
            itemServers: ['typescript', 'typescript', 'tailwind']
        });
        expect(first.items[0]).toEqual({ label: 'call', textEditText: 'call($1)' });
        expect(mergeAnswers('textDocument/completion', [{ server: 'host', result: merged.result, itemServers: merged.itemServers }])).toEqual(merged);
    });

    it('concatenates the actions, and is no answer when none had one', () => {
        expect(
            mergeAnswers('textDocument/codeAction', [
                { server: 'typescript', result: [{ title: 'Fix import' }] },
                { server: 'eslint', result: [{ title: 'Fix semi' }] }
            ])
        ).toEqual({ result: [{ title: 'Fix import' }, { title: 'Fix semi' }], itemServers: ['typescript', 'eslint'] });
        expect(
            mergeAnswers('textDocument/codeAction', [
                { server: 'typescript', result: null },
                { server: 'eslint', result: null }
            ]).result
        ).toBeNull();
    });

    it('puts the hovers of the servers one under the other as marked strings, with the first range', () => {
        const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 2 } };
        const merged = mergeAnswers('textDocument/hover', [
            { server: 'typescript', result: { contents: { kind: 'markdown', value: 'const a: number' }, range } },
            { server: 'css', result: null },
            { server: 'tailwind', result: { contents: { language: 'css', value: '.flex {}' } } }
        ]);
        expect(merged.result).toEqual({ contents: ['const a: number', { language: 'css', value: '.flex {}' }], range });
        expect(mergeAnswers('textDocument/hover', [{ server: 'css', result: null }]).result).toBeNull();
    });
});

describe('merging what the servers offer', () => {
    it('takes the first options of a feature that does not add up, and widens the ones that do', () => {
        const merged = mergeProviders([
            {
                'textDocument/definition': {},
                'textDocument/completion': { triggerCharacters: ['.'], resolveProvider: false },
                'textDocument/codeAction': { codeActionKinds: ['quickfix'] }
            },
            {
                'textDocument/definition': { other: true },
                'textDocument/completion': { triggerCharacters: ['.', '"'], resolveProvider: true },
                'textDocument/codeAction': { codeActionKinds: ['source.fixAll'] },
                'workspace/symbol': {}
            }
        ]);
        expect(merged['textDocument/definition']).toEqual({});
        expect(merged['textDocument/completion']).toEqual({ triggerCharacters: ['.', '"'], resolveProvider: true });
        expect(merged['textDocument/codeAction']).toEqual({ codeActionKinds: ['quickfix', 'source.fixAll'] });
        expect(merged['workspace/symbol']).toEqual({});
    });
});

it('dropping malformed items preserves the original per-item server ownership', () => {
    const merged = mergeAnswers('textDocument/completion', [
        { server: 'mixed', result: [{ label: 123 }, { label: 'valid' }], itemServers: ['typescript', 'eslint'] }
    ]);
    expect(merged).toEqual({ result: { isIncomplete: false, items: [{ label: 'valid' }] }, itemServers: ['eslint'] });
});

describe('merging links and colors', () => {
    const range = (line: number) => ({ start: { line, character: 0 }, end: { line, character: 4 } });

    it('concatenates links in server order and names the process of each', () => {
        const merged = mergeAnswers('textDocument/documentLink', [
            { server: 'html', result: [{ range: range(0) }, { range: range(1) }] },
            { server: 'tailwind', result: null },
            { server: 'eslint', result: [{ range: range(2) }] }
        ]);

        expect(merged.result).toEqual([{ range: range(0) }, { range: range(1) }, { range: range(2) }]);
        expect(merged.itemServers).toEqual(['html', 'html', 'eslint']);
    });

    it('drops a color whose range a server before it already took', () => {
        const red = { red: 1, green: 0, blue: 0, alpha: 1 };
        const blue = { red: 0, green: 0, blue: 1, alpha: 1 };
        const merged = mergeAnswers('textDocument/documentColor', [
            { server: 'css', result: [{ range: range(0), color: red }] },
            {
                server: 'tailwind',
                result: [
                    { range: range(0), color: blue },
                    { range: range(1), color: blue }
                ]
            }
        ]);

        expect(merged.result).toEqual([
            { range: range(0), color: red },
            { range: range(1), color: blue }
        ]);
        expect(merged.itemServers).toEqual(['css', 'tailwind']);
    });

    it('answers null when no server had any', () => {
        expect(mergeAnswers('textDocument/documentColor', [{ server: 'css', result: null }]).result).toBeNull();
    });
});
