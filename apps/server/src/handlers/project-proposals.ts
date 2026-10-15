import type { Dispatcher } from '../dispatcher.ts';
import type { ProjectProposals } from '../projects/project-proposals.ts';

/* Every client of the machine is its owner or one the owner let in, so any of them answers a card, as a question of a chat is answered. */
export function registerProposalHandlers(dispatcher: Dispatcher, proposals: Pick<ProjectProposals, 'list' | 'decline'>): void {
    dispatcher.register('chat.proposals', () => ({ proposals: proposals.list() }));

    dispatcher.register('chat.proposalDecline', (payload) => ({ accepted: proposals.decline(payload.proposalId) }));
}
