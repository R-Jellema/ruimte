import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/*
 * Reads the frames of a native crash of the desktop app against the Breakpad symbols Electron publishes
 * with every release, so a crash in Observatory is readable without uploading symbols anywhere.
 *
 *   bun scripts/symbolicate-electron.ts <electron version> <darwin-arm64|darwin-x64|linux-x64|linux-arm64> <offset>...
 *
 * The version is the `electron` tag on the event; the offsets are the `+0x...` frames, innermost first.
 * A frame of the Linux binary (`ruimte`) is looked up in `electron`, the name Electron ships it under.
 * Only frames of that module resolve; a small offset among large ones is usually a system library.
 */

interface SymbolRange {
    readonly start: number;
    readonly end: number;
    readonly name: string;
}

export interface SymbolTable {
    readonly functions: readonly SymbolRange[];
    readonly publics: readonly SymbolRange[];
}

/* The FUNC and PUBLIC records of a Breakpad `.sym` file, each sorted by address. A PUBLIC record has no size, so it runs to the next one. */
export function parseSymbols(text: string): SymbolTable {
    const functions: SymbolRange[] = [];
    const publicStarts: { start: number; name: string }[] = [];

    for (const line of text.split('\n')) {
        const fields = line.split(' ');
        const shift = fields[1] === 'm' ? 1 : 0;

        if (fields[0] === 'FUNC') {
            const start = parseInt(fields[1 + shift]!, 16);
            functions.push({ start, end: start + parseInt(fields[2 + shift]!, 16), name: fields.slice(4 + shift).join(' ') });
        } else if (fields[0] === 'PUBLIC') {
            publicStarts.push({ start: parseInt(fields[1 + shift]!, 16), name: fields.slice(3 + shift).join(' ') });
        }
    }

    functions.sort((left, right) => left.start - right.start);
    publicStarts.sort((left, right) => left.start - right.start);

    const publics = publicStarts.map((entry, index) => ({ ...entry, end: publicStarts[index + 1]?.start ?? Number.MAX_SAFE_INTEGER }));

    return { functions, publics };
}

function find(ranges: readonly SymbolRange[], address: number): SymbolRange | null {
    let low = 0;
    let high = ranges.length - 1;

    while (low <= high) {
        const middle = (low + high) >> 1;
        const range = ranges[middle]!;

        if (address < range.start) {
            high = middle - 1;
        } else if (address >= range.end) {
            low = middle + 1;
        } else {
            return range;
        }
    }

    return null;
}

/* The function an offset of the module falls in. Every frame but the innermost is a return address, one past its call. */
export function lookup(table: SymbolTable, offset: number, innermost: boolean): string | null {
    const address = innermost ? offset : offset - 1;

    return find(table.functions, address)?.name ?? find(table.publics, address)?.name ?? null;
}

async function symbolFolder(version: string, platform: string): Promise<string> {
    const folder = join(homedir(), '.cache', 'ruimte', 'electron-symbols', `${version}-${platform}`);

    if (existsSync(join(folder, 'breakpad_symbols'))) {
        return folder;
    }

    const name = `electron-v${version}-${platform}-symbols.zip`;
    const response = await fetch(`https://github.com/electron/electron/releases/download/v${version}/${name}`);

    if (!response.ok) {
        throw new Error(`Could not download ${name}: ${response.status}`);
    }

    mkdirSync(folder, { recursive: true });
    const archive = join(folder, name);
    await Bun.write(archive, response);
    const unzip = Bun.spawnSync(['unzip', '-q', '-o', archive, '-d', folder]);

    if (unzip.exitCode !== 0) {
        throw new Error(`Could not unpack ${name}: ${unzip.stderr.toString()}`);
    }

    return folder;
}

function symbolFile(folder: string, module: string): string {
    const moduleFolder = join(folder, 'breakpad_symbols', module);
    const [id] = readdirSync(moduleFolder);

    if (id === undefined) {
        throw new Error(`No symbols for ${module}`);
    }

    return join(moduleFolder, id, `${module}.sym`);
}

async function main(): Promise<void> {
    const [version, platform, ...offsets] = Bun.argv.slice(2);

    if (!version || !platform || offsets.length === 0) {
        throw new Error('usage: bun scripts/symbolicate-electron.ts <electron version> <platform> <offset>...');
    }

    const module = platform.startsWith('darwin') ? 'Electron Framework' : 'electron';
    const folder = await symbolFolder(version, platform);
    const table = parseSymbols(await Bun.file(symbolFile(folder, module)).text());

    offsets.forEach((raw, index) => {
        const offset = parseInt(raw.replace(/^\+?0x/, ''), 16);
        console.log(`${raw}  ${lookup(table, offset, index === 0) ?? '?'}`);
    });
}

if (import.meta.main) {
    await main();
}
