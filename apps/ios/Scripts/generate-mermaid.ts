import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');

function packageDirectory(name: string, from: string): string {
    let folder = dirname(createRequire(from).resolve(name));
    while (true) {
        const manifest = resolve(folder, 'package.json');
        if (existsSync(manifest) && JSON.parse(readFileSync(manifest, 'utf8')).name === name) {
            return folder;
        }
        const parent = dirname(folder);
        if (parent === folder) {
            throw new Error(`Could not find the package ${name}`);
        }
        folder = parent;
    }
}

// The Pele the desktop's chat draws a mermaid fence with, so a diagram is laid out alike on both.
const chatUI = packageDirectory('@adecore/agents-react', resolve(root, '../client/package.json'));
const wanted = JSON.parse(readFileSync(resolve(chatUI, 'package.json'), 'utf8')).dependencies?.pele;
const pele = packageDirectory('pele', resolve(chatUI, 'package.json'));
const manifest = JSON.parse(readFileSync(resolve(pele, 'package.json'), 'utf8'));
if (manifest.version !== wanted) {
    throw new Error(`@adecore/agents-react pins pele ${wanted}, but ${manifest.version} is installed`);
}

const license = `Pele ${manifest.version}\nhttps://github.com/obsidianmd/pele\n\n${await readFile(resolve(pele, 'LICENSE'), 'utf8')}`;
const outputs = new Map([
    ['App/Resources/pele.js', await readFile(resolve(pele, 'dist/pele.global.js'), 'utf8')],
    ['App/Resources/pele-license.txt', license]
]);
for (const [path, contents] of outputs) {
    const destination = resolve(root, path);
    if (process.argv.includes('--check')) {
        if ((await readFile(destination, 'utf8').catch(() => '')) !== contents) {
            throw new Error(`Stale generated file: ${destination}`);
        }
    } else {
        await mkdir(resolve(destination, '..'), { recursive: true });
        await writeFile(destination, contents);
    }
}
console.log(`${process.argv.includes('--check') ? 'Checked' : 'Generated'} Pele ${manifest.version} for mermaid diagrams.`);
