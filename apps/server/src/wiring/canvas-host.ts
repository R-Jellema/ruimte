import type { DiagramContent, RuntimeMode, VisualAppearance, VisualHeight, VisualLayout } from '@ruimte/contracts';
import { chatNoticeTargets, chatRequests, showNotices, type Notice } from '@adecore/agents/coordination';
import { agentStates } from '../agents/agent-state.ts';
import { openedAgentCount } from '../agents/hidden-agents.ts';
import type { AgentStart, CanvasHost, WorktreeWant } from '../canvas/verb.ts';
import { addWanted } from '../canvas/worktree.ts';
import { deliverNotice, MESSAGE_WORDS } from '../context/notices.ts';
import type { EndpointIdentity } from '../endpoint-id.ts';
import { errorText } from '../error-text.ts';
import { worktreeHost } from '../git/worktree-host.ts';
import { AgentLanguage } from '../language/agent-language.ts';
import type { LanguageHost } from '../language/host.ts';
import { nodeAccount, nodeMode, startAgentWork } from '../outbox/start-agent.ts';
import type { PushService } from '../push/service.ts';
import { previewVisual } from '../visuals/renderer.ts';
import type { AgentStores, AgentsBundle } from './agents.ts';
import type { AgentWorkBundle } from './agent-work.ts';
import type { DatabasesBundle } from './databases.ts';
import type { DevicesBundle } from './devices.ts';
import type { GitBundle } from './git.ts';
import type { LaunchesBundle } from './launches.ts';
import type { ProjectsBundle } from './projects.ts';
import type { ProvidersBundle } from './providers.ts';

export interface CanvasHostInput {
    identity: EndpointIdentity;
    stores: AgentStores;
    providers: ProvidersBundle;
    agents: AgentsBundle;
    projects: ProjectsBundle;
    work: AgentWorkBundle;
    launches: LaunchesBundle;
    git: GitBundle;
    devices: DevicesBundle;
    databases: DatabasesBundle;
    later: {
        language(): LanguageHost;
        push(): PushService;
    };
}

/* What the agent verbs reach the daemon through. */
export function wireCanvasHost(input: CanvasHostInput): CanvasHost {
    const { identity, stores, providers, agents, work, launches, git, devices, databases, later } = input;
    const { lineage, prompts, notices, outbox, tasks } = stores;
    const { sessions, chats, context, plans, visuals } = agents;
    const { store: projects, startClaims, diagrams, endSession } = input.projects;
    const modes = {
        chatMode: (id: string) => chats.get(id)?.info.runtimeMode,
        launch: (id: string) => sessions.get(id)?.launch,
        reportedMode: (id: string) => sessions.get(id)?.reportedMode,
        ceiling: (id: string) => lineage.ceilingOf(id)
    };
    /* Where a message a person has not seen goes: the thread of the chat left under that node id. */
    const noticeChat = {
        has: (id: string) => chats.hasStored(id),
        note: (id: string, text: string) => chats.addNote(id, 'info', text)
    };
    return {
        hiddenAgents: projects.hiddenAgents,
        startClaims,
        locate: (id: string) => projects.index.locate(id),
        read: (projectId: string) => projects.read(projectId),
        revision: (projectId: string) => projects.revision(projectId),
        mutate: projects.mutate.bind(projects),
        worktreePaths: git.worktreePaths,
        installedAgents: async () => (await providers.providers.list()).filter((provider) => provider.installed).map((provider) => provider.kind),
        holdPrompt: (projectId: string, nodeId: string, prompt: string) => prompts.put(projectId, nodeId, prompt),
        startAgent: (start: AgentStart) => work.worker.enqueue(start.projectId, start.nodeId, startAgentWork(start, modes)),
        modeOf: nodeMode(modes),
        accountOf: nodeAccount({ chat: (id) => chats.get(id)?.info, session: (id) => sessions.get(id) }),
        terminalModePreference: () => chats.composerPreferences.terminalMode(),
        branchesOf: (folder: string) => git.worktrees.branches(folder).catch(() => null),
        addWorktree: (folder: string, want: WorktreeWant, projectId: string) => addWanted(git.worktrees, folder, want, projectId),
        claimWorktree: (folder: string, path: string, nodeId: string) => git.worktrees.claim(folder, path, nodeId),
        removeWorktree: (folder: string, path: string) => git.worktrees.remove(folder, path),
        worktrees: worktreeHost(git.worktrees, git.merges),
        browsers: devices.browserDriver,
        devices: devices.deviceDriver,
        agents: agentStates({ outbox, lineage, chats, sessions }),
        requests: chatRequests(chats),
        computer: devices.computer,
        launches: launches.agentHost,
        secrets: launches.secrets,
        snoozedUntil: (nodeId: string) => work.snoozes.until(nodeId),
        databases: databases.agents,
        language: new AgentLanguage({
            host: {
                forAgent: (projectId, request, languageWork) => later.language().forAgent(projectId, request, languageWork),
                programOf: (kind) => later.language().programOf(kind)
            },
            sql: databases.sqlAnalysis
        }),
        visuals: {
            enabled: () => identity.visualReplies,
            writeSource: (chatId: string, name: string, html: string) => visuals.writeSource(chatId, name, html),
            publish: (chatId: string, visual: { title: string; html: string; maxHeight?: number; layout?: VisualLayout; heights?: VisualHeight[] }) =>
                chats.publishVisual(chatId, visual),
            list: (chatId: string) => chats.listVisuals(chatId),
            remove: (chatId: string, visualId: string) => chats.removeVisual(chatId, visualId),
            preview: (chatId: string, visual: { html: string; width: number; appearance: VisualAppearance }) =>
                previewVisual(devices.visualRenderer, (png) => visuals.writePreview(chatId, png), visual),
            measure: (html: string) => devices.visualRenderer.measure(html)
        },
        context: {
            list: (targetId: string) => context.list(targetId),
            read: (targetId: string, sourceId: string, tail: number | null, subagent: string | null) => context.answer(targetId, sourceId, tail, subagent)
        },
        depthOf: (nodeId: string) => lineage.depthOf(nodeId),
        openedCount: (callerId: string) => openedAgentCount({ lineage, hiddenAgents: projects.hiddenAgents, tasks, outbox, chats, sessions }, callerId),
        recordMade: (record: { projectId: string; nodeId: string; openedBy: string; depth: number; agent: boolean; ceiling?: RuntimeMode }) =>
            lineage.put(record),
        madeBy: (nodeId: string) => lineage.madeBy(nodeId),
        agentsDeleteAnyView: () => identity.agentsDeleteAnyView,
        showView: (projectId: string, viewId: string, by: string) => projects.showView(projectId, viewId, by),
        writeDiagram: (projectId: string, viewId: string, content: DiagramContent) => diagrams.write(projectId, viewId, content),
        tasks: work.tasks.host,
        plans,
        endSession,
        alert: (nodeId: string, text: string) => {
            const place = projects.index.locate(nodeId);
            if (!place) {
                throw new Error('The notifying session is no longer in a project');
            }
            later.push().notify(chats.get(nodeId) ? 'chat' : 'terminal', nodeId, projects.index.titleFor(nodeId) ?? 'Agent', text, {
                projectId: place.projectId,
                viewId: place.canvasId ?? nodeId
            });
        },
        notify: async (notice: Omit<Notice, 'createdAt'>) => {
            const delivery = await deliverNotice(
                notices,
                {
                    /* An exited session still lists its last screen, but nobody is reading it; its
                       message waits for the shell that takes the id over. */
                    terminal: (id) => {
                        const session = sessions.get(id);
                        return session && !session.exited ? { agent: session.agent, notice: (text: string) => session.notice(text) } : null;
                    },
                    ...chatNoticeTargets(chats)
                },
                notice
            );
            /* A chat shows it to a person the moment it lands. Never in the way of the answer to the
               sender: the message is in the queue by now, so the model hears it whatever a thread does. */
            await showNotices(notices, noticeChat, MESSAGE_WORDS, notice.targetId).catch((e) =>
                console.error(`Showing a message in chat ${notice.targetId} failed:`, errorText(e))
            );
            /* After the line in the thread, so a person sees the message itself above the turn it opens. */
            if (delivery.wake) {
                await work.worker.enqueue(notice.projectId, notice.targetId, { kind: 'deliver-message', payload: { from: notice.from } });
            }
            return delivery;
        }
    };
}
