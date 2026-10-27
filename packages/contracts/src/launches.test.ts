import { describe, expect, test } from 'bun:test';
import { LaunchesDetectPayloadSchema, LaunchesSharedFileSchema, launchPortOf, readLaunchEntries } from './launches.ts';

/* A shared file with a field and a kind a later release might add. */
const file = {
    version: 1,
    launches: [
        { id: 'full-stack', name: 'Full stack', kind: 'group', launches: ['run-server', 'dev'] },
        {
            id: 'run-server',
            name: 'Run server',
            kind: 'service',
            cwd: 'backend',
            command: 'php -S 0.0.0.0:8000 -t public dev/server.php',
            url: 'http://localhost:8000',
            env: { APP_ENV: 'development' },
            restartOnCrash: true
        },
        { id: 'deploy', name: 'Deploy', kind: 'pipeline', steps: ['build', 'push'] }
    ]
};

describe('the launches file', () => {
    test('an unknown field and an unknown kind are written back unchanged', () => {
        const parsed = LaunchesSharedFileSchema.parse(JSON.parse(JSON.stringify(file)));
        const entries = readLaunchEntries(parsed.launches);
        expect(entries.map((entry) => ('launch' in entry ? entry.launch.id : 'raw'))).toEqual(['full-stack', 'run-server', 'raw']);
        const written = { ...parsed, launches: entries.map((entry) => ('launch' in entry ? entry.launch : entry.raw)) };
        expect(JSON.parse(JSON.stringify(written))).toEqual(file);
    });
});

describe('the port of an address', () => {
    test('reads the port, or the one the scheme implies', () => {
        expect(launchPortOf('http://localhost:8000')).toBe(8000);
        expect(launchPortOf('http://localhost')).toBe(80);
        expect(launchPortOf('https://example.test/path')).toBe(443);
        expect(launchPortOf('not an address')).toBeNull();
        expect(launchPortOf(undefined)).toBeNull();
    });
});

describe('detecting launches', () => {
    test('a request from before the opt-in still parses, and one that names sources keeps them', () => {
        expect(LaunchesDetectPayloadSchema.parse({ projectId: 'p1' })).toEqual({ projectId: 'p1' });
        expect(LaunchesDetectPayloadSchema.parse({ projectId: 'p1', sources: ['vscode-launch'] }).sources).toEqual(['vscode-launch']);
    });
});
