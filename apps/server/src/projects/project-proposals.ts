import { randomUUID } from 'node:crypto';
import type { ProjectProposal } from '@ruimte/contracts';
import { ClientSinks } from '../client-sinks.ts';
import { realTimers, type Timers } from '../computer/approvals.ts';
import type { SessionEvent, SessionSink } from '../sessions/manager.ts';

/*
 * How long a verb holds its call while the card is up, unless the agent asks for longer with `--wait`.
 * Some agent CLIs end a shell command after 10 s unless the model asked for more; past this the agent
 * hears `waiting` and asks again, which joins the same card.
 */
export const PROPOSAL_WAIT_MS = 6_000;

/* A card is a suggestion to think over, so it outlasts the turn that raised it; a day without a new ask takes it down. */
export const PROPOSAL_CARD_MS = 24 * 60 * 60_000;

export type ProposalOutcome = 'moved' | 'declined' | 'cancelled' | 'waiting';

export interface ProposalAsk {
    chatId: string;
    name: string;
    folder?: string;
    reason: string;
}

export interface ProposalAnswer {
    proposalId: string;
    outcome: ProposalOutcome;
    /* The project the chat lives in now; only on `moved`. */
    projectId: string | null;
}

/* Holds the suggesting chat at `needs-you` while its card stands, the way a question of its CLI does. */
export interface ProposalChats {
    hold(chatId: string, key: string): void;
    release(chatId: string, key: string): void;
}

export interface ProjectProposalsOptions {
    chats: ProposalChats;
    now?: () => number;
    timers?: Timers;
    waitMs?: number;
    cardMs?: number;
}

interface Pending {
    proposal: ProjectProposal;
    waiters: Set<(answer: ProposalAnswer) => void>;
    cancelExpiry: () => void;
}

function holdKeyOf(proposalId: string): string {
    return `project-proposal:${proposalId}`;
}

/*
 * The cards in which an agent in Chats suggests that its chat becomes a project. One card per chat,
 * so an agent that suggests again joins the card that stands. It goes to every client; whoever
 * answers first settles it. Nothing is made here: the person reviews it in the dialog that moves a
 * chat, and a move of that chat settles the card as `moved`. An answer the call that waited missed
 * reaches the agent on its next suggestion, once.
 */
export class ProjectProposals {
    private readonly chats: ProposalChats;
    private readonly now: () => number;
    private readonly timers: Timers;
    private readonly waitMs: number;
    private readonly cardMs: number;
    private readonly sinks = new ClientSinks();
    private readonly pending = new Map<string, Pending>();
    private readonly unheard = new Map<string, ProposalAnswer>();

    constructor(options: ProjectProposalsOptions) {
        this.chats = options.chats;
        this.now = options.now ?? Date.now;
        this.timers = options.timers ?? realTimers;
        this.waitMs = options.waitMs ?? PROPOSAL_WAIT_MS;
        this.cardMs = options.cardMs ?? PROPOSAL_CARD_MS;
    }

    subscribe(clientId: string, sink: SessionSink): () => void {
        return this.sinks.subscribe(clientId, sink);
    }

    /* Raises the card, or joins the one that stands, and holds for the answer for `waitMs`. */
    ask(ask: ProposalAsk, waitMs: number = this.waitMs): Promise<ProposalAnswer> {
        const told = this.unheard.get(ask.chatId);
        if (told !== undefined && !this.pending.has(ask.chatId)) {
            this.unheard.delete(ask.chatId);
            return Promise.resolve(told);
        }
        const pending = this.raise(ask);
        return new Promise((resolve) => {
            const done = (answer: ProposalAnswer): void => {
                cancel();
                pending.waiters.delete(done);
                resolve(answer);
            };
            const cancel = this.timers.set(() => {
                pending.waiters.delete(done);
                resolve({ proposalId: pending.proposal.proposalId, outcome: 'waiting', projectId: null });
            }, waitMs);
            pending.waiters.add(done);
        });
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
        this.settle(found, { proposalId, outcome: 'declined', projectId: null });
        return true;
    }

    /* The chat left Chats for a project, however the person got there. */
    moved(chatId: string, projectId: string): void {
        const pending = this.pending.get(chatId);
        if (pending !== undefined) {
            this.settle(pending, { proposalId: pending.proposal.proposalId, outcome: 'moved', projectId });
        }
    }

    /* The chat stopped running or is gone: nobody is left to hear an answer. */
    forget(chatId: string): void {
        const pending = this.pending.get(chatId);
        if (pending !== undefined) {
            this.settle(pending, { proposalId: pending.proposal.proposalId, outcome: 'cancelled', projectId: null });
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
            waiters: new Set(),
            cancelExpiry: () => undefined
        };
        pending.cancelExpiry = this.expireLater(pending);
        this.pending.set(ask.chatId, pending);
        this.chats.hold(ask.chatId, holdKeyOf(pending.proposal.proposalId));
        this.publish();
        return pending;
    }

    private expireLater(pending: Pending): () => void {
        return this.timers.set(() => this.settle(pending, { proposalId: pending.proposal.proposalId, outcome: 'cancelled', projectId: null }), this.cardMs);
    }

    /* The waiting call hears the answer; with none waiting the agent's next suggestion does. */
    private settle(pending: Pending, answer: ProposalAnswer): void {
        const { chatId, proposalId } = pending.proposal;
        if (this.pending.get(chatId) !== pending) {
            return;
        }
        pending.cancelExpiry();
        this.pending.delete(chatId);
        this.chats.release(chatId, holdKeyOf(proposalId));
        if (pending.waiters.size === 0 && answer.outcome !== 'cancelled') {
            this.unheard.set(chatId, answer);
        }
        for (const waiter of [...pending.waiters]) {
            waiter(answer);
        }
        this.publish();
    }

    private publish(): void {
        this.sinks.emit({ event: 'chat.proposals', payload: { proposals: this.list() } });
    }
}
