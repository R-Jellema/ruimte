import { refusalBody } from '@adecore/agents/context';
import { VerbRefusal, type Noun, type Verb, type VerbCall } from './verb.ts';

/* What the CLI prints: the lines of an answer, or the refusal with its advice. */
export async function printed(entry: Verb | Noun, argv: string[], call: VerbCall): Promise<string[]> {
    try {
        return await entry.run(argv, call);
    } catch (error) {
        if (error instanceof VerbRefusal) {
            return refusalBody(error.code, error.message, error.lines).split('\n');
        }
        throw error;
    }
}
