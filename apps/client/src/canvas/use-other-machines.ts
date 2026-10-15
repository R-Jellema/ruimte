import { usePulsarAccount } from '@/pulsar/account';
import { usePulsarMachines } from '@/pulsar/machines';
import { machineIdOf, mergeMachines, type MachineEntry } from '@/shell/settings/machine-list';
import { useEndpoints } from '@/state/endpoints';
import { hasLocalMachine } from '@/state/local-machine';
import { useWorkspace } from '@/transport/connections';

/* The machines other than the one the project lives on, which a node can be put on. */
export function useOtherMachines(): MachineEntry[] {
    const workspace = useWorkspace();
    const endpoints = useEndpoints((s) => s.endpoints);
    const accountStatus = usePulsarAccount((s) => s.status);
    const accountMachines = usePulsarMachines((s) => s.machines);
    const own = workspace === null ? null : endpoints.find((endpoint) => endpoint.id === workspace.connection.endpointId);
    return mergeMachines({ endpoints, accountMachines: accountStatus === 'signed-in' ? accountMachines : null, showLocal: hasLocalMachine() }).filter(
        (entry) => entry.endpoint?.id !== own?.id && entry.id !== (own === undefined || own === null ? null : machineIdOf(own))
    );
}
