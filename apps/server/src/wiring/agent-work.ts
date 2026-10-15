import { join } from 'node:path';
import type { OutboxWorker } from '@adecore/agents/coordination';
import { errorText } from '../error-text.ts';
import { runGh } from '../git/github.ts';
import { PrWatchStore } from '../github/pr-watch.ts';
import { AfterSettleStore } from '../launches/after-settle.ts';
import type { EndChildrenWiring } from '../outbox/end-children.ts';
import type { OutboxWork } from '../outbox/outbox.ts';
import type { SummaryWiring } from '../chat/summary.ts';
import { wireOutbox } from '../outbox/wiring.ts';
import type { PushService } from '../push/service.ts';
import { SnoozeStore } from '../push/snoozes.ts';
import type { TaskWiring } from '../tasks/wiring.ts';
import type { EndpointIdentity } from '../endpoint-id.ts';
import type { ProjectStore } from '../projects/project-store.ts';
import { ConnectPeer, owedTargetsIn } from '../remote/connect-peer.ts';
import type { AgentStores, AgentsBundle } from './agents.ts';
import type { RemoteBundle } from './remote.ts';
import type { LaunchesBundle } from './launches.ts';
import type { ClientsBundle } from './clients.ts';
import type { GitBundle } from './git.ts';
import type { ProvidersBundle } from './providers.ts';
import { PeerTasks } from '../peering/peer-tasks.ts';
import { BundleStore } from '../git/bundles.ts';

/* What the outbox drives on behalf of agents: starts, tasks, wakes and what a node takes along when it goes. */
export interface AgentWorkBundle {
    worker: OutboxWorker<OutboxWork>;
    tasks: TaskWiring;
    endChildren: EndChildrenWiring;
    summaries: SummaryWiring;
    prWatches: PrWatchStore;
    snoozes: SnoozeStore;
    afterSettleStore: AfterSettleStore;
    /* The reconnect of the links to other machines, owed through the outbox. */
    reconnect: ConnectPeer;
    /* The tasks other machines give agents here. */
    peerTasks: PeerTasks;
}

export interface AgentWorkInput {
    home: string;
    identity: EndpointIdentity;
    stores: AgentStores;
    agents: AgentsBundle;
    projects: ProjectStore;
    remote: RemoteBundle;
    providers: ProvidersBundle;
    later: {
        push(): PushService;
        launches(): LaunchesBundle;
        git(): GitBundle;
        clients(): ClientsBundle;
    };
}

export function wireAgentWork({ home, identity, stores, agents, projects, remote, providers, later }: AgentWorkInput): AgentWorkBundle {
    const { outbox } = stores;
    const { outboxLink } = agents;
    const prWatches = new PrWatchStore({
        path: join(home, 'pr-watches.json'),
        gh: runGh,
        enqueue: (projectId, chatId, work) => outboxLink.enqueue(projectId, chatId, work),
        entries: () => outbox.list(),
        removeEntry: (id) => outbox.remove(id),
        onError: (what, error) => console.error(`${what}:`, errorText(error))
    });
    // The worker exists only after `wireOutbox`, and the reconnect is one of the handlers it is built with.
    let worker: OutboxWorker<OutboxWork> | null = null;
    const reconnect = new ConnectPeer({
        outbox,
        owedTargets: owedTargetsIn(outbox),
        enqueue: (projectId, target, work, notBefore) => outboxLink.enqueue(projectId, target, work, notBefore),
        wake: (target) => worker?.wake(target),
        connections: remote.connections,
        now: () => Date.now(),
        random: () => Math.random()
    });
    remote.onLeave(() => reconnect.lapseAll((id) => outbox.remove(id)));
    remote.connections.onLost((machineId) => {
        void reconnect.owe(machineId).catch((e: unknown) => console.error('Owing a reconnect failed:', errorText(e)));
    });
    // The tasks other machines give need the git and the end-children that are wired once the outbox is, so they are built lazily.
    let peerTasks: PeerTasks | null = null;
    const peerStores = new Map<string, BundleStore>();
    const peerTasksNow = (): PeerTasks => {
        if (peerTasks === null) {
            throw new Error('A task from another machine is asked for before the daemon is up');
        }
        return peerTasks;
    };
    const wiring = wireOutbox({
        link: outboxLink,
        outbox,
        projects,
        lineage: stores.lineage,
        prompts: stores.prompts,
        notices: stores.notices,
        prWatches,
        tasks: stores.tasks,
        chats: agents.chats,
        sessions: agents.sessions,
        alert: (target, nodeId, title, body) => later.push().alert(target, nodeId, title, body),
        checkCwd: agents.startCwd,
        resumeAtReset: () => identity.resumeAtReset,
        runAfterSettle: (entry) => later.launches().afterSettle.handle(entry),
        connectPeer: reconnect.handler,
        peerTasks: {
            deliver: (entry) => peerTasksNow().deliver(entry),
            isPeerTask: (task) => peerTasks?.isPeerTask(task) === true,
            parents: (projectId) => projects.peers.canvasIdsOf(projectId)
        }
    });
    worker = wiring.worker;
    peerTasks = new PeerTasks({
        links: projects.peers,
        projects,
        lineage: stores.lineage,
        tasks: stores.tasks,
        outbox,
        enqueue: (projectId, target, work) => outboxLink.enqueue(projectId, target, work),
        prompts: stores.prompts,
        stopNode: (nodeId, reason) => wiring.endChildren.stopNode(nodeId, reason),
        installed: async () => (await providers.providers.list()).filter((provider) => provider.installed).map((provider) => provider.kind),
        peerBundles: (machineId) => {
            let held = peerStores.get(machineId);
            if (held === undefined) {
                held = new BundleStore(home, machineId);
                peerStores.set(machineId, held);
            }
            return held;
        },
        git: () => later.git(),
        worktreePaths: (folder) => later.git().checkouts.paths(folder),
        notify: (machineId, nodeId) => later.clients().notifyPeer(machineId, nodeId),
        log: (line) => console.error(line)
    });
    stores.tasks.onChange((task) => peerTasksNow().changed(task));
    const snoozes = new SnoozeStore({ path: join(home, 'snoozes.json') });
    const afterSettleStore = new AfterSettleStore({ path: join(home, 'launch-after-settle.json') });
    projects.index.onPlaces = (projectId, ids) => {
        wiring.places(projectId, ids);
        snoozes.places(projectId, ids);
        afterSettleStore.places(projectId, ids);
    };
    return {
        worker: wiring.worker,
        tasks: wiring.tasks,
        endChildren: wiring.endChildren,
        summaries: wiring.summaries,
        prWatches,
        snoozes,
        afterSettleStore,
        reconnect,
        peerTasks: peerTasksNow()
    };
}
