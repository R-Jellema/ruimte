import { refusalBody } from '@adecore/agents/context';
import { VerbRefusal, type LaunchReading, type Noun, type Verb, type VerbCall } from './verb.ts';

/* An approved service that has not run, as `launches list` reads one. */
export function launchReading(launchId: string, overrides: Partial<LaunchReading> = {}): LaunchReading {
    return { launchId, name: launchId, kind: 'service', approved: true, url: null, port: null, members: [], status: null, ...overrides };
}

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
