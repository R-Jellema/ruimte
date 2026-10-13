import type { ProjectDocument, ProjectLocal, ProjectSummary } from '@ruimte/contracts';
import { LOCAL_ENDPOINT_ID, useEndpoints, type Endpoint } from '@/state/endpoints';
import { dropMachine, enterWorkspace, showStart } from '@/transport/connections';
import { connectFakeMachine, type FakeMachine } from './fake-machine';

const FAKE_PROJECT: ProjectSummary = {
    projectId: 'project-atlas',
    name: 'Atlas',
    color: '#000',
    folder: '/work/atlas',
    lastOpenedAt: 0,
    closedAt: null,
    available: true,
    icon: { kind: 'initial', value: 'A' },
    nameSource: 'chosen'
};

// The web client has no machine of its own to open a project on, so the project is on a machine of the list.
const ENDPOINT: Endpoint = {
    id: 'fake-machine',
    label: 'Fake machine',
    httpBaseUrl: 'http://127.0.0.1:1',
    wsBaseUrl: 'ws://127.0.0.1:1',
    reachability: 'lan',
    daemonId: null,
    daemonPublicKey: null
};

export interface FakeWorkspace {
    close(): void;
}

/* A project open in the window, on a fake machine that answered `project.open` with these views. */
export async function openFakeWorkspace(
    machine: FakeMachine,
    document: Omit<ProjectDocument, 'version' | 'rev' | 'name' | 'color'>,
    local: ProjectLocal
): Promise<FakeWorkspace> {
    machine.answer('project.open', () => ({
        summary: FAKE_PROJECT,
        document: { version: 3, rev: 1, name: FAKE_PROJECT.name, color: FAKE_PROJECT.color, ...document } as ProjectDocument,
        local
    }));
    machine.answer('project.list', () => ({ projects: [FAKE_PROJECT] }));
    useEndpoints.getState().add(ENDPOINT);
    const disconnect = connectFakeMachine(machine, ENDPOINT.id);
    await enterWorkspace(ENDPOINT.id, { projectId: FAKE_PROJECT.projectId });
    return {
        close(): void {
            showStart();
            dropMachine(ENDPOINT.id);
            disconnect();
            useEndpoints.getState().setActive(LOCAL_ENDPOINT_ID);
            useEndpoints.getState().remove(ENDPOINT.id);
        }
    };
}
