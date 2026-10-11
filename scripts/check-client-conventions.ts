import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Glob } from 'bun';
import { parseSync, Visitor } from 'oxc-parser';

const HERE = new URL('../apps/client/src/', import.meta.url).pathname;
const SOURCES = [...new Glob('**/*.{ts,tsx}').scanSync(HERE)]
    .filter((path) => !path.endsWith('.test.ts') && !path.endsWith('.test.tsx'))
    .sort()
    .map((path) => ({ path, text: readFileSync(join(HERE, path), 'utf8') }));

const KEY_LISTENERS = new Set(['shell/app-shortcuts.ts', 'canvas/canvas-shortcuts.ts', 'drawing/use-drawing-keys.ts']);

// The speech model needs a fixed date format; no person reads it.
const INTL_OUTSIDE_FORMAT = new Set(['voice/controller.ts']);

const problems: string[] = [];
for (const { path, text } of SOURCES) {
    if (/(window|document)\.addEventListener\(\s*['"]key(down|up)['"]/.test(text) && !KEY_LISTENERS.has(path)) {
        problems.push(`${path}: bind window shortcuts in the designated shortcut modules`);
    }
    // Cleanup after a machine switch must still reach the original machine.
    if (path.endsWith('.tsx') && /import\s*\{[^}]*\b(sessionClient|chatClient)\b[^}]*\}\s*from\s*'@\/(terminal|transport\/connections)'/.test(text)) {
        problems.push(`${path}: reach sessions and chats through the component's machine`);
    }
    if (!INTL_OUTSIDE_FORMAT.has(path)) {
        new Visitor({
            MemberExpression(node) {
                if (node.object.type === 'Identifier' && node.object.name === 'Intl') {
                    problems.push(`${path}:${text.slice(0, node.start).split('\n').length}: use @adecore/ui/format`);
                }
            }
        }).visit(parseSync(path, text).program);
    }
}
for (const problem of problems) {
    console.error(`apps/client/src/${problem}`);
}
process.exitCode = problems.length === 0 ? 0 : 1;
