import { chatOpener } from '@adecore/agents/chat';
import { ClientSinks } from '../client-sinks.ts';
import { errorText } from '../error-text.ts';
import { RoutineAuthorStore, RoutineRunStore } from '../routines/routine-runs.ts';
import { RoutineStore } from '../routines/routine-store.ts';
import { routineOpener, Routines } from '../routines/routines.ts';
import { runCommand } from '../routines/command-run.ts';
import type { SessionSink } from '../sessions/manager.ts';
import type { AgentStores, AgentsBundle } from './agents.ts';
import type { ArtifactsBundle } from './artifacts.ts';
import type { LaunchesBundle } from './launches.ts';
import type { ProjectsBundle } from './projects.ts';

/* The clients that asked with `routine.watch`, who hear a project's routines change. */
export class RoutineWatchers {
    private readonly sinks = new ClientSinks();
    private readonly watching = new Set<string>();

    subscribe(clientId: string, sink: SessionSink): () => void {
        const unsubscribe = this.sinks.subscribe(clientId, sink);
        return () => {
            this.watching.delete(clientId);
            unsubscribe();
        };
    }

    watch(clientId: string): void {
        this.watching.add(clientId);
    }

    unwatch(clientId: string): void {
        this.watching.delete(clientId);
    }

    changed(projectId: string): void {
        for (const clientId of this.watching) {
            this.sinks.to(clientId, { event: 'routine.changed', payload: { projectId } });
        }
    }
}

export interface RoutinesBundle {
    routines: Routines;
    store: RoutineStore;
    watchers: RoutineWatchers;
}

export interface RoutinesInput {
    home: string;
    machineId: string;
    stores: AgentStores;
    agents: AgentsBundle;
    projects: ProjectsBundle;
    launches: LaunchesBundle;
    artifacts: ArtifactsBundle;
}

/* Routines on this machine: their files in each project, what ran and the clock the outbox keeps for them. */
export async function wireRoutines({ home, machineId, stores, agents, projects, launches, artifacts }: RoutinesInput): Promise<RoutinesBundle> {
    const project = projects.store;
    const { chats, outboxLink } = agents;
    const runs = new RoutineRunStore(home);
    const authors = new RoutineAuthorStore(home);
    await Promise.all([runs.load(), authors.load()]);
    const store = new RoutineStore({ folderOf: (projectId) => project.index.folderOf(projectId) });
    const watchers = new RoutineWatchers();
    const placed = (nodeId: string): boolean => project.index.locate(nodeId) !== null;
    const openChat = chatOpener({ chats, placed });
    const versionsUnder = (projectId: string, key: string) => {
        const summary = artifacts.store.list({ projectId }).find((candidate) => candidate.key === key);
        return summary === undefined ? null : artifacts.store.get(summary.artifactId);
    };
    const routines = new Routines({
        store,
        runs,
        authors,
        approvals: stores.commandApprovals,
        projects: async () => (await project.known()).filter((known) => project.index.has(known.projectId)),
        outbox: {
            enqueue: (projectId, target, work, notBefore) => outboxLink.enqueue(projectId, target, work, notBefore),
            list: () => stores.outbox.list(),
            remove: (id) => stores.outbox.remove(id)
        },
        agents: {
            start: async ({ projectId, folder, chatId, routine, account, prompt, brief }) => {
                // A hidden agent of the routine: in the project without a canvas, and kept when the routine goes.
                await project.hiddenAgents.put({
                    projectId,
                    openedBy: routineOpener(routine.id),
                    node: { id: chatId, kind: 'chat', title: routine.title, x: 0, y: 0, w: 480, h: 560 }
                });
                await stores.prompts.put(projectId, chatId, prompt, brief);
                await outboxLink.enqueue(projectId, chatId, {
                    kind: 'start-agent',
                    payload: {
                        node: 'chat',
                        provider: routine.provider,
                        ...(routine.selection === undefined ? {} : { selection: routine.selection }),
                        cwd: folder,
                        runtimeMode: routine.mode,
                        // The mode a person approved is the widest anything the run starts may have.
                        ceiling: routine.mode,
                        ...(account === undefined ? {} : { account })
                    }
                });
            },
            info: (chatId) => chats.get(chatId)?.info,
            starting: (chatId) => stores.outbox.list().some((entry) => entry.kind === 'start-agent' && entry.target === chatId),
            continueIn: async (chatId, { prompt, brief }, label) => {
                const chat = await openChat(chatId);
                if (chat === null || chat.relocating?.() === true) {
                    return false;
                }
                return chats.withBrief(chatId, brief, () => chat.wake({ text: prompt, label, taskIds: [] }));
            },
            // Opens a stored chat as well, so what it ran before is known before the run's turn opens.
            exists: async (chatId) => placed(chatId) && (await openChat(chatId)) !== null
        },
        commands: { run: runCommand },
        launches: {
            approved: async (projectId, launchId) => (await launches.store.resolve(projectId, launchId)).approved,
            run: async (projectId, launchId) => {
                const result = await launches.runner.start(projectId, launchId, { actor: 'agent' });
                if (result.outcome !== 'started') {
                    return { outcome: result.outcome };
                }
                const ended = launches.runner.ended(projectId, launchId);
                if (ended === null) {
                    return { outcome: 'busy' };
                }
                return {
                    outcome: 'started',
                    ended: ended.then(async (status) => {
                        const sessionId = launches.runner.sessionOf(projectId, launchId);
                        const text = sessionId === null ? null : await agents.sessions.get(sessionId)?.plainText();
                        return { exitCode: status.exitCode ?? 1, output: new TextEncoder().encode(text ?? '') };
                    })
                };
            }
        },
        output: {
            latest: (projectId, key) => {
                const found = versionsUnder(projectId, key);
                const version = found?.versions[0];
                return found && version ? { artifactId: found.artifact.artifactId, versionId: version.versionId, number: version.number } : null;
            },
            byRun: (projectId, key) => {
                const found = versionsUnder(projectId, key);
                const byRun = new Map<string, { artifactId: string; versionId: string; number: number }>();
                for (const version of found?.versions ?? []) {
                    const runId = version.provenance.runId;
                    if (runId !== undefined && !byRun.has(runId)) {
                        byRun.set(runId, { artifactId: found!.artifact.artifactId, versionId: version.versionId, number: version.number });
                    }
                }
                return byRun;
            },
            deliver: async ({ projectId, key, title, requestId, provenance, text }) => {
                await artifacts.artifacts.deliver({
                    projectId,
                    key,
                    title,
                    kind: 'report',
                    requestId,
                    provenance,
                    files: [{ name: 'output.txt', bytes: text }]
                });
            }
        },
        machineId,
        now: () => Date.now(),
        timeZone: () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        onChanged: (projectId) => watchers.changed(projectId)
    });
    store.onOutsideChange = (projectId) => {
        void routines
            .schedule(projectId)
            .then(() => watchers.changed(projectId))
            .catch((e: unknown) => console.error('Scheduling routines after an outside edit failed:', errorText(e)));
    };
    // An observer hears a chat's thread and never `chat.status`, which goes to clients only; its info events carry the same.
    chats.observe((event) => {
        if (event.event !== 'chat.event') {
            return;
        }
        const { chatId, event: chatEvent } = event.payload;
        if (chatEvent.type === 'info' || chatEvent.type === 'reset') {
            void routines.observe(chatId, chatEvent.info).catch((e: unknown) => console.error('Noting a routine run failed:', errorText(e)));
        }
    });
    return { routines, store, watchers };
}
