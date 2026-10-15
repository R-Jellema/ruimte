import { useMemo } from 'react';
import type { RemoteStatusEvent, Task } from '@ruimte/contracts';
import { useCanvas } from '@/state/canvas';
import { isWaiting, useRemoteStatus } from '@/state/remote-status';
import { useTasks } from '@/state/tasks';
import { useWorkspace } from '@/transport/connections';

type TasksById = Readonly<Record<string, Task>>;
type StatusByMachine = Readonly<Record<string, RemoteStatusEvent>> | undefined;

/* The open task of a node that works on another machine, which is the task that waits when that machine does not answer. */
export function openTaskOf(tasks: TasksById | undefined, childId: string): Task | null {
    let found: Task | null = null;
    for (const task of Object.values(tasks ?? {})) {
        if (task.childId === childId && task.status === 'open' && (found === null || task.createdAt >= found.createdAt)) {
            found = task;
        }
    }
    return found;
}

/* The machines a node waits for: those its open tasks were given to, while the link to them waits. */
export function waitingMachinesOf(
    tasks: TasksById | undefined,
    parentId: string,
    machineOf: (childId: string) => string | undefined,
    status: StatusByMachine
): string[] {
    const machines = new Set<string>();
    for (const task of Object.values(tasks ?? {})) {
        const machine = task.parentId === parentId && task.status === 'open' ? machineOf(task.childId) : undefined;
        if (machine !== undefined && isWaiting(status?.[machine])) {
            machines.add(machine);
        }
    }
    return [...machines];
}

/* The machines a node waits for. */
export function useWaitingMachines(parentId: string): string[] {
    const workspaceId = useWorkspace()?.connection.endpointId ?? '';
    const tasks = useTasks((state) => state.byEndpoint[workspaceId]);
    const status = useRemoteStatus((state) => state.byEndpoint[workspaceId]);
    const childIds = useMemo(
        () =>
            Object.values(tasks ?? {})
                .filter((task) => task.parentId === parentId && task.status === 'open')
                .map((task) => task.childId),
        [tasks, parentId]
    );
    // One string, so a node moving on the canvas does not redraw every parent.
    const machines = useCanvas((state) => childIds.map((childId) => state.nodes[childId]?.machine ?? '').join('\n'));
    return useMemo(() => {
        const byChild = new Map(childIds.map((childId, i) => [childId, machines.split('\n')[i] || undefined]));
        return waitingMachinesOf(tasks, parentId, (childId) => byChild.get(childId), status);
    }, [tasks, parentId, status, childIds, machines]);
}

/* The task a node is stopped by while it waits for its machine, or null when nothing waits. */
export function useWaitingTask(childId: string, machine: string | undefined): Task | null {
    const workspaceId = useWorkspace()?.connection.endpointId ?? '';
    const tasks = useTasks((state) => state.byEndpoint[workspaceId]);
    const waiting = useRemoteStatus((state) => machine !== undefined && isWaiting(state.byEndpoint[workspaceId]?.[machine]));
    return useMemo(() => (waiting ? openTaskOf(tasks, childId) : null), [waiting, tasks, childId]);
}
