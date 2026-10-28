import type { AgentKind } from '@ruimte/contracts';
import type { ChatStatuses } from '@adecore/agents-react/state';
import { CLAUDE_BUDDY, CODEX_BUDDY } from '@/canvas/pets/buddies';
import { FOX_SPRITE, FROG_SPRITE } from '@/canvas/pets/animals';
import { JUMP_ROWS, PAINT_COLUMNS, PAINT_ROWS, type DrawnSprite, type PetPose } from '@/canvas/pets/pixel';
import { nodeWorking } from '@/state/agent-work';
import { groupAttention } from '@/state/attention';
import type { CanvasNode } from '@/state/canvas';
import { endpointKey, endpointOfNode } from '@/state/keys';
import { nodeProvider, nodeStatus, type SessionsByKey } from '@/state/sessions';
import type { Snoozes } from '@/state/snooze';

/* What a pet shows of its node's agent, or that it only drops by. */
export type PetMood = 'working' | 'waiting' | 'idle' | 'stopped' | 'visiting';

export interface CanvasPet {
    id: string;
    /* The CLI behind the node, which picks the built-in figure; none for a chat that has not said yet. */
    agent: AgentKind | undefined;
    mood: PetMood;
}

// Nothing here asks whether a pet was seen, so an empty record keeps the attention pass to the waits alone.
const NO_UNSEEN: Readonly<Record<string, true>> = {};

/*
 * A pet for every node with an agent in it: a chat, or a terminal whose CLI reported through its
 * hooks. Waiting is the same "needs you" every count reads, so a snoozed node does not jump.
 */
export function petsOf(
    nodes: Readonly<Record<string, CanvasNode>>,
    hidden: ReadonlySet<string>,
    sessions: SessionsByKey,
    chats: ChatStatuses,
    endpointId: string,
    snoozes: Snoozes
): CanvasPet[] {
    const shown = Object.values(nodes).filter((node) => (node.kind === 'chat' || node.kind === 'terminal') && !hidden.has(node.id));
    const waiting = new Set(groupAttention(shown, sessions, chats, endpointId, NO_UNSEEN, snoozes).needsYou);
    const pets: CanvasPet[] = [];
    for (const node of shown) {
        let agent: AgentKind | undefined;
        if (node.kind === 'terminal') {
            const session = sessions[endpointKey(endpointOfNode(node, endpointId), node.id)];
            if (!session?.agent) {
                continue;
            }
            agent = session.agent.kind;
        } else {
            agent = nodeProvider(node, chats, endpointId);
        }
        pets.push({ id: node.id, agent, mood: moodOf(node, waiting, sessions, chats, endpointId) });
    }
    return pets;
}

function moodOf(node: CanvasNode, waiting: ReadonlySet<string>, sessions: SessionsByKey, chats: ChatStatuses, endpointId: string): PetMood {
    if (waiting.has(node.id)) {
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
 * jumps until the question is answered; with reduced motion asked for it keeps the bubble and stands still.
 */
export function petFrame(mood: PetMood, tick: number, still: boolean): PetFrame {
    if (mood === 'waiting') {
        return { pose: 'wait', frame: tick, lift: still ? 0 : JUMP[tick % JUMP.length], bubble: true };
    }
    if (mood === 'working') {
        return { pose: 'work', frame: tick, lift: 0, bubble: false };
    }
    if (mood === 'stopped') {
        return { pose: 'stopped', frame: Math.floor(tick / 4), lift: 0, bubble: false };
    }
    if (mood === 'visiting') {
        return { pose: 'stand', frame: Math.floor(tick / 2), lift: 0, bubble: false };
    }
    return { pose: 'sleep', frame: Math.floor(tick / 4), lift: 0, bubble: false };
}

/* World pixels a cell takes, so a pet stays pixel art at every zoom. */
export const WORLD_CELL = 2;
export const PET_WIDTH = PAINT_COLUMNS * WORLD_CELL;
export const PET_HEIGHT = PAINT_ROWS * WORLD_CELL;
// The bottom row of a sprite is the outline under its feet, which stands on the node's top edge.
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
