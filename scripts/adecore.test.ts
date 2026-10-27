import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { adecorePins, bumpManifest, bumpPackages, lockedOffVersion, type RunCommand } from './adecore.ts';

const clientManifest = `{
    "name": "@ruimte/client",
    "dependencies": {
        "@adecore/ui": "0.23.1",
        "@adecore/terminal": "0.23.1",
        "react": "^19.3.0"
    },
    "devDependencies": {
        "@adecore/agents": "0.23.1"
    }
}
`;

const serverManifest = `{
    "name": "@ruimte/server",
    "dependencies": {
        "@adecore/agents": "0.23.1",
        "zod": "^4.6.5"
    }
}
`;

describe('ADE CORE pins', () => {
    test('finds every ADE CORE entry in every dependency section', () => {
        expect(
            adecorePins({
                name: 'consumer',
                dependencies: { '@adecore/ui': '0.23.1', react: '^19.3.0' },
                devDependencies: { '@adecore/agents': '0.23.1' },
                optionalDependencies: { '@adecore/database': '0.23.0' },
                peerDependencies: { '@adecore/ui': '0.23.1' }
            })
        ).toEqual([
            { section: 'dependencies', name: '@adecore/ui', version: '0.23.1' },
            { section: 'devDependencies', name: '@adecore/agents', version: '0.23.1' },
            { section: 'optionalDependencies', name: '@adecore/database', version: '0.23.0' },
            { section: 'peerDependencies', name: '@adecore/ui', version: '0.23.1' }
        ]);
    });

    test('rewrites every pin and keeps the rest of the file as it was', () => {
        const { text, pins } = bumpManifest(clientManifest, '0.24.0');
        expect(pins).toHaveLength(3);
        expect(text).toBe(clientManifest.replaceAll('"0.23.1"', '"0.24.0"'));
    });

    test('rewrites a pin that is on another version than the rest', () => {
        const { text } = bumpManifest(clientManifest.replace('"@adecore/terminal": "0.23.1"', '"@adecore/terminal": "0.22.0"'), '0.24.0');
        expect(adecorePins(JSON.parse(text)).map((pin) => pin.version)).toEqual(['0.24.0', '0.24.0', '0.24.0']);
    });

    test('leaves a manifest without ADE CORE pins unchanged', () => {
        const manifest = '{\n    "name": "@ruimte/csp",\n    "dependencies": { "zod": "^4.6.5" }\n}\n';
        expect(bumpManifest(manifest, '0.24.0')).toEqual({ text: manifest, pins: [] });
    });

    test('refuses a pin that is not an exact version', () => {
        expect(() => bumpManifest(clientManifest.replace('"@adecore/ui": "0.23.1"', '"@adecore/ui": "^0.23.1"'), '0.24.0', 'apps/client/package.json')).toThrow(
            'apps/client/package.json: @adecore/ui in dependencies is "^0.23.1", not an exact version.'
        );
    });

    test('refuses when the same name appears outside the dependency sections', () => {
        const manifest = clientManifest.replace('"name": "@ruimte/client",', '"name": "@ruimte/client",\n    "overrides": { "@adecore/ui": "0.23.1" },');
        expect(() => bumpManifest(manifest, '0.24.0')).toThrow('could not be rewritten without touching other fields');
    });

    test('names the locked ADE CORE packages on another version', () => {
        const lock = [
            '"@adecore/ui": ["@adecore/ui@0.24.0", "", {}, "sha512-a"],',
            '"@adecore/agents": ["@adecore/agents@0.24.0", "", { "dependencies": { "@adecore/plan": "0.23.1" } }, "sha512-b"],',
            '"@adecore/plan": ["@adecore/plan@0.23.1", "", {}, "sha512-c"],'
        ].join('\n');
        expect(lockedOffVersion(lock, '0.24.0')).toEqual(['@adecore/plan@0.23.1']);
    });
});

describe('bumpPackages', () => {
    let fixture: string;
    let root: string;
    let adecore: string;

    function write(path: string, text: string): void {
        mkdirSync(join(path, '..'), { recursive: true });
        writeFileSync(path, text);
    }

    function installed(workspace: string, name: string, version: string): void {
        write(join(root, workspace, 'node_modules', name, 'package.json'), JSON.stringify({ name, version }));
    }

    function installAll(version: string): void {
        installed('apps/client', '@adecore/ui', version);
        installed('apps/client', '@adecore/terminal', version);
        installed('apps/client', '@adecore/agents', version);
        installed('apps/server', '@adecore/agents', version);
    }

    function install(version: string, lockVersion = version): RunCommand {
        return async (cwd, args) => {
            expect(cwd).toBe(root);
            expect(args).toEqual(['install']);
            installAll(version);
            write(join(root, 'bun.lock'), `"@adecore/ui": ["@adecore/ui@${version}"],\n"@adecore/plan": ["@adecore/plan@${lockVersion}"],\n`);
        };
    }

    function manifests(): string[] {
        return ['package.json', 'apps/client/package.json', 'apps/server/package.json'].map((file) => readFileSync(join(root, file), 'utf8'));
    }

    beforeEach(() => {
        fixture = realpathSync(mkdtempSync(join(tmpdir(), 'ruimte-adecore-bump-')));
        root = join(fixture, 'ruimte');
        adecore = join(fixture, 'adecore');
        write(join(root, 'package.json'), '{\n    "name": "ruimte",\n    "workspaces": ["apps/*"]\n}\n');
        write(join(root, 'apps/client/package.json'), clientManifest);
        write(join(root, 'apps/server/package.json'), serverManifest);
        write(join(root, 'bun.lock'), '"@adecore/ui": ["@adecore/ui@0.23.1"],\n');
        installAll('0.23.1');
        write(join(adecore, 'packages/ui/package.json'), JSON.stringify({ name: '@adecore/ui', version: '0.24.0' }));
    });

    afterEach(() => {
        rmSync(fixture, { recursive: true, force: true });
    });

    test('moves every pin, installs once and ends on npm', async () => {
        await bumpPackages(root, adecore, '0.24.0', install('0.24.0'));
        const [main, client, server] = manifests();
        expect(main).toBe('{\n    "name": "ruimte",\n    "workspaces": ["apps/*"]\n}\n');
        expect(client).toBe(clientManifest.replaceAll('0.23.1', '0.24.0'));
        expect(server).toBe(serverManifest.replace('0.23.1', '0.24.0'));
    });

    test('refuses a linked checkout before changing a manifest', async () => {
        const link = join(root, 'apps/client/node_modules/@adecore/ui');
        rmSync(link, { recursive: true });
        symlinkSync(join(adecore, 'packages/ui'), link);
        const before = manifests();
        let installs = 0;
        await expect(
            bumpPackages(root, adecore, '0.24.0', async () => {
                installs++;
            })
        ).rejects.toThrow('apps/client: @adecore/ui is linked to');
        expect(installs).toBe(0);
        expect(manifests()).toEqual(before);
    });

    test('refuses a version that is not exact', async () => {
        await expect(bumpPackages(root, adecore, '^0.24.0', install('0.24.0'))).rejects.toThrow('^0.24.0 is not an exact version');
    });

    test('puts the manifests and lockfile back when the install fails', async () => {
        const before = manifests();
        await expect(
            bumpPackages(root, adecore, '9.9.9', async () => {
                throw new Error('No version matching "9.9.9"');
            })
        ).rejects.toThrow('No version matching');
        expect(manifests()).toEqual(before);
        expect(readFileSync(join(root, 'bun.lock'), 'utf8')).toBe('"@adecore/ui": ["@adecore/ui@0.23.1"],\n');
    });

    test('fails when the lockfile keeps an ADE CORE package on another version', async () => {
        await expect(bumpPackages(root, adecore, '0.24.0', install('0.24.0', '0.23.1'))).rejects.toThrow('bun.lock: @adecore/plan@0.23.1');
    });

    test('fails when an installed package is not the pinned version', async () => {
        const run = install('0.24.0');
        await expect(
            bumpPackages(root, adecore, '0.24.0', async (cwd, args) => {
                await run(cwd, args);
                installed('apps/server', '@adecore/agents', '0.23.1');
            })
        ).rejects.toThrow('do not resolve to the npm install of 0.24.0');
    });
});
