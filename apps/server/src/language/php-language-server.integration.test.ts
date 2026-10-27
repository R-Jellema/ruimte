import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LanguageRequestResult } from '@ruimte/contracts';
import type { Diagnostic } from '@adecore/lsp';
import { MachineHome } from '../fs/machine-home.ts';
import type { SessionEvent } from '../sessions/manager.ts';
import { LanguageHost } from './host.ts';
import { cargoCommand, NativePolicy, phpLanguageServerCheckout, type Download } from './native.ts';
import { spawnLanguageProcess } from './runtime.ts';
import { tarGz } from './test-archives.ts';
import { eventually, positionOf } from './test-integration.ts';

/*
 * The standalone PHP server, built from its checkout with Cargo as Install does in development
 * and run through the host. The stubs come from a small archive of the test's own, so the run needs no network.
 */

const checkout = phpLanguageServerCheckout(false);
const hasCargo = existsSync(cargoCommand());

if (!hasCargo || checkout === null) {
    console.warn(
        `Skipping the PHP server tests: ${checkout === null ? 'the standalone sibling or explicit checkout has no native sources' : 'cargo is not installed'}`
    );
}

const STUBS = tarGz([
    {
        path: 'stubs/standard/standard_0.php',
        text: '<?php\n\n/**\n * Counts the bytes of a string.\n * @param string $string\n * @return int\n */\nfunction strlen(string $string): int {}\n'
    }
]);

const FILES: Record<string, string> = {
    'composer.json': JSON.stringify({ name: 'acme/app', require: { php: '^8.1' }, autoload: { 'psr-4': { 'Acme\\': 'src/' } } }),
    'src/Greeter.php': [
        '<?php',
        '',
        'namespace Acme;',
        '',
        '/** Says hello to someone. */',
        'final class Greeter',
        '{',
        '    /** Builds the greeting for a name. */',
        '    public function greet(string $name): string',
        '    {',
        "        return 'Hello, ' . $name;",
        '    }',
        '',
        '    public function shout(string $name): string',
        '    {',
        '        return strtoupper($this->greet($name));',
        '    }',
        '}',
        ''
    ].join('\n'),
    'main.php': [
        '<?php',
        '',
        'use Acme\\Greeter;',
        '',
        '$greeter = new Greeter();',
        "echo $greeter->greet('Ada');",
        'echo strlen("abc");',
        '$greeter->shout("Ada");',
        ''
    ].join('\n')
};

let base = '';
let project = '';
let host: LanguageHost;
const events: SessionEvent[] = [];
const exits: Promise<unknown>[] = [];

const ask = (path: string, method: string, params: unknown): Promise<LanguageRequestResult> =>
    host.request({ projectId: 'p1', path, method: method as never, params });

function diagnosticsOf(path: string): Diagnostic[] {
    const report = events.findLast((event) => event.event === 'language.diagnostics' && event.payload.path === path);
    return report && report.event === 'language.diagnostics' ? (report.payload.diagnostics as Diagnostic[]) : [];
}

const download: Download = async (_url, destination) => {
    await writeFile(destination, STUBS);
};

describe.skipIf(!hasCargo || checkout === null)('the standalone PHP server in Ruimte', () => {
    beforeAll(async () => {
        base = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-php-server-')));
        project = join(base, 'project');
        for (const [path, text] of Object.entries(FILES)) {
            await mkdir(join(project, path, '..'), { recursive: true });
            await writeFile(join(project, path), text);
        }
        host = new LanguageHost({
            root: join(base, 'home', 'language-servers'),
            folderOf: (projectId) => (projectId === 'p1' ? project : null),
            holders: () => ['c1'],
            machineHome: new MachineHome(join(base, 'home')),
            native: new NativePolicy({ checkouts: { 'php-native': checkout } }),
            download,
            spawn: (spec) => {
                const child = spawnLanguageProcess(spec);
                exits.push(child.exited);
                return child;
            }
        });
        host.subscribe('c1', (event) => events.push(event));
    }, 600_000);

    afterAll(async () => {
        await host?.close();
        await Promise.all(exits);
        await rm(base, { recursive: true, force: true });
    });

    test('Install builds the checkout, fetches the stubs and leaves the kind installed', async () => {
        await host.install('php-native');
        await eventually(
            'the install',
            async () => (await host.status('p1')).find((status) => status.server === 'php-native'),
            (status) => status?.state === 'stopped' || (status?.state === 'not-installed' && status.message !== undefined),
            600_000
        );
        const status = (await host.status('p1')).find((candidate) => candidate.server === 'php-native');
        const log = (await host.log('p1', 'php-native')).map((line) => line.text).join('\n');
        expect({ state: status?.state, message: status?.message, log }).toMatchObject({ state: 'stopped' });
        expect(status).toMatchObject({ version: checkout!.version, chosen: true });
    }, 600_000);

    test('answers hover, completion and diagnostics on a project of its own', async () => {
        const text = FILES['main.php']!;
        const opened = await host.open('c1', { projectId: 'p1', path: 'main.php', languageId: 'php', text });
        expect(opened.servers).toEqual(['php-native']);
        await eventually(
            'the server ready',
            async () => (await host.status('p1')).find((status) => status.server === 'php-native')?.state,
            (state) => state === 'ready'
        );

        const hover = await eventually(
            'a hover on a class of the project',
            () => ask('main.php', 'textDocument/hover', { position: positionOf(text, 'Greeter()', 2) }),
            (reply) => reply.result !== null,
            60_000
        );
        expect(JSON.stringify(hover.result)).toContain('Greeter');

        const library = await eventually(
            'a hover on a function of the standard library',
            () => ask('main.php', 'textDocument/hover', { position: positionOf(text, 'strlen', 2) }),
            (reply) => JSON.stringify(reply.result).includes('Counts the bytes')
        );
        expect(JSON.stringify(library.result)).toContain('strlen');

        const members = await eventually(
            'the members of the greeter',
            () => ask('main.php', 'textDocument/completion', { position: positionOf(text, '$greeter->shout', '$greeter->'.length) }),
            (reply) => JSON.stringify(reply.result).includes('shout')
        );
        expect(JSON.stringify(members.result)).toContain('greet');

        await eventually('the initial diagnostics', () => events.some((event) => event.event === 'language.diagnostics' && event.payload.path === 'main.php'));
        expect(diagnosticsOf('main.php').filter((item) => item.severity === 1)).toEqual([]);
        const reportStart = events.length;
        const end = { line: 8, character: 0 };
        const changed = await host.change({
            projectId: 'p1',
            path: 'main.php',
            baseVersion: opened.version,
            changes: [{ range: { start: end, end }, text: 'if (\n' }]
        });
        expect(changed.version).toBe(opened.version + 1);
        const problems = await eventually(
            'a syntax error',
            () => {
                const report = events
                    .slice(reportStart)
                    .findLast(
                        (event) => event.event === 'language.diagnostics' && event.payload.path === 'main.php' && event.payload.version === changed.version
                    );
                return report && report.event === 'language.diagnostics' ? (report.payload.diagnostics as Diagnostic[]) : [];
            },
            (list) => list.some((item) => item.severity === 1 && item.range.start.line >= end.line)
        );
        expect(problems.some((item) => item.severity === 1 && item.range.start.line >= end.line)).toBe(true);
    }, 180_000);
});
