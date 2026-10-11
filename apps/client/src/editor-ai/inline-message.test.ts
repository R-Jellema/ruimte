import { describe, expect, test } from 'bun:test';
import { inlineMessage } from './inline-message';

describe('the message of a run', () => {
    test('names the file, fences the lines with a fence the code cannot close and lists the problems', () => {
        const message = inlineMessage({
            instruction: '  Make the threshold a parameter  ',
            path: 'src/score.ts',
            language: 'typescript',
            span: { startLine: 24, endLine: 30 },
            text: 'const a = `\n```\n`;\n',
            problems: [{ line: 28, severity: 'error', message: 'Type is wrong', code: 'ts 2345' }]
        });

        expect(message).toBe(
            [
                'Make the threshold a parameter',
                'File: @src/score.ts\nSelected lines src/score.ts:24-30:\n````typescript\nconst a = `\n```\n`;\n````',
                'Problems the language servers report on these lines:\n- line 28: error: Type is wrong (ts 2345)'
            ].join('\n\n')
        );
    });

    test('has no problem section without problems and no label for plain text', () => {
        const message = inlineMessage({ instruction: 'x', path: 'a.txt', language: null, span: { startLine: 1, endLine: 1 }, text: 'hi', problems: [] });

        expect(message).toBe('x\n\nFile: @a.txt\nSelected lines a.txt:1:\n```\nhi\n```');
    });
});
