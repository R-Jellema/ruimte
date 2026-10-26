import { join } from 'node:path';
import {
    readRoutineEntries,
    ROUTINE_LIMITS,
    ROUTINES_VERSION,
    RoutinesPrivateFileSchema,
    RoutinesSharedFileSchema,
    type Routine,
    type RoutineFileEntry,
    type RoutineLocal,
    type RoutinesPrivateFile,
    type RoutinesSharedFile
} from '@ruimte/contracts';
import { CodedError, Serializer, settled, SYSTEM_WATCH, type DirectoryWatcher, type Settled, type WatchSeams } from '@adecore/agents';
import { errorText } from '../error-text.ts';
import {
    PRIVATE_DIR,
    PROJECT_DIR,
    PROJECT_FILE,
    readJsonDocument,
    readTextOf,
    restOf,
    serializeJson as serialize,
    tooNewMessage,
    versionedParser,
    watchDirectories,
    writeGitignoreIfMissing,
    writeJsonDocument,
    type JsonDocumentParse,
    type JsonDocumentRead
} from '../projects/project-files.ts';

const ROUTINES_FILE = 'routines.json';

// The burst rule of the other project files: git and editors write more than once per save.
const WATCH_SETTLE_MS = 150;

type RoutineErrorCode =
    | 'project-not-found'
    | 'routine-not-found'
    | 'routines-invalid'
    | 'rev-conflict'
    | 'routine-held'
    | 'routine-busy'
    | 'too-many-routines'
    | 'digest-stale';

export class RoutineError extends CodedError<RoutineErrorCode> {}

/* A routine as this machine reads it: which file it lives in and what this person keeps of it. */
export interface StoredRoutine {
    routine: Routine;
    shared: boolean;
    local: RoutineLocal;
}

export interface RoutinesDocument {
    folder: string;
    rev: number;
    routines: StoredRoutine[];
}

interface LoadedRoutines {
    folder: string;
    rev: number;
    // The exact text last read or written, so the watcher tells our own write from someone else's.
    sharedText: string;
    privateText: string;
    shared: RoutineFileEntry[];
    // The top level of each file past what this release reads, written back as it was.
    sharedRest: Record<string, unknown>;
    own: RoutineFileEntry[];
    privateRest: Record<string, unknown>;
    order: string[];
    local: Record<string, RoutineLocal>;
    watchers: DirectoryWatcher[];
    settle: Settled | null;
}

const SHARED_KEYS = ['version', 'routines'];

const PRIVATE_KEYS = ['version', 'rev', 'order', 'routines', 'local'];

function sharedPathIn(folder: string): string {
    return join(folder, PROJECT_DIR, ROUTINES_FILE);
}

function privatePathIn(folder: string): string {
    return join(folder, PROJECT_DIR, PRIVATE_DIR, ROUTINES_FILE);
}

const parseShared = versionedParser<RoutinesSharedFile>(RoutinesSharedFileSchema, ROUTINES_VERSION);
const parsePrivate = versionedParser<RoutinesPrivateFile>(RoutinesPrivateFileSchema, ROUTINES_VERSION);

function routinesOf(entries: readonly RoutineFileEntry[]): Routine[] {
    return entries.flatMap((entry) => ('routine' in entry ? [entry.routine] : []));
}

function rawOf(entries: readonly RoutineFileEntry[]): unknown[] {
    return entries.flatMap((entry) => ('raw' in entry ? [entry.raw] : []));
}

function isEmptyLocal(local: RoutineLocal | undefined): boolean {
    return local === undefined || Object.values(local).every((value) => value === undefined);
}

function withoutEmpty(local: Record<string, RoutineLocal>): Record<string, RoutineLocal> {
    return Object.fromEntries(Object.entries(local).filter(([, value]) => !isEmptyLocal(value)));
}

/*
 * The routines of every project on this machine, open or not: `.ruimte/routines.json`, which a team
 * commits, and `.ruimte/private/routines.json`, which holds the rev, the order over both files, this
 * person's own routines and what each keeps on this machine (account, pause, a refusal). Every write
 * goes against the rev it read. Whether a routine may run here is in neither file: an agent with a
 * shell can write both, so the approval lives under `$RUIMTE_HOME`.
 */
export class RoutineStore {
    private readonly folderOf: (projectId: string) => string | null;
    private readonly seams: WatchSeams;
    private readonly loaded = new Map<string, LoadedRoutines>();
    private readonly writes = new Serializer();
    /* Hears a change of a project's routines that came from outside this store: a pull, a hand edit, an agent with a shell. */
    onOutsideChange: ((projectId: string) => void) | null = null;

    constructor(options: { folderOf(projectId: string): string | null; seams?: WatchSeams }) {
        this.folderOf = options.folderOf;
        this.seams = options.seams ?? SYSTEM_WATCH;
    }

    read(projectId: string): Promise<RoutinesDocument> {
        return this.writes.run(async () => documentOf(await this.load(projectId)));
    }

    /* The files as they stand on disk now, taking in a write the watcher did not report yet. */
    fresh(projectId: string): Promise<RoutinesDocument> {
        return this.writes.run(async () => {
            const state = await this.load(projectId);
            await this.takeOutsideEdits(projectId, state);
            return documentOf(state);
        });
    }

    /* Adds or replaces one routine in the file `shared` names, taking it out of the other. */
    put(projectId: string, baseRev: number, routine: Routine, shared: boolean, local?: Partial<RoutineLocal>): Promise<RoutinesDocument> {
        return this.writes.run(async () => {
            const state = await this.writable(projectId, baseRev);
            const sharedRoutines = routinesOf(state.shared).filter((candidate) => candidate.id !== routine.id);
            const own = routinesOf(state.own).filter((candidate) => candidate.id !== routine.id);
            if (sharedRoutines.length + own.length >= ROUTINE_LIMITS.perProject) {
                throw new RoutineError('too-many-routines', `A project keeps at most ${ROUTINE_LIMITS.perProject} routines`);
            }
            const order = state.order.includes(routine.id) ? state.order : [...state.order, routine.id];
            const nextLocal = local === undefined ? state.local : { ...state.local, [routine.id]: { ...state.local[routine.id], ...local } };
            await this.write(state, {
                shared: shared ? [...sharedRoutines, routine] : sharedRoutines,
                own: shared ? own : [...own, routine],
                order,
                local: nextLocal
            });
            return documentOf(state);
        });
    }

    /* Changes only what this person keeps of a routine, in the private file; never against a rev, since nothing a teammate wrote is touched. */
    setLocal(projectId: string, routineId: string, patch: Partial<RoutineLocal>): Promise<RoutinesDocument> {
        return this.writes.run(async () => {
            const state = await this.load(projectId);
            await this.takeOutsideEdits(projectId, state);
            if (!ordered(state).some((routine) => routine.id === routineId)) {
                throw new RoutineError('routine-not-found', `This project has no routine ${routineId}`);
            }
            const merged = { ...state.local[routineId], ...patch };
            await this.write(state, {
                shared: routinesOf(state.shared),
                own: routinesOf(state.own),
                order: state.order,
                local: { ...state.local, [routineId]: merged }
            });
            return documentOf(state);
        });
    }

    remove(projectId: string, baseRev: number, routineId: string): Promise<RoutinesDocument> {
        return this.writes.run(async () => {
            const state = await this.writable(projectId, baseRev);
            const { [routineId]: _gone, ...local } = state.local;
            await this.write(state, {
                shared: routinesOf(state.shared).filter((routine) => routine.id !== routineId),
                own: routinesOf(state.own).filter((routine) => routine.id !== routineId),
                order: state.order.filter((id) => id !== routineId),
                local
            });
            return documentOf(state);
        });
    }

    /* Stops watching a project the machine no longer knows; the next read loads it again. */
    forget(projectId: string): void {
        const state = this.loaded.get(projectId);
        if (!state) {
            return;
        }
        for (const watcher of state.watchers) {
            watcher.close();
        }
        state.settle?.stop();
        this.loaded.delete(projectId);
    }

    closeAll(): void {
        for (const projectId of [...this.loaded.keys()]) {
            this.forget(projectId);
        }
    }

    private async writable(projectId: string, baseRev: number): Promise<LoadedRoutines> {
        const state = await this.load(projectId);
        if (baseRev !== state.rev) {
            throw new RoutineError('rev-conflict', `The routines are at rev ${state.rev}, the save was based on ${baseRev}`);
        }
        if (await this.takeOutsideEdits(projectId, state)) {
            throw new RoutineError('rev-conflict', `The routines changed on disk; they are now at rev ${state.rev}`);
        }
        return state;
    }

    private async write(
        state: LoadedRoutines,
        next: { shared: Routine[]; own: Routine[]; order: string[]; local: Record<string, RoutineLocal> }
    ): Promise<void> {
        const sharedFile = { version: ROUTINES_VERSION, ...state.sharedRest, routines: [...next.shared, ...rawOf(state.shared)] };
        const local = withoutEmpty(next.local);
        const privateFile = {
            version: ROUTINES_VERSION,
            ...state.privateRest,
            rev: state.rev + 1,
            order: next.order,
            routines: [...next.own, ...rawOf(state.own)],
            local
        };
        const sharedText = serialize(sharedFile);
        // A project that never shared a routine gets no file for git to see.
        if (sharedText !== state.sharedText && (state.sharedText !== '' || sharedFile.routines.length > 0)) {
            state.sharedText = await writeJsonDocument(sharedPathIn(state.folder), sharedFile, serialize);
        }
        await writeGitignoreIfMissing(join(state.folder, PROJECT_DIR, PROJECT_FILE));
        state.privateText = await writeJsonDocument(privatePathIn(state.folder), privateFile, serialize);
        state.rev = privateFile.rev;
        state.shared = readRoutineEntries(sharedFile.routines);
        state.own = readRoutineEntries(privateFile.routines);
        state.order = privateFile.order;
        state.local = local;
    }

    private async load(projectId: string): Promise<LoadedRoutines> {
        const known = this.loaded.get(projectId);
        if (known) {
            return known;
        }
        const folder = this.folderOf(projectId);
        if (folder === null) {
            throw new RoutineError('project-not-found', `No project ${projectId} on this machine`);
        }
        const state: LoadedRoutines = {
            folder,
            rev: 0,
            sharedText: '',
            privateText: '',
            shared: [],
            sharedRest: {},
            own: [],
            privateRest: {},
            order: [],
            local: {},
            watchers: [],
            settle: null
        };
        const [shared, own] = await Promise.all([readRoutineFile(sharedPathIn(folder), parseShared), readRoutineFile(privatePathIn(folder), parsePrivate)]);
        takeShared(state, shared);
        takePrivate(state, own);
        this.loaded.set(projectId, state);
        this.watch(projectId, state);
        return state;
    }

    /* Takes in a write the watcher has not reported yet; true when there was one. */
    private async takeOutsideEdits(projectId: string, state: LoadedRoutines): Promise<boolean> {
        const [shared, own] = await Promise.all([
            readRoutineFile(sharedPathIn(state.folder), parseShared, false),
            readRoutineFile(privatePathIn(state.folder), parsePrivate, false)
        ]);
        const sharedMoved = readTextOf(shared) !== null && readTextOf(shared) !== state.sharedText;
        const privateMoved = readTextOf(own) !== null && readTextOf(own) !== state.privateText;
        if (!sharedMoved && !privateMoved) {
            return false;
        }
        const rev = state.rev;
        if (sharedMoved) {
            takeShared(state, shared);
        }
        if (privateMoved) {
            takePrivate(state, own);
        }
        // A pull changes only the shared file, and a save against the rev from before it would write over it.
        state.rev = Math.max(state.rev, rev + 1);
        this.onOutsideChange?.(projectId);
        return true;
    }

    private watch(projectId: string, state: LoadedRoutines): void {
        state.settle = settled(this.seams, WATCH_SETTLE_MS, () =>
            this.writes
                .run(async () => {
                    if (this.loaded.get(projectId) === state) {
                        await this.takeOutsideEdits(projectId, state);
                    }
                })
                .catch((e: unknown) => {
                    console.warn(`An outside edit to the routines of ${state.folder} could not be taken in:`, errorText(e));
                })
        );
        const settle = state.settle;
        state.watchers = watchDirectories(this.seams, [join(state.folder, PROJECT_DIR), join(state.folder, PROJECT_DIR, PRIVATE_DIR)], (filename) => {
            if (filename === null || filename.endsWith(ROUTINES_FILE)) {
                settle.nudge();
            }
        });
    }
}

function documentOf(state: LoadedRoutines): RoutinesDocument {
    const sharedIds = new Set(routinesOf(state.shared).map((routine) => routine.id));
    return {
        folder: state.folder,
        rev: state.rev,
        routines: ordered(state).map((routine) => ({ routine, shared: sharedIds.has(routine.id), local: state.local[routine.id] ?? {} }))
    };
}

/* A file from a newer Ruimte is refused, never set aside: a later release reads it. */
async function readRoutineFile<T>(path: string, parse: (text: string) => JsonDocumentParse<T>, setAside = true): Promise<JsonDocumentRead<T>> {
    const read = await readJsonDocument(path, parse, { setAside });
    if (read.kind === 'too-new') {
        throw new RoutineError('routines-invalid', tooNewMessage('routine file', read.version, ROUTINES_VERSION));
    }
    if (read.kind === 'corrupt') {
        console.warn(`Set aside a routine file that would not parse: ${read.setAside}`);
    }
    return read;
}

function takeShared(state: LoadedRoutines, read: JsonDocumentRead<RoutinesSharedFile>): void {
    if (read.kind !== 'ok') {
        if (read.kind === 'missing') {
            state.sharedText = '';
            state.shared = [];
        }
        return;
    }
    state.sharedText = read.text;
    state.shared = readRoutineEntries(read.document.routines);
    state.sharedRest = restOf(read.document, SHARED_KEYS);
}

function takePrivate(state: LoadedRoutines, read: JsonDocumentRead<RoutinesPrivateFile>): void {
    if (read.kind !== 'ok') {
        if (read.kind === 'missing') {
            state.privateText = '';
            state.own = [];
            state.order = [];
            state.local = {};
        }
        return;
    }
    state.privateText = read.text;
    state.rev = read.document.rev;
    state.own = readRoutineEntries(read.document.routines ?? []);
    state.order = read.document.order ?? [];
    state.local = read.document.local ?? {};
    state.privateRest = restOf(read.document, PRIVATE_KEYS);
}

/* The routines of both files in the order a person keeps; one the order does not name goes after, shared first. A shared one wins an id both files hold. */
function ordered(state: LoadedRoutines): Routine[] {
    const seen = new Set<string>();
    const unique = [...routinesOf(state.shared), ...routinesOf(state.own)].filter((routine) => {
        if (seen.has(routine.id)) {
            return false;
        }
        seen.add(routine.id);
        return true;
    });
    const rank = new Map(state.order.map((id, index) => [id, index]));
    return unique
        .map((routine, index) => ({ routine, index }))
        .sort((a, b) => (rank.get(a.routine.id) ?? state.order.length + a.index) - (rank.get(b.routine.id) ?? state.order.length + b.index))
        .map(({ routine }) => routine);
}
