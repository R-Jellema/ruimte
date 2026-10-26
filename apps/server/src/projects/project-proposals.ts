import { randomUUID } from 'node:crypto';
import type { ProjectProposal } from '@ruimte/contracts';
import { ClientSinks } from '../client-sinks.ts';
import { realTimers, type Timers } from '../computer/approvals.ts';
import type { SessionEvent, SessionSink } from '../sessions/manager.ts';

/* A card is a suggestion to think over, so it outlasts the turn that raised it; a day without a new ask takes it down. */
export const PROPOSAL_CARD_MS = 24 * 60 * 60_000;

type ProposalOutcome = 'declined' | 'waiting';

export interface ProposalAsk {
    chatId: string;
    name: string;
    folder?: string;
    reason: string;
}

export interface ProposalAnswer {
    proposalId: string;
    outcome: ProposalOutcome;
}

/* Holds the suggesting chat at `needs-you` while its card stands, the way a question of its CLI does. */
interface ProposalChats {
    hold(chatId: string, key: string): void;
    release(chatId: string, key: string): void;
}

interface ProjectProposalsOptions {
    chats: ProposalChats;
    now?: () => number;
    timers?: Timers;
    cardMs?: number;
}

interface Pending {
    proposal: ProjectProposal;
    cancelExpiry: () => void;
}

function holdKeyOf(proposalId: string): string {
    return `project-proposal:${proposalId}`;
}

/*
 * The cards in which an agent in Chats suggests that its chat becomes a project. One card per chat,
 * so an agent that suggests again joins the card that stands. It goes to every client; whoever
 * answers first settles it. Nothing is made here: the person reviews it in the dialog that moves a
 * chat, and a move of that chat takes the card down. A suggestion never waits for the person, since a
 * call that holds the turn open blocks the very move the card offers; a decline reaches the agent on its
 * next suggestion, once. A chat that moved suggests nothing more, so a move tells it nothing.
 */
export class ProjectProposals {
    private readonly chats: ProposalChats;
    private readonly now: () => number;
    private readonly timers: Timers;
    private readonly cardMs: number;
    private readonly sinks = new ClientSinks();
    private readonly pending = new Map<string, Pending>();
    private readonly unheard = new Map<string, ProposalAnswer>();

    constructor(options: ProjectProposalsOptions) {
        this.chats = options.chats;
        this.now = options.now ?? Date.now;
        this.timers = options.timers ?? realTimers;
        this.cardMs = options.cardMs ?? PROPOSAL_CARD_MS;
    }

    subscribe(clientId: string, sink: SessionSink): () => void {
        return this.sinks.subscribe(clientId, sink);
    }

    /* Raises the card, or joins the one that stands, and answers `waiting` at once; an answer nobody heard yet comes instead, once. */
    ask(ask: ProposalAsk): ProposalAnswer {
        const told = this.unheard.get(ask.chatId);
        if (told !== undefined && !this.pending.has(ask.chatId)) {
            this.unheard.delete(ask.chatId);
            return told;
        }
        return { proposalId: this.raise(ask).proposal.proposalId, outcome: 'waiting' };
    }

    list(): ProjectProposal[] {
        return [...this.pending.values()].map((pending) => pending.proposal).sort((a, b) => a.createdAt - b.createdAt);
    }

    /* Whether this chat has a card up, which is what holds it at `needs-you`. */
    stands(chatId: string): boolean {
        return this.pending.has(chatId);
    }

    /*
     * Lets go of the hold of the card that stands, since a held chat does not relocate. The returned function
     * puts it back for a move that did not happen, as long as the same card stands; null when no card stands.
     */
    pauseHold(chatId: string): (() => void) | null {
        const pending = this.pending.get(chatId);
        if (pending === undefined) {
            return null;
        }
        const key = holdKeyOf(pending.proposal.proposalId);
        this.chats.release(chatId, key);
        return () => {
            if (this.pending.get(chatId) === pending) {
                this.chats.hold(chatId, key);
            }
        };
    }

    /* A person's no. False when the card is gone already, which tells a second client it lost the race. */
    decline(proposalId: string): boolean {
        const found = this.find(proposalId);
        if (found === undefined) {
            return false;
        }
        this.settle(found, { proposalId, outcome: 'declined' });
        return true;
    }

    /* The chat left Chats for a project, however the person got there: it can suggest nothing more, so nothing is left to tell it. */
    moved(chatId: string): void {
        const pending = this.pending.get(chatId);
        if (pending !== undefined) {
            this.settle(pending, null);
        }
        this.unheard.delete(chatId);
    }

    /* The chat stopped running or is gone: nobody is left to hear an answer. */
    forget(chatId: string): void {
        const pending = this.pending.get(chatId);
        if (pending !== undefined) {
            this.settle(pending, null);
        }
        this.unheard.delete(chatId);
    }

    observe(event: SessionEvent): void {
        if (event.event !== 'chat.event') {
            return;
        }
        const { chatId, event: chat } = event.payload;
        if ((chat.type === 'info' || chat.type === 'reset') && chat.info.status === 'exited') {
            this.forget(chatId);
        }
    }

    private find(proposalId: string): Pending | undefined {
        return [...this.pending.values()].find((pending) => pending.proposal.proposalId === proposalId);
    }

    private raise(ask: ProposalAsk): Pending {
        const standing = this.pending.get(ask.chatId);
        const expiresAt = this.now() + this.cardMs;
        if (standing !== undefined) {
            standing.cancelExpiry();
            standing.proposal = {
                ...standing.proposal,
                name: ask.name,
                reason: ask.reason,
                ...(ask.folder === undefined ? { folder: undefined } : { folder: ask.folder }),
                expiresAt
            };
            if (ask.folder === undefined) {
                delete standing.proposal.folder;
            }
            standing.cancelExpiry = this.expireLater(standing);
            this.publish();
            return standing;
        }
        this.unheard.delete(ask.chatId);
        const now = this.now();
        const pending: Pending = {
            proposal: {
                proposalId: randomUUID(),
                chatId: ask.chatId,
                name: ask.name,
                ...(ask.folder === undefined ? {} : { folder: ask.folder }),
                reason: ask.reason,
                createdAt: now,
                expiresAt: now + this.cardMs
            },
            cancelExpiry: () => undefined
        };
        pending.cancelExpiry = this.expireLater(pending);
        this.pending.set(ask.chatId, pending);
        this.chats.hold(ask.chatId, holdKeyOf(pending.proposal.proposalId));
        this.publish();
        return pending;
    }

    private expireLater(pending: Pending): () => void {
        return this.timers.set(() => this.settle(pending, null), this.cardMs);
    }

    /* The agent hears the answer with its next suggestion; a card that only lapsed or whose chat is gone or moved has none. */
    private settle(pending: Pending, answer: ProposalAnswer | null): void {
        const { chatId, proposalId } = pending.proposal;
        if (this.pending.get(chatId) !== pending) {
            return;
        }
        pending.cancelExpiry();
        this.pending.delete(chatId);
        this.chats.release(chatId, holdKeyOf(proposalId));
        if (answer !== null) {
            this.unheard.set(chatId, answer);
        }
        this.publish();
    }

    private publish(): void {
        this.sinks.emit({ event: 'chat.proposals', payload: { proposals: this.list() } });
    }
}
