import { ACTION_DEFINITIONS, type ActionName } from '@ruimte/actions';

/* The arguments of a tool call as an object, or null when the model sent anything else. */
export function objectArguments(raw: string): Record<string, unknown> | null {
    try {
        const parsed: unknown = JSON.parse(raw);
        return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
    } catch {
        return null;
    }
}

/* A strict tool carries every field of its domain; the action gets only its own, and the registry validates those. */
export function actionInput(name: ActionName, args: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(Object.keys(ACTION_DEFINITIONS[name].input.shape).map((field) => [field, args[field] ?? null]));
}

/* The answer a control call carries, or null when the token or the choice is missing. */
export function confirmationOf(args: Record<string, unknown>): { token: string; approved: boolean } | null {
    const token = typeof args.confirmation_token === 'string' ? args.confirmation_token : null;
    if (token === null || (args.action !== 'confirm' && args.action !== 'cancel')) {
        return null;
    }
    return { token, approved: args.action === 'confirm' };
}
