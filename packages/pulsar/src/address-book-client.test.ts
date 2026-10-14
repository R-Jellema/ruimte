import { describe, expect, test } from 'bun:test';
import { AddressBookClient, AddressBookRequestError } from './index.ts';

const TICKET = { ticket: `${'S'.repeat(43)}.1800003600000.${'M'.repeat(43)}`, expiresAt: 1_800_003_600_000 };

function client(answer: (url: string, init: RequestInit) => Response): { client: AddressBookClient; calls: { url: string; init: RequestInit }[] } {
    const calls: { url: string; init: RequestInit }[] = [];
    return {
        calls,
        client: new AddressBookClient({
            baseUrl: 'https://pulsar.test',
            fetch: async (url, init) => {
                calls.push({ url, init });
                return answer(url, init);
            }
        })
    };
}

describe('a map ticket', () => {
    test('is asked with the access token and read against its schema', async () => {
        const { client: book, calls } = client(() => Response.json(TICKET));
        expect(await book.mapsTicket('access-token')).toEqual(TICKET);
        expect(calls[0]!.url).toBe('https://pulsar.test/v1/maps/ticket');
        expect(calls[0]!.init.method).toBe('POST');
        expect(new Headers(calls[0]!.init.headers).get('authorization')).toBe('Bearer access-token');
    });

    test('an answer that is no ticket, and an address book that refuses, are errors a caller can tell apart', async () => {
        const nonsense = client(() => Response.json({ ticket: 'x', expiresAt: 1 }));
        await expect(nonsense.client.mapsTicket('t')).rejects.toMatchObject({ code: 'bad-answer' });
        const unconfigured = client(() => Response.json({ error: { code: 'not-configured', message: 'No tickets yet' } }, { status: 503 }));
        const error = await unconfigured.client.mapsTicket('t').catch((e: unknown) => e);
        expect(error).toBeInstanceOf(AddressBookRequestError);
        expect(error).toMatchObject({ code: 'not-configured', status: 503 });
    });
});
