import type { ActionRegistry, ActionResult } from '@ruimte/actions';
import { VOICE_ACTION_CALL } from './client-actions';

export function completed<Result extends ActionResult>(result: Result): Extract<Result, { status: 'completed' }> {
    if (result.status !== 'completed') {
        throw new Error(`Expected a completed action, got ${JSON.stringify(result)}`);
    }
    return result as Extract<Result, { status: 'completed' }>;
}

/* Answers yes to the question an action asked and hands back what it did. */
export async function confirmed(registry: ActionRegistry<void>, asked: ActionResult): Promise<ActionResult> {
    if (asked.status !== 'needs_confirmation') {
        throw new Error(`Expected a confirmation, got ${JSON.stringify(asked)}`);
    }
    return registry.confirm(asked.confirmationToken, true, VOICE_ACTION_CALL);
}
