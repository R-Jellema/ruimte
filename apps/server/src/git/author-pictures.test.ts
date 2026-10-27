import { describe, expect, test } from 'bun:test';
import { AuthorPictures, readAuthors } from './author-pictures.ts';
import type { GhRunner } from './github.ts';

function fake(answer: { code?: number; stdout?: string; stderr?: string }): { run: GhRunner; calls: string[][] } {
    const calls: string[][] = [];
    const run: GhRunner = async (args) => {
        calls.push(args);
        return { code: answer.code ?? 0, stdout: answer.stdout ?? '', stderr: answer.stderr ?? '' };
    };
    return { run, calls };
}

describe('readAuthors', () => {
    test('links each address to the account GitHub gave its commits, once and in lowercase', async () => {
        const { run } = fake({
            stdout: JSON.stringify([
                { email: 'Ada@Example.com', id: 7 },
                { email: 'ada@example.com', id: 7 },
                { email: 'grace@example.com', id: 9 }
            ])
        });

        expect(await readAuthors(run, '/work')).toEqual([
            { email: 'ada@example.com', id: 7 },
            { email: 'grace@example.com', id: 9 }
        ]);
    });

    test('skips an entry without a usable address or id', async () => {
        const { run } = fake({ stdout: JSON.stringify([{ email: '', id: 7 }, { email: 'ada@example.com', id: 'x' }, { id: 3 }]) });

        expect(await readAuthors(run, '/work')).toEqual([]);
    });
});

describe('AuthorPictures', () => {
    test('asks gh once an hour per folder', async () => {
        let now = 0;
        const { run, calls } = fake({ stdout: JSON.stringify([{ email: 'ada@example.com', id: 7 }]) });
        const pictures = new AuthorPictures(run, () => now);

        await pictures.authorsOf('/work');
        now = 59 * 60_000;
        await pictures.authorsOf('/work');
        expect(calls).toHaveLength(1);

        now = 60 * 60_000;
        expect(await pictures.authorsOf('/work')).toEqual([{ email: 'ada@example.com', id: 7 }]);
        expect(calls).toHaveLength(2);
    });

    test('answers none for a folder gh cannot place on GitHub', async () => {
        const { run } = fake({ code: 1, stderr: 'none of the git remotes configured for this repository point to a known GitHub host' });

        expect(await new AuthorPictures(run, () => 0).authorsOf('/work')).toEqual([]);
    });
});
