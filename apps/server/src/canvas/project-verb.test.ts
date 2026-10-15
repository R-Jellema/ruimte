import { beforeEach, describe, expect, test } from 'bun:test';
import { refusalBody } from '@adecore/agents/context';
import type { ProposalAnswer, ProposalAsk } from '../projects/project-proposals.ts';
import { VerbRefusal, type CanvasHost, type Noun, type Verb } from './verb.ts';
import { verbNamed } from './verbs.ts';

const noun = verbNamed('project') as Noun;

let asks: ProposalAsk[];
let answer: ProposalAnswer;
let host: CanvasHost;

beforeEach(() => {
    asks = [];
    answer = { proposalId: 'prop-1', outcome: 'declined', projectId: null };
    host = {
        projects: {
            locate: (id: string) => ({ projectId: 'chats', folder: '/home/.ruimte/scratch', canvasId: null, id }),
            read: async () => ({ views: [] })
        },
        proposals: {
            inChats: (chatId: string) => chatId === 'chat-1',
            propose: async (ask: ProposalAsk) => {
                asks.push(ask);
                return answer;
            }
        }
    } as unknown as CanvasHost;
});

async function run(argv: string[], caller = 'chat-1'): Promise<string[]> {
    try {
        return await noun.run(argv, { caller, host });
    } catch (error) {
        if (error instanceof VerbRefusal) {
            return refusalBody(error.code, error.message, error.lines).split('\n');
        }
        throw error;
    }
}

const PROPOSE = ['propose', '--name', 'Vinyl shelf', '--reason', 'The notes became a codebase'];

describe('ruimte-context project', () => {
    test('suggests a project and prints only what became of the card', async () => {
        expect(await run([...PROPOSE, '--folder', '/work/vinyl-shelf'])).toEqual(['proposal\tprop-1\tdeclined\t-']);
        expect(asks).toEqual([{ chatId: 'chat-1', name: 'Vinyl shelf', folder: '/work/vinyl-shelf', reason: 'The notes became a codebase' }]);
    });

    test('prints the project a moved chat now lives in, and every other outcome', async () => {
        answer = { proposalId: 'prop-1', outcome: 'moved', projectId: 'project-9' };
        expect(await run(PROPOSE)).toEqual(['proposal\tprop-1\tmoved\tproject-9']);
        for (const outcome of ['declined', 'cancelled', 'waiting'] as const) {
            answer = { proposalId: 'prop-1', outcome, projectId: null };
            expect((await run(PROPOSE))[0]).toBe(`proposal\tprop-1\t${outcome}\t-`);
        }
        expect(asks.at(-1)).not.toHaveProperty('folder');
    });

    test('refuses a caller outside Chats, a relative folder and a missing flag, and asks nothing', async () => {
        expect((await run(PROPOSE, 'chat-in-project'))[0]).toStartWith('refused\tnot-in-chats\t');
        expect((await run([...PROPOSE, '--folder', 'vinyl-shelf']))[0]).toStartWith('refused\tfolder-not-absolute\t');
        expect((await run(PROPOSE.slice(0, 3)))[0]).toStartWith('refused\t');
        expect((await run(['propose', '--reason', 'x']))[0]).toStartWith('refused\t');
        expect((await run([...PROPOSE, '--wait', '30']))[0]).toStartWith('refused\t');
        expect(asks).toEqual([]);
    });

    test('help names every outcome and says the person decides', async () => {
        const help = await (verbNamed('help') as Verb).run(['project', 'propose'], { caller: 'chat-1', host });
        const text = help.join('\n');
        for (const word of ['moved', 'declined', 'waiting', 'cancelled', '--folder', 'next turn', 'closes the card', 'Nothing']) {
            expect(text).toContain(word);
        }
        expect(text).not.toContain('--wait');
    });
});
