import i18next from 'i18next';
import type { AgentRequest, ComputerApproval, ComputerApprovalChoice, ProjectProposal, SecretRequest } from '@ruimte/contracts';
import type { PromptAction, ApprovalButtonSpec, HostPrompt, PromptSubject } from '@adecore/agents-react/prompts';
import type { ProposalAnswers } from '@/proposals/answer';
import type { SecretAnswers } from '@/secrets/answer';

/*
 * What Ruimte asks beside a chat's own prompts: the machine's approval for an agent to operate an app
 * an agent's ask for a launch's secret and an agent's suggestion to make its chat a project, which
 * the machine asks and not the CLI, and a terminal whose TUI waits, which only the TUI answers.
 */
export type RuimtePromptData =
    | { kind: 'computer-approval'; request: ComputerApproval }
    | { kind: 'secret-request'; endpointId: string; request: SecretRequest }
    | { kind: 'project-proposal'; endpointId: string; proposal: ProjectProposal }
    | { kind: 'terminal-waiting'; since: number; request?: AgentRequest };

/* The field of a secret card's answer; the value travels in it only from the card to the machine. */
export const SECRET_ANSWER_FIELD = 'value';

/* Decline is the one choice a secret card offers besides Save, and the one a suggestion's card sends to the machine. */
export const SECRET_DECLINE = 'decline';

export interface RuimtePrompt extends HostPrompt {
    data: RuimtePromptData;
}

const COMPUTER_CHOICES: readonly string[] = ['once', 'always', 'deny'] satisfies ComputerApprovalChoice[];

function isComputerChoice(choiceId: string): choiceId is ComputerApprovalChoice {
    return COMPUTER_CHOICES.includes(choiceId);
}

export function computerPrompt(nodeId: string, request: ComputerApproval): RuimtePrompt {
    return {
        id: `computer:${nodeId}:${request.requestId}`,
        createdAt: request.createdAt,
        blocking: true,
        asks: 'approval',
        data: { kind: 'computer-approval', request }
    };
}

export function secretPrompt(endpointId: string, nodeId: string, request: SecretRequest): RuimtePrompt {
    return {
        id: `secret:${nodeId}:${request.requestId}`,
        createdAt: request.createdAt,
        blocking: true,
        asks: 'question',
        data: { kind: 'secret-request', endpointId, request }
    };
}

export function proposalPrompt(endpointId: string, chatId: string, proposal: ProjectProposal): RuimtePrompt {
    return {
        id: `project-proposal:${chatId}:${proposal.proposalId}`,
        createdAt: proposal.createdAt,
        blocking: true,
        asks: 'question',
        data: { kind: 'project-proposal', endpointId, proposal }
    };
}

export function waitingPrompt(nodeId: string, since: number, request?: AgentRequest): RuimtePrompt {
    return {
        id: `waiting:${nodeId}${request ? `:${request.id}` : ''}`,
        createdAt: since,
        blocking: true,
        asks: request?.kind ?? 'approval',
        data: { kind: 'terminal-waiting', since, ...(request ? { request } : {}) }
    };
}

export function isRuimtePrompt(prompt: HostPrompt): prompt is RuimtePrompt {
    const data = prompt.data as Partial<RuimtePromptData> | null;
    return data?.kind === 'computer-approval' || data?.kind === 'secret-request' || data?.kind === 'project-proposal' || data?.kind === 'terminal-waiting';
}

/* Terminal status snapshots rebuild requests, so equal content must still keep the stack steady. */
export function ruimtePayloadOf(subject: PromptSubject): unknown {
    if (subject.kind === 'chat') {
        return subject.item;
    }
    if (!isRuimtePrompt(subject.prompt)) {
        return subject.prompt.data;
    }
    const { data } = subject.prompt;
    if (data.kind === 'computer-approval' || data.kind === 'secret-request') {
        return data.request;
    }
    if (data.kind === 'project-proposal') {
        return data.proposal;
    }
    return data.request ? JSON.stringify(data.request) : data.since;
}

/* The buttons of an approval to operate an app: Deny, Always allow, and Allow this time as the primary. */
export function computerButtons(): ApprovalButtonSpec[] {
    const choose = (choiceId: ComputerApprovalChoice) => ({ kind: 'choose', choiceId }) as const;
    return [
        { id: 'deny', label: i18next.t('prompts:computer.deny'), primary: false, action: choose('deny') },
        { id: 'always', label: i18next.t('prompts:computer.always'), primary: false, lasting: true, action: choose('always') },
        { id: 'once', label: i18next.t('prompts:computer.once'), primary: true, action: choose('once') }
    ];
}

/*
 * Sends a card's answer to the machine, which says whether it still waited. A waiting terminal is
 * answered only in its TUI, so it sends nothing.
 */
export async function answerRuimtePrompt(
    prompt: HostPrompt,
    action: PromptAction,
    answerComputer: (requestId: string, choice: ComputerApprovalChoice) => Promise<boolean>,
    secrets: SecretAnswers,
    proposals?: ProposalAnswers
): Promise<void> {
    if (!isRuimtePrompt(prompt) || prompt.data.kind === 'terminal-waiting') {
        throw new Error(i18next.t('prompts:error.terminalOnly'));
    }
    if (prompt.data.kind === 'project-proposal') {
        const { endpointId, proposal } = prompt.data;
        // Review opens the dialog from the card itself; only a no reaches the machine from here.
        if (
            action.kind !== 'choose' ||
            action.choiceId !== SECRET_DECLINE ||
            proposals === undefined ||
            !(await proposals.decline(endpointId, proposal.proposalId))
        ) {
            throw new Error(i18next.t('prompts:error.expired'));
        }
        return;
    }
    if (prompt.data.kind === 'secret-request') {
        const { endpointId, request } = prompt.data;
        const value = action.kind === 'answer' ? action.answers[SECRET_ANSWER_FIELD] : undefined;
        let accepted: boolean;
        if (value !== undefined && value !== '') {
            accepted = await secrets.save(endpointId, request.requestId, value);
        } else if (action.kind === 'choose' && action.choiceId === SECRET_DECLINE) {
            accepted = await secrets.decline(endpointId, request.requestId);
        } else {
            throw new Error(i18next.t('prompts:error.expired'));
        }
        if (!accepted) {
            throw new Error(i18next.t('prompts:error.expired'));
        }
        return;
    }
    if (action.kind !== 'choose' || !isComputerChoice(action.choiceId) || !(await answerComputer(prompt.data.request.requestId, action.choiceId))) {
        throw new Error(i18next.t('prompts:error.expired'));
    }
}
