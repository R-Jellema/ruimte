import type { RoutineRun } from '@ruimte/contracts';
import { snapToGrid, type Rect } from '@/canvas/math';

/* The run cards beside a routine node, the open one included; the rest wait behind the line under them. */
export const BESIDE_RUNS = 4;

const GUTTER = 72;
const COLUMN_W = 440;
const OPEN_H = 480;
const LINE_H = 40;
const OLDER_H = 28;
const STACK_GAP = 8;

export type BesideCard =
    | { kind: 'run'; key: string; run: RoutineRun; open: boolean; rect: Rect }
    | { kind: 'older'; key: string; count: number; rect: Rect }
    | {
          kind: 'output';
          key: string;
          artifactId: string;
          /* The version it shows; null when no run kept one, which shows the artifact's newest. */
          versionId: string | null;
          /* The open run kept no version, so it shows this run's instead, or the artifact's newest when null. */
          fallback: { run: RoutineRun | null } | null;
          /* The run card its line comes from, or null for the routine node itself. */
          from: string | null;
          rect: Rect;
      };

/* The run a routine node opens beside it by itself: the newest one that ran, or the newest at all. */
export function defaultOpenRun(runs: readonly RoutineRun[]): string | null {
    return (runs.find((run) => run.state !== 'skipped') ?? runs[0])?.runId ?? null;
}

/*
 * Where the cards beside a routine node go, in world units: a column to its right with its newest runs,
 * at most one of them open, and the count of the older ones; and a column right of that with its
 * Output at the version of the open run, or the newest version with none open. Sizes are known up
 * front, so the lines and the culling place every card without measuring one. `openRunId` is
 * undefined until a person picked, which opens the default, and null once they closed them all.
 */
export function besideLayout(
    node: Rect,
    runs: readonly RoutineRun[],
    openRunId: string | null | undefined,
    artifactId: string | undefined,
    outputSize: { w: number; h: number } | null = null
): BesideCard[] {
    const x = node.x + node.w + GUTTER;
    const shown = runs.slice(0, BESIDE_RUNS);
    const open = openRunId === null ? null : shown.some((run) => run.runId === openRunId) ? openRunId : defaultOpenRun(shown);
    const cards: BesideCard[] = [];
    let y = node.y;
    for (const run of shown) {
        const isOpen = run.runId === open;
        const h = isOpen ? OPEN_H : LINE_H;
        cards.push({ kind: 'run', key: `run:${run.runId}`, run, open: isOpen, rect: { x, y, w: COLUMN_W, h } });
        y += h + STACK_GAP;
    }
    if (runs.length > shown.length) {
        cards.push({ kind: 'older', key: 'older', count: runs.length - shown.length, rect: { x, y, w: COLUMN_W, h: OLDER_H } });
    }
    if (artifactId === undefined) {
        return cards;
    }
    const openRun = shown.find((run) => run.runId === open);
    const latest = runs.find((run) => run.versionId !== undefined) ?? null;
    const source = openRun?.versionId !== undefined ? openRun : latest;
    // The line comes from the open run, and with none open from the run whose version it shows.
    const from = cards.find((card) => card.kind === 'run' && card.run === (openRun ?? source));
    cards.push({
        kind: 'output',
        key: 'output',
        artifactId,
        versionId: source?.versionId ?? null,
        fallback: openRun !== undefined && openRun.versionId === undefined ? { run: latest } : null,
        from: from?.key ?? null,
        // Top aligned with the node whichever run is open, so the version stays put while a person moves through the runs.
        rect: { x: x + COLUMN_W + GUTTER, y: node.y, w: snapToGrid(outputSize?.w ?? COLUMN_W), h: snapToGrid(outputSize?.h ?? OPEN_H) }
    });
    return cards;
}
