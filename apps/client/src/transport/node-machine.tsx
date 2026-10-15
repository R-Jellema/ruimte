import { useMemo, type ReactElement, type ReactNode } from 'react';
import { machineFor, type Connection } from './connections';
import { ConnectionProvider } from './ConnectionProvider';
import { useOptionalConnection } from './context';

/*
 * What a node under it reads of its machine. A node that runs on another machine gets that machine's
 * transport and its session, chat, browser and device clients, so its rows, its requests and its
 * prompts are the ones of the machine it runs on. The document stays the workspace's: the project,
 * the drawings and the diagrams are still the ones on the machine the project lives on.
 */
export function NodeMachineScope({
    machine,
    fallback = null,
    children
}: {
    machine: string | undefined;
    fallback?: ReactNode;
    children: ReactNode;
}): ReactElement {
    const workspace = useOptionalConnection();
    const own = machine === undefined || workspace === null || machine === workspace.endpointId;
    const remote = own ? null : machineFor(machine);
    const connection = useMemo<Connection | null>(
        () =>
            remote === null || workspace === null
                ? null
                : {
                      endpointId: remote.endpointId,
                      transport: remote.transport,
                      sessions: remote.sessions,
                      chats: remote.chats,
                      browsers: remote.browsers,
                      devices: remote.devices,
                      projects: workspace.projects,
                      drawings: workspace.drawings,
                      diagrams: workspace.diagrams
                  },
        [remote, workspace]
    );
    if (own) {
        return <>{children}</>;
    }
    // A machine this client does not know has nothing to draw the node from; starting it here instead would be the wrong machine's work.
    return connection === null ? <>{fallback}</> : <ConnectionProvider connection={connection}>{children}</ConnectionProvider>;
}
