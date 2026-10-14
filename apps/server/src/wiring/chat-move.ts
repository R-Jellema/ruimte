import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname } from 'node:path';
import type { AgentLineageStore, NoticeStore, TaskStore } from '@adecore/agents/coordination';
import { chatIsWorking } from '@ruimte/contracts';
import type { MachineHome } from '../fs/machine-home.ts';
import type { ChatManager } from '../chat/chat-manager.ts';
import { ChatError } from '../chat/errors.ts';
import type { ChatMoveHandlers } from '../handlers/chat.ts';
import { gitOrThrow, readGit } from '../git/run.ts';
import { repositoryRoot } from '../git/status.ts';
import type { PrWatchStore } from '../github/pr-watch.ts';
import type { OutboxStore } from '../outbox/outbox.ts';
import { moveChat, type MoveChatDeps } from '../projects/move-chat.ts';
import { chatMoveInfo, type MoveInfoDeps } from '../projects/move-info.ts';
import { ownFolderOf } from '../projects/own-files.ts';
import { moveRefusal, type MoveRefusalDeps } from '../projects/move-refusal.ts';
import type { ProjectStore } from '../projects/project-store.ts';

export interface ChatMoveWiring {
    chats: ChatManager;
    store: ProjectStore;
    lineage: AgentLineageStore;
    tasks: TaskStore;
    outbox: OutboxStore;
    notices: NoticeStore;
    prWatches: PrWatchStore;
    machineHome: Pick<MachineHome, 'refuse'>;
}

/* The checkout above a path that may be gone by now, by the nearest folder that still exists. */
async function repositoryAbove(directory: string): Promise<string | null> {
    let current = directory;
    for (;;) {
        if ((await stat(current).catch(() => null))?.isDirectory()) {
            return repositoryRoot(current);
        }
        const parent = dirname(current);
        if (parent === current) {
            return null;
        }
        current = parent;
    }
}

async function branchOf(folder: string): Promise<string | null> {
    const branch = (await readGit(['rev-parse', '--abbrev-ref', 'HEAD'], folder))?.trim();
    return branch === undefined || branch === '' || branch === 'HEAD' ? null : branch;
}

export function chatMoveRefusalDeps(wiring: ChatMoveWiring): MoveRefusalDeps {
    const { chats, store, lineage, tasks, outbox, notices, prWatches } = wiring;
    return {
        inChats: (chatId) => {
            const place = store.index.locate(chatId);
            return (
                place !== null &&
                place.folder === store.scratchFolder &&
                place.canvasId === null &&
                (store.index.viewsOf(place.projectId) ?? []).some((view) => view.id === chatId && view.kind === 'chat')
            );
        },
        working: (chatId) => {
            const session = chats.get(chatId);
            return session !== undefined && (session.busy || chatIsWorking(session.info));
        },
        lineage,
        tasks,
        outbox,
        notices,
        prWatches
    };
}

/* What the move dialog asks the machine, and the move itself. */
export function chatMoveHandlers(wiring: ChatMoveWiring): ChatMoveHandlers {
    const deps = chatMoveDeps(wiring);
    return { info: (payload) => chatMoveInfo(payload, deps.info), move: (payload) => moveChat(payload, deps.move) };
}

/* The pieces of both requests over the daemon's stores; a test replaces one to make a step fail. */
export function chatMoveDeps(wiring: ChatMoveWiring): { info: MoveInfoDeps; move: MoveChatDeps } {
    const { chats, store } = wiring;
    const refusalDeps = chatMoveRefusalDeps(wiring);
    const registry = async (): Promise<Array<{ projectId: string; name: string; folder: string; available: boolean }>> =>
        await Promise.all(
            (await store.known()).map(async (project) => ({
                ...project,
                available: (await stat(project.folder).catch(() => null))?.isDirectory() ?? false
            }))
        );
    const infoDeps: MoveInfoDeps = {
        home: homedir(),
        ruimteHome: store.home,
        refusal: (chatId) => moveRefusal(chatId, refusalDeps),
        thread: async (chatId) => {
            const stored = await chats.readChat(chatId);
            return stored === null ? null : { cwd: stored.info.cwd, items: stored.items };
        },
        ownFolder: (chatId) => ownFolderOf(store.scratchFolder, chatId),
        chatsInChats: async () => {
            const scratch = (await registry()).find((project) => project.folder === store.scratchFolder);
            return (store.index.viewsOf(scratch?.projectId ?? '') ?? [])
                .filter((view) => view.kind === 'chat' && refusalDeps.inChats(view.id))
                .map((view) => view.id);
        },
        projects: async () => (await registry()).filter((project) => project.folder !== store.scratchFolder),
        branchOf,
        gitRoot: repositoryAbove,
        refuseFolder: (folder) => wiring.machineHome.refuse(folder)
    };
    const moveDeps: MoveChatDeps = {
        refusal: infoDeps.refusal,
        scratchFolder: store.scratchFolder,
        ownFolder: infoDeps.ownFolder,
        refuseFolder: infoDeps.refuseFolder,
        projects: {
            known: () => store.known(),
            make: async (payload) => {
                const { summary } = await store.openProject(payload);
                // Opened for the file, not for a client: the window that follows the move holds it itself.
                if (store.holdersOf(summary.projectId).length === 0) {
                    store.release(summary.projectId);
                }
                return { projectId: summary.projectId, name: summary.name };
            },
            mutate: (projectId, apply) => store.mutate(projectId, apply),
            read: (projectId) => store.read(projectId),
            overlayFieldsOf: (projectId) => store.overlayFieldsOf(projectId),
            summary: async (projectId) => {
                const summary = (await store.list()).find((candidate) => candidate.projectId === projectId);
                if (summary === undefined) {
                    throw new ChatError('move-failed', `The project ${projectId} left the machine's list while the chat moved`);
                }
                return summary;
            }
        },
        initGit: async (folder) => {
            await gitOrThrow(['init'], folder);
        },
        chats: {
            load: async (chatId) => {
                if (chats.get(chatId) === undefined) {
                    if (!(await chats.hasStored(chatId))) {
                        throw new ChatError('chat-not-found', `No chat ${chatId}`);
                    }
                    await chats.create({ chatId });
                }
                const session = chats.get(chatId);
                if (session === undefined) {
                    throw new ChatError('chat-not-found', `No chat ${chatId}`);
                }
                return session.info;
            },
            relocate: (chatId, cwd, during) => chats.relocate(chatId, cwd, during),
            deliverNote: (chatId, delivery) => chats.deliverNote(chatId, delivery),
            claudeProjectsDirOf: (info) => chats.claudeProjectsDirOf(info)
        },
        lineage: wiring.lineage
    };
    return { info: infoDeps, move: moveDeps };
}
