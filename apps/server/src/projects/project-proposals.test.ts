import { beforeEach, describe, expect, test } from 'bun:test';
import type { ChatEvent, ProjectProposal } from '@ruimte/contracts';
import { ManualTimers } from '../computer/computer-test-helpers.ts';
import type { SessionEvent } from '../sessions/manager.ts';
import { ProjectProposals, PROPOSAL_CARD_MS, PROPOSAL_WAIT_MS, type ProposalAsk } from './project-proposals.ts';

const ask: ProposalAsk = { chatId: 'chat-1', name: 'Vinyl shelf', folder: '/work/vinyl-shelf', reason: 'The notes became a codebase' };

let timers: ManualTimers;
let holds: Map<string, Set<string>>;
let published: ProjectProposal[][];
let proposals: ProjectProposals;

function heldKeys(chatId: string): string[] {
    return [...(holds.get(chatId) ?? [])];
}

function chatEvent(chatId: string, event: ChatEvent): SessionEvent {
    return { event: 'chat.event', payload: { chatId, event } } as SessionEvent;
}

beforeEach(() => {
    timers = new ManualTimers();
    holds = new Map();
    published = [];
    proposals = new ProjectProposals({
        chats: {
            hold: (chatId, key) => holds.set(chatId, new Set([...(holds.get(chatId) ?? []), key])),
            release: (chatId, key) => holds.get(chatId)?.delete(key)
        },
        now: () => timers.now,
        timers
    });
    proposals.subscribe('client', (event) => {
        if (event.event === 'chat.proposals') {
            published.push(event.payload.proposals);
        }
    });
});

describe('a project suggestion', () => {
    test('raises one card, holds the chat for a person and tells every client', () => {
        void proposals.ask(ask, 30_000);
        const [card] = proposals.list();
        expect(card).toMatchObject({ chatId: 'chat-1', name: 'Vinyl shelf', folder: '/work/vinyl-shelf', reason: 'The notes became a codebase' });
        expect(heldKeys('chat-1')).toHaveLength(1);
        expect(proposals.stands('chat-1')).toBe(true);
        expect(published.at(-1)).toEqual([card!]);
    });

    test('a person who reviews it and moves the chat settles it as moved', async () => {
        const waiting = proposals.ask(ask, 30_000);
        const [card] = proposals.list();
        proposals.moved('chat-1', 'project-9');
        expect(await waiting).toEqual({ proposalId: card!.proposalId, outcome: 'moved', projectId: 'project-9' });
        expect(proposals.list()).toEqual([]);
        expect(heldKeys('chat-1')).toEqual([]);
        expect(proposals.stands('chat-1')).toBe(false);
    });

    test('a decline answers declined, and a second client that answers late hears it lost', async () => {
        const waiting = proposals.ask(ask, 30_000);
        const { proposalId } = proposals.list()[0]!;
        expect(proposals.decline(proposalId)).toBe(true);
        expect(await waiting).toEqual({ proposalId, outcome: 'declined', projectId: null });
        expect(proposals.decline(proposalId)).toBe(false);
        expect(heldKeys('chat-1')).toEqual([]);
    });

    test('the hold runs out with waiting, asking again joins the card, and a later answer is told once', async () => {
        const first = proposals.ask(ask);
        timers.advance(PROPOSAL_WAIT_MS);
        const { proposalId, outcome } = await first;
        expect(outcome).toBe('waiting');
        expect(proposals.list()).toHaveLength(1);

        const second = proposals.ask({ ...ask, name: 'Vinyl' });
        expect(proposals.list()).toHaveLength(1);
        expect(proposals.list()[0]).toMatchObject({ proposalId, name: 'Vinyl' });
        timers.advance(PROPOSAL_WAIT_MS);
        expect(await second).toEqual({ proposalId, outcome: 'waiting', projectId: null });

        expect(proposals.decline(proposalId)).toBe(true);
        expect(await proposals.ask(ask)).toEqual({ proposalId, outcome: 'declined', projectId: null });
        // Told once: the next suggestion raises a new card.
        void proposals.ask(ask, 1_000);
        expect(proposals.list()[0]?.proposalId).not.toBe(proposalId);
    });

    test('a folder left out the second time is gone from the card', () => {
        void proposals.ask(ask, 30_000);
        void proposals.ask({ chatId: 'chat-1', name: 'Vinyl shelf', reason: 'Still a codebase' }, 30_000);
        expect(proposals.list()[0]).not.toHaveProperty('folder');
    });

    test('a card outlasts the turn that raised it and goes after a day without a new ask', async () => {
        const waiting = proposals.ask(ask, 110_000);
        proposals.observe(
            chatEvent('chat-1', {
                type: 'item',
                item: { id: 't', kind: 'turn', createdAt: 0, turnId: 't', state: 'done', endedAt: 1, costUsd: 0 }
            } as ChatEvent)
        );
        expect(proposals.list()).toHaveLength(1);
        timers.advance(110_000);
        expect((await waiting).outcome).toBe('waiting');
        timers.advance(PROPOSAL_CARD_MS);
        expect(proposals.list()).toEqual([]);
        expect(heldKeys('chat-1')).toEqual([]);
    });

    test('a chat that stops or goes cancels the card', async () => {
        const waiting = proposals.ask(ask, 30_000);
        proposals.observe(chatEvent('chat-1', { type: 'info', info: { status: 'exited' } } as ChatEvent));
        expect((await waiting).outcome).toBe('cancelled');
        expect(proposals.list()).toEqual([]);

        const again = proposals.ask(ask, 30_000);
        proposals.forget('chat-1');
        expect((await again).outcome).toBe('cancelled');
        expect(heldKeys('chat-1')).toEqual([]);
    });
});
