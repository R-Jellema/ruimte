import { TaskStore } from '@adecore/agents/coordination';

/*
 * The tasks of this machine. `dropWake` of the library writes the records it listed when it started,
 * so a task that settled while it ran is opened again by the stale copy, and its parent is never
 * woken. This one reads each record just before it writes it.
 */
export class RuimteTaskStore extends TaskStore {
    override async dropWake(parentId: string): Promise<void> {
        for (const { id } of this.ofParent(parentId)) {
            const task = this.get(id);
            if (task?.wake === 'pending') {
                // The library's own write: it keeps the record on disk, in the change events and in the order of writes.
                await this['write']({ ...task, wake: 'none' });
            }
        }
    }
}
