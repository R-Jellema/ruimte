import { lstat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { AgentLineageStore } from '@adecore/agents/coordination';
import type { ChatInfo, ChatMovePayload, ChatMoveRefusal, ChatMoveResult, ProjectChatView, ProjectContent, ProjectSummary } from '@ruimte/contracts';
import { isInside } from '../canvas/project-paths.ts';
import { moveClaudeTranscript } from '../chat/claude-move.ts';
import { ChatError } from '../chat/errors.ts';
import { errorText } from '../error-text.ts';
import { ownFileConflicts, ownFileNames } from './move-info.ts';
import type { MoveJournal } from './move-journal.ts';
import { moveOwnFiles } from './own-files.ts';
import type { MutationApply } from './project-store.ts';

const REFUSAL_SENTENCES: Record<ChatMoveRefusal['reason'], string> = {
    'not-in-chats': 'Only a chat in Chats can move to a project',
    working: 'This chat is still working. Stop it or wait for it to finish, then try again',
    agents: 'This chat started agents of its own, or an agent started it. A chat with agents cannot move to a project yet',
    tasks: 'This chat gave or has a task. A chat with tasks cannot move to a project yet',
    owed: 'The machine still owes this chat work. Try again once it is done',
    messages: 'Messages from other chats still wait for this chat. It reads them in its next turn; move it after that',
    'pr-watch': 'This chat watches a pull request. Stop watching it first'
};

/* The English sentence a refused move carries on its reply; the client writes its own words from the reason. */
export function moveRefusalSentence(refusal: ChatMoveRefusal): string {
    return REFUSAL_SENTENCES[refusal.reason];
}

export interface MoveChatDeps {
    refusal(chatId: string): ChatMoveRefusal | null;
    /* The folder of the Chats project, which no chat moves into. */
    scratchFolder: string;
    ownFolder(chatId: string): string;
    /* Throws for a folder that holds the machine's own state (`MachineHome.refuse`). */
    refuseFolder(folder: string): Promise<void>;
    projects: {
        known(): Promise<Array<{ projectId: string; name: string; folder: string }>>;
        /* Makes the project of a folder, and the folder when asked; holds nothing, so a failed move leaves no watcher behind. */
        make(payload: { folder: string; name: string; createFolder: boolean }): Promise<{ projectId: string; name: string }>;
        mutate<T>(projectId: string, apply: MutationApply<T>): Promise<T>;
        read(projectId: string): Promise<ProjectContent>;
        overlayFieldsOf(projectId: string): Promise<string[]>;
        summary(projectId: string): Promise<ProjectSummary>;
    };
    /* Starts a repository in a folder. */
    initGit(folder: string): Promise<void>;
    chats: {
        /* The chat's record, loaded from disk when nobody has it; throws `chat-not-found` for an id with no chat. */
        load(chatId: string): Promise<ChatInfo>;
        relocate(chatId: string, cwd: string, during: () => Promise<void>): Promise<ChatInfo>;
        deliverNote(chatId: string, delivery: { noteId: string; note: string; preamble: string }): Promise<boolean>;
        claudeProjectsDirOf(info: Pick<ChatInfo, 'account'>): string;
    };
    lineage: Pick<AgentLineageStore, 'projectOf' | 'rehome'>;
    /* Written before the first step and dropped once the move is whole or put back, so a stop in between is finished at the next start (`move-repair.ts`). */
    journal?: Pick<MoveJournal, 'begin' | 'end'>;
    /* Seams for a test that makes a step fail; the file system's own by default. */
    moveTranscript?: typeof moveClaudeTranscript;
    moveOwnFiles?: typeof moveOwnFiles;
}

async function exists(path: string): Promise<boolean> {
    return (await lstat(path).catch(() => null)) !== null;
}

function refuse(deps: MoveChatDeps, chatId: string): void {
    const refusal = deps.refusal(chatId);
    if (refusal !== null) {
        throw new ChatError('move-refused', moveRefusalSentence(refusal));
    }
}

/* The node of a chat view in its new project: it works in the project folder, so it names no folder of its own. */
function movedView(view: ProjectChatView): ProjectChatView {
    const { cwd: _cwd, ...node } = view.node;
    const { empty: _empty, ...rest } = view;
    return { ...rest, node };
}

function chatViewOf(content: ProjectContent, chatId: string): ProjectChatView {
    const view = content.views.find((entry) => entry.id === chatId);
    if (view?.kind !== 'chat') {
        throw new ChatError('move-refused', moveRefusalSentence({ reason: 'not-in-chats' }));
    }
    return view;
}

async function makeProject(payload: ChatMovePayload, folder: string, deps: MoveChatDeps): Promise<{ projectId: string; name: string }> {
    if (!('folder' in payload.to)) {
        throw new ChatError('move-failed', 'No folder to make a project in');
    }
    const made = await deps.projects.make({ folder, name: payload.to.name, createFolder: payload.to.createFolder });
    if (payload.to.initGit && !(await exists(join(folder, '.git')))) {
        await deps.initGit(folder).catch((e: unknown) => {
            throw new ChatError('move-failed', `A git repository could not be started in ${folder}: ${errorText(e)}`);
        });
    }
    return made;
}

/*
 * Moves a chat from Chats into a project it finds or makes, as a whole or not at all. Every step that
 * changes something has its undo, run in reverse when a later step throws, and the working folder of
 * the chat only changes once its CLI is gone (`ChatCore.relocate`). Order inside: the target is
 * written first, a fork's lineage follows before the Chats write (which would otherwise drop an
 * unspoken fork's record), and a project places the chat at every moment between the two writes.
 * A project made for the move stays when the move fails; asking again moves into it.
 */
export async function moveChat(payload: ChatMovePayload, deps: MoveChatDeps): Promise<ChatMoveResult> {
    const { chatId } = payload;
    refuse(deps, chatId);
    const ownFolder = deps.ownFolder(chatId);
    const known = await deps.projects.known();
    const { to } = payload;
    const chosen = 'projectId' in to ? known.find((project) => project.projectId === to.projectId) : undefined;
    if ('projectId' in to && chosen === undefined) {
        throw new ChatError('move-failed', `No project ${to.projectId} on this machine`);
    }
    const folder = chosen?.folder ?? resolve('folder' in to ? to.folder : '');
    // Another chat's folder is no project: it would put the chat inside what Chats still owns.
    if (isInside(deps.scratchFolder, folder)) {
        throw new ChatError('move-failed', 'A chat cannot move into the folder of Chats');
    }
    await deps.refuseFolder(folder);

    const names = payload.ownFiles === 'move' ? await ownFileNames(ownFolder) : [];
    const [taken] = await ownFileConflicts(names, folder, 1);
    if (taken !== undefined) {
        throw new ChatError('files-conflict', `${taken} is already in ${folder}`);
    }

    const chats = known.find((project) => project.folder === deps.scratchFolder);
    if (chats === undefined) {
        throw new ChatError('move-refused', moveRefusalSentence({ reason: 'not-in-chats' }));
    }
    const target = chosen ?? known.find((project) => project.folder === folder) ?? (await makeProject(payload, folder, deps));
    const info = await deps.chats.load(chatId);
    refuse(deps, chatId);

    const undo: Array<() => Promise<void>> = [];
    let leftAt: string | null = null;
    let whole = false;
    /* Puts back every step, last first; false when one could not be, which leaves the journal for the next start. */
    const rollback = async (): Promise<boolean> => {
        let complete = true;
        for (const step of undo.toReversed()) {
            await step().catch((failure: unknown) => {
                complete = false;
                console.error(`Putting back a step of a failed chat move failed: ${errorText(failure)}`);
            });
        }
        undo.length = 0;
        return complete;
    };
    const during = async (): Promise<void> => {
        try {
            await deps.journal?.begin({ chatId, to: target.projectId, folder });
            const projectsDir = deps.chats.claudeProjectsDirOf(info);
            if (info.provider === 'claude' && info.agentSessionId !== null && projectsDir !== '') {
                const transcript = await (deps.moveTranscript ?? moveClaudeTranscript)({
                    projectsDir,
                    sessionId: info.agentSessionId,
                    fromCwd: info.cwd,
                    toCwd: folder
                });
                undo.push(() => transcript.undo());
            }
            // A task or a message that came while the CLI ended still refuses.
            refuse(deps, chatId);

            const leaving = await deps.projects.read(chats.projectId);
            const view = chatViewOf(leaving, chatId);
            const flag = leaving.flags?.[chatId];
            const adopted = (await deps.projects.overlayFieldsOf(chats.projectId)).filter((field) => Object.hasOwn(view.node, field));
            await deps.projects.mutate(target.projectId, (content, context) => ({
                content: {
                    ...content,
                    views: [movedView(view), ...content.views],
                    ...(flag === undefined ? {} : { flags: { ...content.flags, [chatId]: flag } })
                },
                result: undefined,
                overlayFields: [...new Set([...context.overlayFields, ...adopted])]
            }));
            undo.push(() =>
                deps.projects.mutate(target.projectId, (content) => ({
                    content: { ...content, views: content.views.filter((entry) => entry.id !== chatId) },
                    result: undefined
                }))
            );

            const fromProject = deps.lineage.projectOf(chatId);
            if (fromProject !== null) {
                await deps.lineage.rehome(chatId, target.projectId);
                undo.push(async () => {
                    await deps.lineage.rehome(chatId, fromProject);
                });
            }

            let position = 0;
            await deps.projects.mutate(chats.projectId, (content, context) => {
                chatViewOf(content, chatId);
                position = content.views.findIndex((entry) => entry.id === chatId);
                const rest = content.views.filter((entry) => entry.id !== chatId);
                // Fields a node of Chats still carries stay declared there.
                const inUse = new Set(rest.flatMap((entry) => (entry.kind === 'chat' ? Object.keys(entry.node) : [])));
                return {
                    content: { ...content, views: rest },
                    result: undefined,
                    overlayFields: context.overlayFields.filter((field) => !adopted.includes(field) || inUse.has(field))
                };
            });
            undo.push(() =>
                deps.projects.mutate(chats.projectId, (content, context) => {
                    const views = content.views.filter((entry) => entry.id !== chatId);
                    views.splice(Math.min(position, views.length), 0, view);
                    return { content: { ...content, views }, result: undefined, overlayFields: [...new Set([...context.overlayFields, ...adopted])] };
                })
            );

            if (payload.ownFiles === 'move') {
                const moved = await (deps.moveOwnFiles ?? moveOwnFiles)(ownFolder, folder);
                undo.push(() => moved.undo());
            } else if ((await ownFileNames(ownFolder)).length > 0) {
                leftAt = ownFolder;
            }
            whole = true;
        } catch (e) {
            if (await rollback()) {
                await deps.journal?.end(chatId);
            }
            throw e;
        }
    };

    try {
        await deps.chats.relocate(chatId, folder, during);
        await deps.journal?.end(chatId);
    } catch (e) {
        // The steps are done but the record could not take the new folder, which `relocate` has put back.
        if (whole && (await rollback())) {
            await deps.journal?.end(chatId);
        }
        if (e instanceof ChatError && e.code === 'chat-busy') {
            throw new ChatError('move-refused', moveRefusalSentence({ reason: 'working' }));
        }
        throw e;
    }

    const stays = leftAt === null ? '' : ` Its own files stay in ${leftAt}.`;
    const earlier = leftAt === null ? 'Files you made earlier moved there with you.' : `Files you made earlier are still in ${leftAt}.`;
    await deps.chats
        .deliverNote(chatId, {
            noteId: `moved-${target.projectId}`,
            note: `Moved from Chats to ${target.name}.${stays}`,
            preamble: `This chat moved from Chats to the project ${target.name}. Your working directory is now ${folder}. ${earlier}`
        })
        .catch((e: unknown) => console.error(`Leaving the note of a moved chat failed: ${errorText(e)}`));
    return { summary: await deps.projects.summary(target.projectId), viewId: chatId, ownFilesLeftAt: leftAt };
}
