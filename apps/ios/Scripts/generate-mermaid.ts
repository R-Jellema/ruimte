import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { packageDirectory, root, writeGenerated } from './generated.ts';

// The Pele the desktop's chat draws a mermaid fence with, so a diagram is laid out alike on both.
const chatUI = packageDirectory('@adecore/agents-react', resolve(root, '../client/package.json'));
const wanted = JSON.parse(readFileSync(resolve(chatUI, 'package.json'), 'utf8')).dependencies?.pele;
const pele = packageDirectory('pele', resolve(chatUI, 'package.json'));
const manifest = JSON.parse(readFileSync(resolve(pele, 'package.json'), 'utf8'));
if (manifest.version !== wanted) {
    throw new Error(`@adecore/agents-react pins pele ${wanted}, but ${manifest.version} is installed`);
}

const license = `Pele ${manifest.version}\nhttps://github.com/obsidianmd/pele\n\n${await readFile(resolve(pele, 'LICENSE'), 'utf8')}`;
await writeGenerated(
    new Map([
        ['App/Resources/pele.js', await readFile(resolve(pele, 'dist/pele.global.js'), 'utf8')],
        ['App/Resources/pele-license.txt', license]
    ]),
    `Pele ${manifest.version} for mermaid diagrams`
);
