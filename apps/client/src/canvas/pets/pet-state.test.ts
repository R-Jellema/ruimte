import { describe, expect, test } from 'bun:test';
import type { AgentInfo, AgentStatus } from '@ruimte/contracts';
import type { ChatState } from '@adecore/agents-react/state';
import { CLAUDE_BUDDY, CODEX_BUDDY } from '@/canvas/pets/buddies';
import { FOX_SPRITE, FROG_SPRITE } from '@/canvas/pets/animals';
import { BUBBLE_ROWS, JUMP_ROWS, PET_POSES } from '@/canvas/pets/pixel';
import { builtInSprite, coversOtherNode, PET_HEIGHT, PET_HIT_HEIGHT, petChoiceOf, petFrame, petHitBox, petPlace, petsOf } from '@/canvas/pets/pet-state';
import type { CanvasNode } from '@/state/canvas';
import type { SessionState } from '@/state/sessions';
import { chatInfoOf } from '../../../testing/chat-info';

function agent(status: AgentStatus, kind = 'claude'): AgentInfo {
    return { kind, agentSessionId: 'a1', transcriptPath: null, status, live: true, updatedAt: 0 };
}

function session(info?: AgentInfo): SessionState {
    return { attached: true, agent: info };
}

function chat(id: string, status: AgentStatus, provider = 'claude'): ChatState {
    return { info: chatInfoOf(id, { status, provider }), items: {}, structure: {}, order: [] };
}

function node(id: string, kind: CanvasNode['kind']): CanvasNode {
    return { id, kind, x: 0, y: 0, w: 400, h: 300 } as CanvasNode;
}

const NODES: Record<string, CanvasNode> = {
    writer: node('writer', 'chat'),
    shell: node('shell', 'terminal'),
    agent: node('agent', 'terminal'),
    plan: node('plan', 'note')
};

describe('which nodes have a pet', () => {
    test('a chat and a terminal with an agent in it, and not a bare shell or a note', () => {
        const pets = petsOf(
            NODES,
            new Set(),
            { 'local:shell': session(), 'local:agent': session(agent('idle', 'codex')) },
            { 'local:writer': chat('writer', 'idle') },
            'local',
            {}
        );
        expect(pets.map((pet) => [pet.id, pet.agent])).toEqual([
            ['writer', 'claude'],
            ['agent', 'codex']
        ]);
    });

    test('none for a node a collapsed group hides', () => {
        expect(petsOf(NODES, new Set(['writer']), {}, { 'local:writer': chat('writer', 'idle') }, 'local', {})).toEqual([]);
    });
});

describe('what a pet shows', () => {
    test('a question or an approval waiting on you, on a chat and on a terminal alike', () => {
        const pets = petsOf(NODES, new Set(), { 'local:agent': session(agent('needs-you')) }, { 'local:writer': chat('writer', 'needs-you') }, 'local', {});
        expect(pets.map((pet) => pet.mood)).toEqual(['waiting', 'waiting']);
    });

    test('a snoozed wait keeps its bubble until it is answered, and does not jump', () => {
        const snoozes = { 'local:writer': 2_000 };
        const pets = petsOf(NODES, new Set(), {}, { 'local:writer': chat('writer', 'needs-you') }, 'local', snoozes);
        expect(pets[0].mood).toBe('snoozed');
        const frames = Array.from({ length: 8 }, (_, tick) => petFrame('snoozed', tick, false));
        expect(frames.every((frame) => frame.bubble && frame.pose === 'wait' && frame.lift === 0)).toBe(true);
        // Answered, the snooze has nothing left to hold, and the pet rests.
        expect(petsOf(NODES, new Set(), {}, { 'local:writer': chat('writer', 'idle') }, 'local', snoozes)[0].mood).toBe('idle');
    });

    test('a turn, a rest and an end that went wrong', () => {
        const mood = (status: AgentStatus) => petsOf(NODES, new Set(), {}, { 'local:writer': chat('writer', status) }, 'local', {})[0].mood;
        expect(mood('running')).toBe('working');
        expect(mood('idle')).toBe('idle');
        expect(mood('error')).toBe('stopped');
    });

    test('a waiting pet has a bubble and jumps, and lands again before the next jump', () => {
        const frames = Array.from({ length: 8 }, (_, tick) => petFrame('waiting', tick, false));
        expect(frames.every((frame) => frame.bubble && frame.pose === 'wait')).toBe(true);
        expect(Math.max(...frames.map((frame) => frame.lift))).toBe(JUMP_ROWS);
        expect(frames[0].lift).toBe(0);
        expect(frames.at(-1)?.lift).toBe(0);
    });

    test('with reduced motion nothing moves: a waiting pet keeps its bubble, and every pet holds one frame', () => {
        const frames = Array.from({ length: 8 }, (_, tick) => petFrame('waiting', tick, true));
        expect(frames.every((frame) => frame.bubble && frame.lift === 0)).toBe(true);
        for (const mood of ['waiting', 'snoozed', 'working', 'idle', 'stopped', 'visiting'] as const) {
            const still = Array.from({ length: 24 }, (_, tick) => petFrame(mood, tick, true));
            expect(new Set(still.map((frame) => JSON.stringify(frame))).size).toBe(1);
        }
    });

    test('no bubble and no jump once the question is answered', () => {
        for (const mood of ['working', 'idle', 'stopped', 'visiting'] as const) {
            const frames = Array.from({ length: 8 }, (_, tick) => petFrame(mood, tick, false));
            expect(frames.some((frame) => frame.bubble || frame.lift !== 0)).toBe(false);
        }
    });
});

describe('the figures', () => {
    test('Codex has its own, and every other CLI gets the one Claude has', () => {
        expect(builtInSprite('buddies', 'codex')).toBe(CODEX_BUDDY);
        expect(builtInSprite('buddies', 'claude')).toBe(CLAUDE_BUDDY);
        expect(builtInSprite('buddies', 'gemini')).toBe(CLAUDE_BUDDY);
        expect(builtInSprite('animals', 'codex')).toBe(FROG_SPRITE);
        expect(builtInSprite('animals', undefined)).toBe(FOX_SPRITE);
    });

    test('every pose of every figure draws inside its grid', () => {
        for (const sprite of [CLAUDE_BUDDY, CODEX_BUDDY, FOX_SPRITE, FROG_SPRITE]) {
            for (const pose of PET_POSES) {
                for (let frame = 0; frame < 12; frame++) {
                    const parts = sprite.poses[pose](frame);
                    for (const part of [...parts.silhouette, ...parts.details, ...parts.props]) {
                        expect(part.x).toBeGreaterThanOrEqual(0);
                        expect(part.y).toBeGreaterThanOrEqual(-1);
                        expect(part.x + part.w).toBeLessThanOrEqual(26);
                        expect(part.y + part.h).toBeLessThanOrEqual(18);
                    }
                }
            }
        }
    });

    test('a custom choice whose sprite is gone falls back to the buddies', () => {
        expect(petChoiceOf('custom:a1', ['a1'])).toEqual({ kind: 'custom', id: 'a1' });
        expect(petChoiceOf('custom:gone', ['a1'])).toEqual({ kind: 'built-in', set: 'buddies' });
        expect(petChoiceOf('animals', [])).toEqual({ kind: 'built-in', set: 'animals' });
        expect(petChoiceOf('dragons', [])).toEqual({ kind: 'built-in', set: 'buddies' });
    });
});

describe('where a press on a pet lands', () => {
    function chatAt(id: string, y: number): CanvasNode {
        return { id, kind: 'chat', x: 0, y, w: 480, h: 300 } as CanvasNode;
    }

    test('on the figure, from its feet on the node up to the top of its jump, and never on the bubble', () => {
        const node = { x: 100, y: 200, w: 400 };
        const box = petHitBox(node);
        expect(box.h).toBe(PET_HIT_HEIGHT);
        expect(box.y + box.h).toBe(202);
        // At the top of a jump the figure's third row, the first a body fills, is where the box begins.
        const jumpTop = petPlace(node).y + (BUBBLE_ROWS + JUMP_ROWS - JUMP_ROWS + 2) * 2;
        expect(box.y).toBe(jumpTop);
        // The bubble sits in the rows above it.
        expect(box.y).toBeGreaterThanOrEqual(petPlace(node).y + (BUBBLE_ROWS - 1) * 2);
    });

    test('a node 40 pixels under another, the gap new nodes get, keeps its pet off the one above', () => {
        const nodes = { upper: chatAt('upper', 0), lower: chatAt('lower', 340) };
        const box = petHitBox(nodes.lower);
        expect(box.y).toBeGreaterThanOrEqual(nodes.upper.y + nodes.upper.h);
        expect(coversOtherNode(box, 'lower', nodes, new Set())).toBe(false);
        expect(
            petsOf(nodes, new Set(), {}, { 'local:upper': chat('upper', 'idle'), 'local:lower': chat('lower', 'idle') }, 'local', {}).map((pet) => pet.blocked)
        ).toEqual([false, false]);
    });

    test('a pet whose figure stands on the node above leaves the press to that node', () => {
        const nodes = { upper: chatAt('upper', 0), lower: chatAt('lower', 310) };
        const pets = petsOf(nodes, new Set(), {}, { 'local:upper': chat('upper', 'idle'), 'local:lower': chat('lower', 'needs-you') }, 'local', {});
        expect(pets.find((pet) => pet.id === 'lower')?.blocked).toBe(true);
        expect(pets.find((pet) => pet.id === 'upper')?.blocked).toBe(false);
    });

    test('the frame of a group the node does not stand in blocks it', () => {
        const lower = chatAt('lower', 310);
        const above = { id: 'above', kind: 'group', x: 0, y: 0, w: 600, h: 300 } as CanvasNode;
        expect(coversOtherNode(petHitBox(lower), 'lower', { lower, above }, new Set())).toBe(true);
        expect(coversOtherNode(petHitBox(lower), 'lower', { lower, above: { ...above, memberIds: ['lower'] } }, new Set())).toBe(false);
    });

    test('a group the node stands in, or a node a collapsed group hides, does not block it', () => {
        const lower = chatAt('lower', 310);
        const group = { id: 'team', kind: 'group', x: -40, y: -40, w: 600, h: 700 } as CanvasNode;
        expect(coversOtherNode(petHitBox(lower), 'lower', { lower, team: group }, new Set())).toBe(false);
        expect(coversOtherNode(petHitBox(lower), 'lower', { lower, upper: chatAt('upper', 0) }, new Set(['upper']))).toBe(false);
    });
});

describe('where a pet stands', () => {
    test('on the top edge of its node, near the right corner, and inside a narrow one', () => {
        const place = petPlace({ x: 100, y: 200, w: 400 });
        expect(place.y + PET_HEIGHT).toBe(202);
        expect(place.x).toBe(100 + 400 - 52 - 24);
        expect(petPlace({ x: 100, y: 200, w: 40 }).x).toBe(100);
    });
});
