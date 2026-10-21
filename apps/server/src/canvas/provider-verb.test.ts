import { beforeEach, describe, expect, test } from 'bun:test';
import { refusalBody } from '@adecore/agents/context';
import type { CliVersion, RegistryAgent } from '@ruimte/contracts';
import { VerbRefusal, type CanvasHost, type Noun } from './verb.ts';
import { verbNamed } from './verbs.ts';

const noun = verbNamed('provider') as Noun;

const AGENTS: RegistryAgent[] = [
    {
        id: 'goose',
        kind: 'goose',
        name: 'goose',
        version: '1.55.0',
        description: 'A local, extensible agent',
        distribution: 'binary',
        checksum: true,
        installed: '1.54.0',
        state: 'installed'
    },
    {
        id: 'kilo',
        kind: 'kilo',
        name: 'Kilo',
        version: '7.8.15',
        description: 'The open source coding agent',
        distribution: 'npm',
        checksum: false,
        installed: null,
        state: 'missing'
    }
];

const VERSIONS: CliVersion[] = [
    { provider: 'claude', method: 'unknown', package: null, path: '/c', version: '2.1.304', latest: null, updatable: false, state: 'idle', checkedAt: null },
    {
        provider: 'copilot',
        method: 'npm',
        package: '@github/copilot',
        path: '/p',
        version: '1.0.101',
        latest: '1.0.110',
        updatable: true,
        state: 'idle',
        checkedAt: 1
    }
];

let refreshed: boolean[];
let host: CanvasHost;

beforeEach(() => {
    refreshed = [];
    host = {
        projects: { locate: (id: string) => (id === 'chat-1' ? { projectId: 'p1', folder: '/repo', canvasId: null } : null) },
        providerInstalls: {
            catalog: async (refresh: boolean) => {
                refreshed.push(refresh);
                return { source: 'cached', fetchedAt: Date.UTC(2026, 9, 21), error: 'offline', platform: 'darwin-aarch64', agents: AGENTS };
            },
            versions: async (refresh: boolean) => {
                refreshed.push(refresh);
                return VERSIONS;
            }
        }
    } as unknown as CanvasHost;
});

async function run(argv: string[]): Promise<string[]> {
    try {
        return await noun.run(argv, { caller: 'chat-1', host });
    } catch (error) {
        if (error instanceof VerbRefusal) {
            return refusalBody(error.code, error.message, error.lines).split('\n');
        }
        throw error;
    }
}

const PERSON = expect.stringMatching(/^person\tInstalling, updating and removing stay a person's/);

describe('ruimte-context provider', () => {
    test('catalog lists the agents a line each, and says a person installs them', async () => {
        expect(await run(['catalog'])).toEqual([
            'registry\tcached\t2026-10-21T00:00:00.000Z\toffline',
            'agent\tgoose\tgoose\t1.55.0\tbinary\t1.54.0\tinstalled\tA local, extensible agent',
            'agent\tkilo\tKilo\t7.8.15\tnpm\t-\tmissing\tThe open source coding agent',
            PERSON
        ]);
        expect(refreshed).toEqual([false]);
    });

    test('catalog --search keeps the agents that hold every word', async () => {
        const lines = await run(['catalog', '--search', 'open source', '--refresh']);
        expect(lines.filter((line) => line.startsWith('agent\t'))).toEqual(['agent\tkilo\tKilo\t7.8.15\tnpm\t-\tmissing\tThe open source coding agent']);
        expect(refreshed).toEqual([true]);
    });

    test('versions says how each CLI came here and whether its route has a newer one', async () => {
        expect(await run(['versions'])).toEqual([
            'cli\tclaude\t2.1.304\tunknown\t-\t-\tno',
            'cli\tcopilot\t1.0.101\tnpm\t@github/copilot\t1.0.110\tyes',
            PERSON
        ]);
    });

    test('has no verb that installs or updates', async () => {
        expect((await run(['install', 'goose']))[0]).toMatch(/^refused\t/);
    });
});
