import { REQUEST_SCHEMAS } from '@ruimte/contracts';
import { CodedError } from '@adecore/agents';

/*
 * What another machine answered, read with the schema of the request. That machine is not trusted: an
 * answer that does not fit is an error here, and what does fit loses every key the schema does not name.
 */
export function checkedReply<T>(type: string, reply: unknown): T {
    const schema = (REQUEST_SCHEMAS as Record<string, { result: { safeParse(value: unknown): { success: boolean; data?: unknown } } } | undefined>)[type];
    if (schema === undefined) {
        throw new CodedError('bad-reply', `The other machine was asked for ${type}, which this machine does not know`);
    }
    const parsed = schema.result.safeParse(reply);
    if (!parsed.success) {
        throw new CodedError('bad-reply', `The other machine answered ${type} with something that is not an answer to it`);
    }
    return parsed.data as T;
}
