import { describe, expect, test } from 'bun:test';
import type { ProjectView } from '@ruimte/contracts';
import type { SessionFs } from '@adecore/agents/chat/external-sessions';
import { claudeProjectSlug } from '@adecore/agents/chat/claude-transcript';
import { ExternalChatSessions, resumesOfViews, type ExternalChatSessionsDeps } from './external.ts';

const folder = '/work/app';
const line = (text: string) => JSON.stringify({ type: 'user', message: { role: 'user', content: text } });

function fsOf(files: Record<string, string>): SessionFs {
    return {
        readdir: async (path) => [
            ...new Set(
                Object.keys(files)
                    .filter((file) => file.startsWith(`${path}/`))
                    .map((file) => file.slice(path.length + 1).split('/')[0]!)
            )
        ],
        stat: async (path) => (path in files ? { mtimeMs: path.includes('newer') ? 20 : 10 } : null),
        readHead: async (path) => files[path] ?? ''
    };
}

function setup(overrides: Partial<ExternalChatSessionsDeps> = {}) {
    const files = {
        [`/claude/projects/${claudeProjectSlug(folder)}/own.jsonl`]: line('started in Ruimte'),
        [`/claude/projects/${claudeProjectSlug(folder)}/outside.jsonl`]: line('started outside'),
        [`/work-claude/projects/${claudeProjectSlug(folder)}/newer.jsonl`]: line('other account')
    };
    const deps: ExternalChatSessionsDeps = {
        holds: async () => true,
        folderOf: (projectId) => (projectId === 'p1' ? folder : null),
        roots: () => [
            { provider: 'claude', path: '/claude/projects', accounts: ['claude'] },
            { provider: 'claude', path: '/work-claude/projects', accounts: ['work'] },
            { provider: 'codex', path: '/codex/sessions', accounts: ['codex'] }
        ],
        ownSessionIds: async () => new Set(['own']),
        fs: fsOf(files),
        ...overrides
    };
    return new ExternalChatSessions(deps);
}

describe('sessions started outside Ruimte', () => {
    test('lists every account folder, leaves out the sessions Ruimte runs and names the account', async () => {
        const { sessions, failed } = await setup().list('p1', 'client');
        expect(failed).toEqual([]);
        expect(sessions.map((session) => [session.sessionId, session.account, session.provider])).toEqual([
            ['newer', 'work', 'claude'],
            ['outside', undefined, 'claude']
        ]);
    });

    test('is refused for a client that does not hold the project', async () => {
        await expect(setup({ holds: async () => false }).list('p1', 'client')).rejects.toMatchObject({ code: 'not-open' });
    });

    test('an unknown project has none', async () => {
        expect(await setup().list('nope', 'client')).toEqual({ sessions: [], failed: [] });
    });

    test('a root that cannot be read is reported and the rest still listed', async () => {
        const fs = fsOf({});
        const broken: SessionFs = {
            ...fs,
            readdir: async (path) => (path.startsWith('/work-claude') ? Promise.reject(new Error('denied')) : fs.readdir(path))
        };
        const { failed } = await setup({ fs: broken }).list('p1', 'client');
        expect(failed).toEqual([{ provider: 'claude', reason: 'denied' }]);
    });
});

test('the sessions a project resumes are read off its views and nodes', () => {
    const views = [
        { kind: 'chat', id: 'c', node: { resume: 'one' } },
        { kind: 'terminal', id: 't', node: {} },
        {
            kind: 'canvas',
            id: 'main',
            nodes: [
                { id: 'n', kind: 'chat', resume: 'two' },
                { id: 'm', kind: 'terminal' }
            ],
            edges: []
        }
    ] as unknown as ProjectView[];
    expect(resumesOfViews(views)).toEqual(['one', 'two']);
});
