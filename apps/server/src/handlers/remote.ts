import { RequestError, type Dispatcher } from '../dispatcher.ts';
import type { RemoteStore } from '../remote/remote-store.ts';
import type { ProjectStore } from '../projects/project-store.ts';

/*
 * Which checkout on another machine a project here is linked to. Any client may ask, since it is
 * a person who works on another machine; nothing here reaches that machine, which is the window's
 * own connection to it.
 */
export function registerRemoteHandlers(dispatcher: Dispatcher, remote: RemoteStore, projects: Pick<ProjectStore, 'known'>): void {
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
}
