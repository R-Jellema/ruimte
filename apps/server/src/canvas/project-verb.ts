import { PROJECT_PROPOSAL_LIMITS } from '@ruimte/contracts';
import { z } from 'zod';
import { PROPOSAL_CARD_MS } from '../projects/project-proposals.ts';
import { defineActionVerb, runAction } from './action-verb.ts';
import { SCOPE_LINE } from './verb.ts';

const PROJECT_CARD_HOURS = PROPOSAL_CARD_MS / 3_600_000;

function textFlag(flag: string, max: number, what: string) {
    return z
        .string({ error: `project propose needs --${flag}, ${what}` })
        .trim()
        .min(1, `project propose needs --${flag}, ${what}`)
        .max(max, `--${flag} is at most ${max} characters`);
}

const proposeAction = defineActionVerb('project', {
    name: 'propose',
    action: 'project.propose',
    usage: '--name <text> --reason <text> [--folder <path>]',
    params: [
        { syntax: '--name <text>', need: 'required', field: 'name' },
        { syntax: '--reason <text>', need: 'required', field: 'reason' },
        { syntax: '--folder <path>', need: 'optional', field: 'folder', more: 'absolute, on this machine; the person picks one when you leave it out' }
    ],
    detail: [
        'prints\tproposal\tid\toutcome\twhat became of the card',
        'outcome\twaiting\tthe card stands in your chat and the command does not wait for it: go on or end your turn, since a command that holds your turn would block the very move the card offers',
        'answer\tThe person answers on the card. A move shows in your next turn, which runs in the new folder and suggests nothing more; a decline closes the card',
        'outcome\tdeclined\tonly on a later suggestion: the person said no, so go on in Chats and do not suggest it again unless something changed',
        `outcome\tcancelled\tthe chat stopped before an answer, or nobody answered within ${PROJECT_CARD_HOURS} hours of your last suggestion`,
        'again\tSuggesting again from the same chat is the same card, with the new name, folder and reason; a decline that came while nobody waited is told once',
        'makes\tNothing: the person reviews the name and folder in a dialog and decides; the chat keeps its conversation when it moves',
        'when\tOnly when the work has become something with a folder of its own, such as code that keeps growing; not for every chat',
        SCOPE_LINE
    ],
    positionals: z.tuple([], { error: 'project propose takes no arguments; everything goes in its flags' }),
    flags: z.object({
        name: textFlag('name', PROJECT_PROPOSAL_LIMITS.name, 'the name of the project'),
        reason: textFlag('reason', PROJECT_PROPOSAL_LIMITS.reason, 'why this is a project now'),
        folder: z.string().trim().min(1).max(PROJECT_PROPOSAL_LIMITS.folder, `--folder is at most ${PROJECT_PROPOSAL_LIMITS.folder} characters`).optional()
    }),
    async run({ flags }, call) {
        const result = await runAction(call, 'project.propose', {
            name: flags.name,
            reason: flags.reason,
            folder: flags.folder ?? null
        });
        return [`proposal\t${result.proposalId}\t${result.outcome}`];
    }
});

export const PROJECT_SUMMARY =
    'Suggests, in a card of your chat in Chats, that the chat becomes a project; the person decides and you only hear what became of it';

export const PROJECT_DETAIL: readonly string[] = [
    'note\tOnly an AI chat in Chats suggests; the card shows in that chat until the person reviews it or declines',
    'note\tNothing is made by suggesting: the person picks the folder in the dialog that moves a chat into a project',
    SCOPE_LINE
];

export const PROJECT_ACTIONS = [proposeAction] as const;
