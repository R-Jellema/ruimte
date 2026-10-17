import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { FS_LOCATE_MAX_MATCHES, type FsLocatePayload, type FsLocateResult, type GitReposResult } from '@ruimte/contracts';
import { cachedRepos } from '../git/repo-cache.ts';
import { isMachineStatePath, NO_MACHINE_HOME, type MachineHomePolicy } from './machine-home.ts';

export interface LocateDeps {
    repos: (folder: string) => Promise<GitReposResult>;
    policy: MachineHomePolicy;
}

const REAL_DEPS: LocateDeps = { repos: (folder) => cachedRepos(folder), policy: NO_MACHINE_HOME };

async function reposOf(deps: LocateDeps, folder: string): Promise<string[]> {
    try {
        return (await deps.repos(folder)).repos.map((repo) => repo.path);
    } catch {
        return [];
    }
}

/* Judged on the path and on where it really leads, so a link to the machine's own state does not even say that state is there. */
async function isOpenKind(policy: MachineHomePolicy, path: string, directory: boolean): Promise<boolean> {
    if (isMachineStatePath(policy, path)) {
        return false;
    }
    try {
        const real = await realpath(path);
        if (isMachineStatePath(policy, real)) {
            return false;
        }
        const found = await stat(real);
        return directory ? found.isDirectory() : found.isFile();
    } catch {
        return false;
    }
}

/*
 * An agent writes a path from wherever it stands: its own folder, the root of a submodule it went into,
 * or the checkout a worktree was cut from. The agent's own folder wins outright; only when the path is
 * not there are the other folders tried, and every one that holds it is an answer.
 */
export async function locateFile(payload: FsLocatePayload, deps: LocateDeps = REAL_DEPS): Promise<FsLocateResult> {
    const directory = payload.directory === true;
    const open = (path: string): Promise<boolean> => isOpenKind(deps.policy, path, directory);
    if (isAbsolute(payload.path)) {
        const path = resolve(payload.path);
        return { matches: (await open(path)) ? [path] : [] };
    }
    const own = resolve(payload.cwd, payload.path);
    if (await open(own)) {
        return { matches: [own] };
    }
    const bases = [...(await reposOf(deps, payload.cwd))];
    if (payload.folder !== undefined && resolve(payload.folder) !== resolve(payload.cwd)) {
        bases.push(resolve(payload.folder), ...(await reposOf(deps, payload.folder)));
    }
    const matches: string[] = [];
    for (const path of new Set(bases.map((base) => resolve(base, payload.path)))) {
        if (path !== own && (await open(path))) {
            matches.push(path);
            if (matches.length >= FS_LOCATE_MAX_MATCHES) {
                break;
            }
        }
    }
    return { matches };
}
