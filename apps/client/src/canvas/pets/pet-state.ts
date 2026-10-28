import type { AgentKind } from '@ruimte/contracts';
import type { ChatStatuses } from '@adecore/agents-react/state';
import { CLAUDE_BUDDY, CODEX_BUDDY } from '@/canvas/pets/buddies';
import { FOX_SPRITE, FROG_SPRITE } from '@/canvas/pets/animals';
import type { Rect } from '@/canvas/math';
import {
    BUBBLE_ABOVE,
    BUBBLE_BESIDE,
    BUBBLE_ROWS,
    BUBBLE_SIZE,
    JUMP_ROWS,
    PAINT_COLUMNS,
    PAINT_ROWS,
    SPRITE_COLUMNS,
    SPRITE_ROWS,
    type DrawnSprite,
    type PetPose
} from '@/canvas/pets/pixel';
import { nodeWorking } from '@/state/agent-work';
import { groupAttention } from '@/state/attention';
import type { CanvasNode, CanvasState } from '@/state/canvas';
import { endpointKey, endpointOfNode } from '@/state/keys';
import { nodeProvider, nodeStatus, type SessionsByKey } from '@/state/sessions';
import type { Snoozes } from '@/state/snooze';

/* What a pet shows of its node's agent, or that it only drops by. `snoozed` still waits on you, quietly. */
export type PetMood = 'working' | 'waiting' | 'snoozed' | 'idle' | 'stopped' | 'visiting';

export interface CanvasPet {
    /* The CLI behind the node, which picks the built-in figure; none for a chat that has not said yet. */
    agent: AgentKind | undefined;
    mood: PetMood;
}

// Nothing here asks whether a pet was seen, so an empty record keeps the attention pass to the waits alone.
const NO_UNSEEN: Readonly<Record<string, true>> = {};

/*
 * The nodes that may have a pet, a chat or a terminal no collapsed group hides, as one string: it
 * changes when one comes or goes and not on every frame of a drag, so the pets are not all drawn again.
 */
export function petNodeKey(s: Pick<CanvasState, 'nodes' | 'hidden'>): string {
    return Object.values(s.nodes)
        .filter((node) => (node.kind === 'chat' || node.kind === 'terminal') && !s.hidden.has(node.id))
        .map((node) => node.id)
        .join('\n');
}

/*
 * The pet of a node with an agent in it: a chat, or a terminal whose CLI reported through its hooks.
 * Waiting is the same "needs you" every count reads. A wait a person snoozed keeps its bubble until it
 * is answered, since the question is still open, but does not jump.
 */
export function petOf(node: CanvasNode, sessions: SessionsByKey, chats: ChatStatuses, endpointId: string, snoozes: Snoozes): CanvasPet | null {
    let agent: AgentKind | undefined;
    if (node.kind === 'terminal') {
        const session = sessions[endpointKey(endpointOfNode(node, endpointId), node.id)];
        if (!session?.agent) {
            return null;
        }
        agent = session.agent.kind;
    } else {
        agent = nodeProvider(node, chats, endpointId);
    }
    const attention = groupAttention([node], sessions, chats, endpointId, NO_UNSEEN, snoozes);
    return { agent, mood: attention.snoozed.length > 0 ? 'snoozed' : moodOf(node, attention.needsYou.length > 0, sessions, chats, endpointId) };
}

function moodOf(node: CanvasNode, waiting: boolean, sessions: SessionsByKey, chats: ChatStatuses, endpointId: string): PetMood {
    if (waiting) {
        return 'waiting';
    }
    if (nodeWorking(node, sessions, chats, endpointId)) {
        return 'working';
    }
    const status = nodeStatus(node, sessions, chats, endpointId);
    return status === 'error' || status === 'exited' ? 'stopped' : 'idle';
}

/* How far a waiting pet is off the ground, in cells, frame by frame: up, a moment in the air, down, and a beat on the node. */
const JUMP = [0, 2, 3, JUMP_ROWS, 3, 2, 0, 0] as const;

export interface PetFrame {
    pose: PetPose;
    /* The frame of the pose's own animation. */
    frame: number;
    /* Cells above its node. */
    lift: number;
    bubble: boolean;
}

/*
 * What a pet draws on a tick of the shared clock. A pet that waits on you says so with a bubble and
 * jumps until the question is answered; snoozed it keeps the bubble and stands still. With reduced
 * motion asked for nothing moves: every pet holds its first frame, the bubble included.
 */
export function petFrame(mood: PetMood, tick: number, still: boolean): PetFrame {
    const beat = still ? 0 : tick;
    if (mood === 'waiting' || mood === 'snoozed') {
        return { pose: 'wait', frame: beat, lift: mood === 'snoozed' ? 0 : JUMP[beat % JUMP.length], bubble: true };
    }
    if (mood === 'working') {
        return { pose: 'work', frame: beat, lift: 0, bubble: false };
    }
    if (mood === 'stopped') {
        return { pose: 'stopped', frame: Math.floor(beat / 4), lift: 0, bubble: false };
    }
    if (mood === 'visiting') {
        return { pose: 'stand', frame: Math.floor(beat / 2), lift: 0, bubble: false };
    }
    return { pose: 'sleep', frame: Math.floor(beat / 4), lift: 0, bubble: false };
}

/* World pixels a cell takes, so a pet stays pixel art at every zoom. */
export const WORLD_CELL = 2;
/* The figure's width, and the paint's, which is wider for the bubble beside it. */
export const PET_WIDTH = SPRITE_COLUMNS * WORLD_CELL;
export const PET_PAINT_WIDTH = PAINT_COLUMNS * WORLD_CELL;
export const PET_HEIGHT = PAINT_ROWS * WORLD_CELL;
// The bottom row of a sprite is the outline under its feet, which lies on the node's top edge, inside its frame.
const FEET = WORLD_CELL;
const INSET = 24;

/* Where a node's pet stands: on the top edge of its frame, near the right corner, clear of the title on the left. */
export function petPlace(node: Pick<CanvasNode, 'x' | 'y' | 'w'>): { x: number; y: number } {
    return { x: Math.max(node.x, node.x + node.w - PET_WIDTH - INSET), y: node.y - PET_HEIGHT + FEET };
}

/* Where a visitor stands beside a node: the same edge, near the left corner, where no pet of its own stands. */
export function visitorPlace(node: Pick<CanvasNode, 'x' | 'y'>): { x: number; y: number } {
    return { x: node.x + INSET, y: node.y - PET_HEIGHT + FEET };
}

/*
 * The rows a figure fills over its node, at rest and at the top of a jump: every row of a sprite but its
 * first two, which only a fox's ear tips and a sleeper's letters reach, and its last, the outline under
 * its feet inside the node's frame, where a press is the node's; and the rows it jumps into. The bubble
 * is paint and never takes a press. It stays clear of a node 40 pixels above, the gap new nodes get.
 */
export const PET_HIT_HEIGHT = (SPRITE_ROWS - 3 + JUMP_ROWS) * WORLD_CELL;

/* How far below the top of a pet's paint its press box begins. */
export const PET_HIT_TOP = PET_HEIGHT - FEET - PET_HIT_HEIGHT;

/* What a press on a figure standing here lands on: from its node's top edge up, wherever it is in a jump. */
export function hitBoxAt(place: { x: number; y: number }): Rect {
    return { x: place.x, y: place.y + PET_HIT_TOP, w: PET_WIDTH, h: PET_HIT_HEIGHT };
}

export function petHitBox(node: Pick<CanvasNode, 'x' | 'y' | 'w'>): Rect {
    return hitBoxAt(petPlace(node));
}

/*
 * Where a waiting pet's bubble starts in its paint, in cells, at a lift: over its head, or beside it when
 * a node lies there. Beside, it rises no higher than the press box, so it stays clear of a node 40 pixels
 * above as the figure does, through the jump and at rest alike.
 */
export function bubbleCell(lift: number, beside: boolean): { x: number; y: number } {
    const spriteTop = BUBBLE_ROWS + JUMP_ROWS - lift;
    return beside ? { x: BUBBLE_BESIDE, y: spriteTop + 2 } : { x: BUBBLE_ABOVE, y: spriteTop - BUBBLE_ROWS };
}

/* What a node's pet's bubble covers on the canvas at a lift. */
export function petBubbleBox(node: Pick<CanvasNode, 'x' | 'y' | 'w'>, lift: number, beside: boolean): Rect {
    const place = petPlace(node);
    const at = bubbleCell(lift, beside);
    return { x: place.x + at.x * WORLD_CELL, y: place.y + at.y * WORLD_CELL, w: BUBBLE_SIZE.columns * WORLD_CELL, h: BUBBLE_SIZE.rows * WORLD_CELL };
}

function overlaps(a: Rect, b: Rect): boolean {
    return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function contains(outer: Rect, inner: Rect): boolean {
    return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
}

/*
 * Whether a box over the canvas lies on another node a person can see. A group the node stands in does
 * not count, as a member or inside its frame: it is a frame under its own nodes, and a pet of a node
 * in one always stands on it. Any other group's frame does.
 */
export function coversOtherNode(box: Rect, ownId: string, nodes: Readonly<Record<string, CanvasNode>>, hidden: ReadonlySet<string>): boolean {
    const own = nodes[ownId];
    const holdsOwn = (group: CanvasNode): boolean => group.memberIds?.includes(ownId) === true || (own !== undefined && contains(group, own));
    return Object.values(nodes).some(
        (other) => other.id !== ownId && !hidden.has(other.id) && !(other.kind === 'group' && holdsOwn(other)) && overlaps(box, other)
    );
}

/*
 * Whether a node's pet stands over another node, where a press belongs to that node and not to the pet.
 * A boolean, so a pet that selects it is drawn again only when it flips, not on every frame of a drag.
 */
export function petBlocked(s: Pick<CanvasState, 'nodes' | 'hidden'>, id: string): boolean {
    const node = s.nodes[id];
    return node !== undefined && coversOtherNode(petHitBox(node), id, s.nodes, s.hidden);
}

/* Whether another node lies where the bubble over a pet's head goes, anywhere in its jump, so it goes beside the pet. */
export function petCrowded(s: Pick<CanvasState, 'nodes' | 'hidden'>, id: string): boolean {
    const node = s.nodes[id];
    if (node === undefined) {
        return false;
    }
    const top = petBubbleBox(node, JUMP_ROWS, false);
    const rest = petBubbleBox(node, 0, false);
    return coversOtherNode({ ...top, h: rest.y + rest.h - top.y }, id, s.nodes, s.hidden);
}

export const PET_SETS = ['buddies', 'animals'] as const;

export type PetSet = (typeof PET_SETS)[number];

export const CUSTOM_PET_PREFIX = 'custom:';

/* The figure of a built-in set for an agent: Codex has its own, every other CLI the one Claude has. */
export function builtInSprite(set: PetSet, agent: AgentKind | undefined): DrawnSprite {
    const codex = agent === 'codex';
    if (set === 'animals') {
        return codex ? FROG_SPRITE : FOX_SPRITE;
    }
    return codex ? CODEX_BUDDY : CLAUDE_BUDDY;
}

/* What the setting names: a built-in set, or a sprite a person added that is still there. Anything else is the buddies. */
export function petChoiceOf(setting: string, customIds: readonly string[]): { kind: 'built-in'; set: PetSet } | { kind: 'custom'; id: string } {
    if (setting.startsWith(CUSTOM_PET_PREFIX)) {
        const id = setting.slice(CUSTOM_PET_PREFIX.length);
        return customIds.includes(id) ? { kind: 'custom', id } : { kind: 'built-in', set: 'buddies' };
    }
    return { kind: 'built-in', set: PET_SETS.find((set) => set === setting) ?? 'buddies' };
}
