import { groupMemberIds, type GroupItem } from './node-defaults.ts';
import type { ProjectCanvasView } from './project.ts';

/** Finds frames emptied by a deletion, including their empty parent frames. */
export function emptyCanvasGroupIds(canvas: Pick<ProjectCanvasView, 'nodes' | 'texts' | 'lines'>, removed: ReadonlySet<string>): string[] {
    const items: GroupItem[] = [
        ...canvas.nodes,
        ...canvas.texts,
        ...(canvas.lines ?? []).map((line) => ({
            id: line.id,
            x: (line.x + line.endX) / 2,
            y: (line.y + line.endY) / 2
        }))
    ];

    const groups = canvas.nodes.filter((node) => node.kind === 'group').map((group) => ({ id: group.id, members: groupMemberIds(group, items) }));
    const groupIds = new Set(groups.map((group) => group.id));
    const occupied = new Set(items.filter((item) => !groupIds.has(item.id) && !removed.has(item.id)).map((item) => item.id));
    const affected = new Set(removed);
    let changed = true;

    // Nested frames can contain each other's centers, so only a path to content keeps a frame occupied.
    while (changed) {
        changed = false;

        for (const group of groups) {
            if (removed.has(group.id)) {
                continue;
            }

            if (!occupied.has(group.id) && group.members.some((id) => occupied.has(id))) {
                occupied.add(group.id);
                changed = true;
            }

            if (!affected.has(group.id) && group.members.some((id) => affected.has(id))) {
                affected.add(group.id);
                changed = true;
            }
        }
    }

    return groups.filter((group) => !removed.has(group.id) && !occupied.has(group.id) && affected.has(group.id)).map((group) => group.id);
}
