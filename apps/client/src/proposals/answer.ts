import { machineTransport } from '@/transport';

/* A person's no to a project suggestion, straight to the machine that holds the card. False when the card was gone already. */
export interface ProposalAnswers {
    decline(endpointId: string, proposalId: string): Promise<boolean>;
}

export const proposalAnswers: ProposalAnswers = {
    decline: async (endpointId, proposalId) => (await machineTransport(endpointId).request('chat.proposalDecline', { proposalId })).accepted
};
