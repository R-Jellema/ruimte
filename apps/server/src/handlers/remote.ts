import { RequestError, type Dispatcher } from '../dispatcher.ts';
import type { PendingAdmissions } from '../remote/pending-admissions.ts';
import type { RemoteStore } from '../remote/remote-store.ts';
import type { ProjectStore } from '../projects/project-store.ts';

/*
 * Which checkout on another machine a project here is linked to. Any client may ask, since it is
 * a person who works on another machine; nothing here reaches that machine, which is the window's
 * own connection to it.
 */
export interface PeerLinkHost {
    machineId: string;
    peerPublicKey(): Promise<string>;
    pending: PendingAdmissions;
}

export function registerRemoteHandlers(dispatcher: Dispatcher, remote: RemoteStore, projects: Pick<ProjectStore, 'known'>, peers: PeerLinkHost): void {
    const requireProject = async (projectId: string): Promise<void> => {
        if (!(await projects.known()).some((project) => project.projectId === projectId)) {
            throw new RequestError('project-not-found', `No project ${projectId} is on this machine`);
        }
    };

    dispatcher.register('remote.list', async (payload) => {
        await requireProject(payload.projectId);
        return { links: remote.linksOf(payload.projectId) };
    });

    dispatcher.register('remote.link', async ({ projectId, ...link }) => {
        await requireProject(projectId);
        await remote.link(projectId, link);
        return link;
    });

    dispatcher.register('remote.unlink', async (payload) => {
        await requireProject(payload.projectId);
        if (remote.usesMachine(payload.projectId, payload.machineId)) {
            throw new RequestError('machine-in-use', 'A node of this project still runs on that machine; remove it first');
        }
        await remote.unlink(payload.projectId, payload.machineId);
        return {};
    });

    /*
     * Any client may hand over a peer statement: it is a person who links two machines, and the statement
     * only opens the other machine to the peer key of this one, which that machine's own link then limits.
     */
    dispatcher.register('remote.connect', async ({ machineId, statement }) => {
        const mismatch =
            statement.machineId !== machineId ||
            statement.peerMachineId !== peers.machineId ||
            statement.peerPublicKey !== (await peers.peerPublicKey()) ||
            statement.expiresAt < Date.now();
        if (mismatch) {
            throw new RequestError('bad-statement', 'That statement is not for this machine to work in that one, or it has run out');
        }
        peers.pending.hold(statement);
        return {};
    });
}
