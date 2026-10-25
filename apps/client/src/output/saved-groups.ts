import type { ArtifactVersion } from '@ruimte/contracts';

/*
 * The versions oldest first, one group for every turn that saved them, and else one for every run the
 * thread places between the same two of its rows. A turn's commands fold away under its summary, so
 * versions of one turn split by a command would otherwise read as two lists with a gap between.
 */
export function groupsBetweenItems<T extends { version: Pick<ArtifactVersion, 'createdAt' | 'provenance'> }>(
    saved: readonly T[],
    itemTimes: readonly number[]
): T[][] {
    const groups: T[][] = [];
    for (const entry of [...saved].sort((first, second) => first.version.createdAt - second.version.createdAt)) {
        const group = groups.at(-1);
        const previous = group?.at(-1);
        const turnId = entry.version.provenance.turnId;
        const sameTurn = previous !== undefined && turnId !== undefined && previous.version.provenance.turnId === turnId;
        const apart = previous === undefined || (!sameTurn && itemTimes.some((time) => time > previous.version.createdAt && time <= entry.version.createdAt));
        if (group === undefined || apart) {
            groups.push([entry]);
        } else {
            group.push(entry);
        }
    }
    return groups;
}
