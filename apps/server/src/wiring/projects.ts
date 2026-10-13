import { StartClaims } from '../actions/start-claims.ts';
import type { ComputerUse } from '../computer/computer-use.ts';
import { errorText } from '../error-text.ts';
import { isTrackedPath } from '../git/ignore.ts';
import { DiagramStore } from '../projects/diagram-store.ts';
import { DrawingStore } from '../projects/drawing-store.ts';
import { ProjectStore } from '../projects/project-store.ts';
import { commandsSet } from '../sessions/command-approvals.ts';
import { modesSet } from '../sessions/mode-approvals.ts';
import type { AgentStores, AgentsBundle } from './agents.ts';
import type { AgentWorkBundle } from './agent-work.ts';
import type { LaunchesBundle } from './launches.ts';

/* The projects of this machine and the drawing and diagram files beside them. */
export interface ProjectsBundle {
    store: ProjectStore;
    /* What a retried `agent --request-id` answers with. */
    startClaims: StartClaims;
    drawings: DrawingStore;
    diagrams: DiagramStore;
    /*
     * Ends the shell or the CLI behind a node. A node that has never been shown has no session, and a
     * project going down is not the place to fail over one, so an id neither manager knows is
     * already ended as far as the caller goes.
     */
    endSession(kind: 'terminal' | 'chat', nodeId: string): Promise<void>;
}

export interface ProjectsInput {
    home: string;
    stores: AgentStores;
    agents: AgentsBundle;
    computer: ComputerUse;
    later: {
        launches(): LaunchesBundle;
        work(): AgentWorkBundle;
    };
}

export async function wireProjects({ home, stores, agents, computer, later }: ProjectsInput): Promise<ProjectsBundle> {
    const { sessions, chats } = agents;
    const store = new ProjectStore(home);
    await store.hiddenAgents.load();
    const startClaims = new StartClaims(home);
    await startClaims.load();
    store.attachTracked(isTrackedPath);
    const endSession = async (kind: 'terminal' | 'chat', nodeId: string): Promise<void> => {
        computer.nodeClosed(nodeId);
        later.launches().secrets.nodeClosed(nodeId);
        await later.work().endChildren.owe(nodeId);
        await (kind === 'terminal' ? sessions.kill(nodeId) : chats.kill(nodeId)).catch(() => undefined);
    };
    store.attachSessionEnder(endSession);
    store.attachSaveListener(async (folder, before, after) => {
        for (const { nodeId, command } of commandsSet(before, after)) {
            try {
                await stores.commandApprovals.approve(folder, nodeId, command);
            } catch (e) {
                // Not approved is only asked again; the save itself already landed.
                console.error(`Approving the command of ${nodeId} failed:`, errorText(e));
                continue;
            }
            sessions.runApproved(nodeId, command);
        }
        for (const { nodeId, mode } of modesSet(before, after)) {
            // Not written down narrows the node to the mode its person picks for new terminals, which is safe to retry.
            await stores.modeApprovals
                .approve(folder, nodeId, mode)
                .catch((e: unknown) => console.error(`Approving the mode of ${nodeId} failed:`, errorText(e)));
        }
    });
    const drawings = new DrawingStore(store);
    store.attachDrawings(drawings);
    const diagrams = new DiagramStore(store);
    store.attachDiagrams(diagrams);
    return { store, startClaims, drawings, diagrams, endSession };
}
