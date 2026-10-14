import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeProjectSlug } from '@adecore/agents/chat';
import { moveClaudeTranscript } from './claude-move.ts';

const SESSION = '0b6f2c1e-1111-4222-8333-444455556666';

let projectsDir: string;
let scratch: string;
let project: string;

beforeEach(async () => {
    projectsDir = await mkdtemp(join(tmpdir(), 'ruimte-claude-move-'));
    scratch = '/home/bas/.ruimte/scratch/chat-1';
    project = '/home/bas/vinyl';
});

afterEach(async () => {
    await rm(projectsDir, { recursive: true, force: true });
});

async function transcript(cwd: string, withSubagents: boolean): Promise<string> {
    const dir = join(projectsDir, claudeProjectSlug(cwd));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${SESSION}.jsonl`), '{"type":"user"}\n');
    if (withSubagents) {
        await mkdir(join(dir, SESSION, 'subagents'), { recursive: true });
        await writeFile(join(dir, SESSION, 'subagents', 'agent-a.jsonl'), '{}\n');
    }
    return dir;
}

describe('moveClaudeTranscript', () => {
    test('moves the transcript and the folder beside it to the slug of the new folder', async () => {
        const old = await transcript(scratch, true);
        const moved = await moveClaudeTranscript({ projectsDir, sessionId: SESSION, fromCwd: scratch, toCwd: project });
        const target = join(projectsDir, claudeProjectSlug(project));
        expect(await readdir(target)).toEqual(expect.arrayContaining([`${SESSION}.jsonl`, SESSION]));
        expect(await readFile(join(target, SESSION, 'subagents', 'agent-a.jsonl'), 'utf8')).toBe('{}\n');
        expect(await readdir(old)).toEqual([]);
        await moved.undo();
        expect((await readdir(old)).sort()).toEqual([SESSION, `${SESSION}.jsonl`].sort());
        await expect(readdir(target)).rejects.toThrow();
    });

    test('files the transcript under the slug of the resolved folder when the new folder is a link', async () => {
        const folder = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-claude-move-folder-')));
        const link = `${folder}-link`;
        await symlink(folder, link);
        try {
            await transcript(scratch, false);
            await moveClaudeTranscript({ projectsDir, sessionId: SESSION, fromCwd: scratch, toCwd: link });
            expect(await readdir(join(projectsDir, claudeProjectSlug(folder)))).toEqual([`${SESSION}.jsonl`]);
            await expect(readdir(join(projectsDir, claudeProjectSlug(link)))).rejects.toThrow();
        } finally {
            await rm(link, { force: true });
            await rm(folder, { recursive: true, force: true });
        }
    });

    test('moves a transcript that sits under another slug than the old folder has', async () => {
        const elsewhere = await transcript('/somewhere/else', false);
        await moveClaudeTranscript({ projectsDir, sessionId: SESSION, fromCwd: scratch, toCwd: project });
        expect(await readdir(join(projectsDir, claudeProjectSlug(project)))).toEqual([`${SESSION}.jsonl`]);
        expect(await readdir(elsewhere)).toEqual([]);
    });

    test('does nothing when the transcript already sits under the new slug', async () => {
        const target = await transcript(project, false);
        const moved = await moveClaudeTranscript({ projectsDir, sessionId: SESSION, fromCwd: scratch, toCwd: project });
        await moved.undo();
        expect(await readdir(target)).toEqual([`${SESSION}.jsonl`]);
    });

    test('does nothing for a chat that has no transcript', async () => {
        const none = await moveClaudeTranscript({ projectsDir, sessionId: SESSION, fromCwd: scratch, toCwd: project });
        await none.undo();
        expect(await readdir(projectsDir)).toEqual([]);
    });

    test('refuses an id that would leave the projects folder, and touches nothing', async () => {
        const old = await transcript(scratch, false);
        for (const sessionId of ['../escape', '..', 'a/b', '']) {
            await expect(moveClaudeTranscript({ projectsDir, sessionId, fromCwd: scratch, toCwd: project })).rejects.toMatchObject({ code: 'move-failed' });
        }
        expect(await readdir(old)).toEqual([`${SESSION}.jsonl`]);
    });

    test('refuses a taken name and puts back what already moved', async () => {
        const old = await transcript(scratch, true);
        const target = join(projectsDir, claudeProjectSlug(project));
        await mkdir(join(target, SESSION), { recursive: true });
        await expect(moveClaudeTranscript({ projectsDir, sessionId: SESSION, fromCwd: scratch, toCwd: project })).rejects.toMatchObject({
            code: 'move-failed'
        });
        expect((await readdir(old)).sort()).toEqual([SESSION, `${SESSION}.jsonl`].sort());
        expect(await readdir(target)).toEqual([SESSION]);
    });

    test('refuses a transcript another session already has under the new slug', async () => {
        const old = await transcript(scratch, false);
        const target = join(projectsDir, claudeProjectSlug(project));
        await mkdir(target, { recursive: true });
        await writeFile(join(target, `${SESSION}.jsonl`), 'other');
        // The lookup prefers the old folder, so the taken name is what stops the move.
        await expect(moveClaudeTranscript({ projectsDir, sessionId: SESSION, fromCwd: scratch, toCwd: project })).rejects.toMatchObject({
            code: 'move-failed'
        });
        expect(await readdir(old)).toEqual([`${SESSION}.jsonl`]);
        expect(await readFile(join(target, `${SESSION}.jsonl`), 'utf8')).toBe('other');
    });
});
