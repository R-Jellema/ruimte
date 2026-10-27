import { useProcessWarnings } from '@/state/processes';
import { snapshotWatch, watchPool } from '@/transport/pool-watch';

/*
 * The process warnings of every machine this client holds a socket for, panel open or not: they are
 * what puts a dot on a node and on its sidebar row. The daemon pushes a change to every socket; a
 * socket that opens asks once, since what changed while it was closed was pushed to nobody.
 * A daemon older than the panel does not know the request; it simply has no warnings.
 */
export function startProcessWarnings(): () => void {
    return watchPool((link, endpointId) =>
        snapshotWatch(link, 'processes.listAlerts', 'processes.alerts', (payload) => useProcessWarnings.getState().setAlerts(endpointId, payload.alerts))
    );
}
