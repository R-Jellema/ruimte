import { mkdir, readFile, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { AgentKind } from '@ruimte/contracts';
import { isNotFound, writeAtomic } from '@adecore/agents/fs';
import { KeyedSerializer } from '@adecore/agents/serializer';
import {
    codexRulesPathIn as codexRulesPathInFolder,
    codexRulesText,
    defaultCodexHome,
    installCodexRules as installCodexRulesAt,
    type CodexRules
} from '@adecore/agents/providers/codex-rules';
import { HOOK_EVENTS } from './hooks.ts';
import { errorText } from '../error-text.ts';

// The one string the installer recognizes its own hook by, across versions of the command.
export const HOOK_MARKER = 'RUIMTE_HOOK_URL';

// Seconds the CLI waits for the hook; the POST is loopback, so anything longer means the daemon is gone.
// Codex clamps a SessionEnd or Interrupt hook to 3 s and warns on screen about anything longer.
const HOOK_TIMEOUT_S = 3;
const HOOK_MAX_TIME_S = 2;

/*
 * Outside Ruimte the hook only drains stdin. Inside it, stdout carries daemon context;
 * failed HTTP responses stay silent and never block the CLI.
 */
export function hookCommand(kind: AgentKind): string {
    return `if [ -n "$RUIMTE_HOOK_URL" ]; then curl -sf -m ${HOOK_MAX_TIME_S} -X POST "$RUIMTE_HOOK_URL/${kind}" -H "Authorization: Bearer $RUIMTE_HOOK_TOKEN" -H "Content-Type: application/json" --data-binary @-; else cat >/dev/null 2>&1; fi; exit 0`;
}

// A `command` hook with curl, never Claude Code's `http` kind: that one cannot read the port from the
// environment and reports an error whenever Ruimte is not running.
interface HookEntry {
    type: 'command';
    command: string;
    timeout: number;
}

export function hookEntry(kind: AgentKind): HookEntry {
    return {
        type: 'command',
        command: hookCommand(kind),
        timeout: HOOK_TIMEOUT_S
    };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isOurs(hook: unknown): boolean {
    return isRecord(hook) && typeof hook.command === 'string' && hook.command.includes(HOOK_MARKER);
}

export function sameEntry(hook: unknown, wanted: HookEntry): boolean {
    return isRecord(hook) && hook.type === wanted.type && hook.command === wanted.command && hook.timeout === wanted.timeout;
}

/*
 * Puts one Ruimte hook under every event the daemon listens for and leaves everything else in
 * the config alone: other tools' hooks, other keys, unknown fields on our own group. Answers the
 * new config and whether anything changed, so an unchanged file is never rewritten. A config whose
 * top level, `hooks` or an event is not the shape the CLI reads is refused, never rebuilt.
 */
export function mergeHooks(config: unknown, kind: AgentKind): { config: Record<string, unknown>; changed: boolean; refused: boolean } {
    const shapeKept = isRecord(config) && (config.hooks === undefined || (isRecord(config.hooks) && Object.values(config.hooks).every(Array.isArray)));
    if (!shapeKept) {
        return { config: {}, changed: false, refused: true };
    }
    const root: Record<string, unknown> = { ...(config as Record<string, unknown>) };
    const hooks: Record<string, unknown> = isRecord(root.hooks) ? { ...root.hooks } : {};
    const wantedEvents = new Set(HOOK_EVENTS[kind] ?? []);
    let changed = false;

    const wanted = hookEntry(kind);
    const allEvents = new Set([...wantedEvents, ...Object.keys(hooks)]);
    for (const event of allEvents) {
        const groups = Array.isArray(hooks[event]) ? (hooks[event] as unknown[]) : [];
        let placed = false;
        const nextGroups: unknown[] = [];
        for (const group of groups) {
            if (!isRecord(group) || !Array.isArray(group.hooks)) {
                nextGroups.push(group);
                continue;
            }
            const kept: unknown[] = [];
            let groupChanged = false;
            for (const hook of group.hooks) {
                if (!isOurs(hook)) {
                    kept.push(hook);
                    continue;
                }
                if (wantedEvents.has(event) && !placed) {
                    placed = true;
                    if (sameEntry(hook, wanted)) {
                        kept.push(hook);
                    } else {
                        kept.push(wanted);
                        groupChanged = true;
                    }
                } else {
                    // A second copy, or an event the daemon stopped listening for.
                    groupChanged = true;
                }
            }
            changed ||= groupChanged;
            if (kept.length > 0) {
                nextGroups.push(groupChanged ? { ...group, hooks: kept } : group);
            } else if (group.hooks.length === 0) {
                nextGroups.push(group);
            }
        }
        if (wantedEvents.has(event) && !placed) {
            nextGroups.push({ hooks: [wanted] });
            changed = true;
        }
        if (nextGroups.length > 0) {
            hooks[event] = nextGroups;
        } else {
            delete hooks[event];
        }
    }

    root.hooks = hooks;
    return { config: root, changed, refused: false };
}

type InstallResult = 'unchanged' | 'written';

export interface HooksInstall {
    result: InstallResult;
    // What the file lacked before, so turning the hooks off can leave it as it was found.
    createdFile: boolean;
    createdHooksKey: boolean;
}

/* A settings file that is not an object, or whose `hooks` is not one, is a person's and is never rewritten. */
export class HookFileRefused extends Error {}

// One edit of a file at a time, by real path, so two installs in a row never read the same text.
const hookFiles = new KeyedSerializer();

export const HOOK_FILE_RETRIES = 3;

/* The one place a hook settings file is edited: the install and the revoke queue behind each other here. */
export function editingHookFile<T>(path: string, work: () => Promise<T>): Promise<T> {
    return hookFiles.run(path, work);
}

export async function textOrNull(path: string): Promise<string | null> {
    try {
        return await readFile(path, 'utf8');
    } catch (e) {
        if (isNotFound(e)) {
            return null;
        }
        throw new Error(`Cannot read ${path}: ${errorText(e)}`);
    }
}

/* Idempotent: the second run on the same file is a no-op. A file that is not JSON, or not an object, is left alone (throws). */
export async function installHooks(link: string, kind: AgentKind): Promise<HooksInstall> {
    // Written where a symlink points, since a rename over the link itself would cut a dotfiles checkout loose.
    const path = await realpath(link).catch(() => link);
    return await editingHookFile(path, async () => {
        for (let attempt = 0; attempt < HOOK_FILE_RETRIES; attempt++) {
            const text = await textOrNull(path);
            let existing: unknown = {};
            if (text !== null) {
                try {
                    existing = JSON.parse(text);
                } catch (e) {
                    throw new Error(`Cannot read ${path}: ${errorText(e)}`);
                }
            }
            const { config, changed, refused } = mergeHooks(existing, kind);
            if (refused) {
                throw new HookFileRefused(`${path} is not a settings object with hooks in the shape the CLI reads, so Ruimte leaves it alone`);
            }
            const created = { createdFile: text === null, createdHooksKey: !isRecord(existing) || existing.hooks === undefined };
            if (!changed) {
                return { result: 'unchanged', ...created };
            }
            const mode = await stat(path).then(
                (stats) => stats.mode & 0o777,
                () => 0o644
            );
            await mkdir(dirname(path), { recursive: true });
            // A CLI or an editor that wrote since the read would lose its change to ours.
            if ((await textOrNull(path)) !== text) {
                continue;
            }
            await writeAtomic(path, `${JSON.stringify(config, null, 2)}\n`, mode);
            return { result: 'written', ...created };
        }
        throw new Error(`${path} kept changing; try again`);
    });
}

/* The file a CLI reads user-level hooks from inside one of its config folders; null for a CLI whose hooks the daemon cannot read. */
export function hookPathIn(kind: AgentKind, folder: string): string | null {
    if (kind === 'claude') {
        return join(folder, 'settings.json');
    }
    if (kind === 'codex') {
        return join(folder, 'hooks.json');
    }
    return null;
}

/* The folder a CLI reads its own settings from when nothing points it elsewhere; null for a CLI the daemon cannot wire. */
export function defaultConfigFolder(kind: AgentKind, env: Record<string, string | undefined> = process.env): string | null {
    if (kind === 'claude') {
        return env.CLAUDE_CONFIG_DIR ?? join(env.HOME ?? homedir(), '.claude');
    }
    if (kind === 'codex') {
        return defaultCodexHome(env);
    }
    return null;
}

/* Lets Codex run `ruimte-context` outside its sandbox without asking; the daemon already enforces every verb (mode ceiling, depth, cwd). */
const RUIMTE_CODEX_RULES: CodexRules = { app: 'Ruimte', commands: ['ruimte-context'] };

export const CODEX_RULES = codexRulesText(RUIMTE_CODEX_RULES);

export function installCodexRules(path: string): Promise<InstallResult> {
    return installCodexRulesAt(path, RUIMTE_CODEX_RULES);
}

export function codexRulesPathIn(folder: string): string {
    return codexRulesPathInFolder(folder, RUIMTE_CODEX_RULES);
}

export function defaultCodexRulesPath(env: Record<string, string | undefined> = process.env): string {
    return codexRulesPathIn(defaultCodexHome(env));
}

export interface FolderInstall extends HooksInstall {
    path: string;
    kind: 'hooks' | 'rules';
}

/*
 * Everything the daemon puts in one config folder of a CLI: its hooks, and for Codex the rule that
 * lets `ruimte-context` out of the sandbox. Answers what was written where, so the caller can say so.
 */
export async function installInFolder(kind: AgentKind, folder: string): Promise<FolderInstall[]> {
    const hookPath = hookPathIn(kind, folder);
    if (hookPath === null) {
        return [];
    }
    const installs: FolderInstall[] = [{ path: hookPath, kind: 'hooks', ...(await installHooks(hookPath, kind)) }];
    if (kind === 'codex') {
        const rulesPath = codexRulesPathIn(folder);
        const existed = await stat(rulesPath).then(
            () => true,
            () => false
        );
        installs.push({ path: rulesPath, kind: 'rules', result: await installCodexRules(rulesPath), createdFile: !existed, createdHooksKey: false });
    }
    return installs;
}
