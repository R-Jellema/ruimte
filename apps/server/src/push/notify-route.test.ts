import { describe, expect, test } from 'bun:test';
import { MACHINE_NOTIFY_PATH } from '@ruimte/contracts';
import { handleMachineNotify } from './notify-route.ts';

const LOCAL_SECRET = 'the-local-secret';
const OPTIONS = { localSecret: LOCAL_SECRET, tickets: { ticketAccess: async () => null } };

function ask(body: unknown, authorization: string | null = `Bearer ${LOCAL_SECRET}`) {
    const alerts: Array<{ nodeId: string; text: string }> = [];
    const request = new Request(`http://127.0.0.1:4210${MACHINE_NOTIFY_PATH}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(authorization === null ? {} : { authorization }) },
        body: JSON.stringify(body)
    });
    const response = handleMachineNotify(request, '127.0.0.1', OPTIONS, {
        alert: (nodeId, text) => {
            if (nodeId === 'gone') {
                throw new Error('The notifying session is no longer in a project');
            }
            alerts.push({ nodeId, text });
        }
    });
    return { alerts, response };
}

describe('the notify route', () => {
    test('raises the alert of the node it names on the local secret', async () => {
        const { alerts, response } = ask({ nodeId: 'term-1', text: ' Done ' });
        expect((await response).status).toBe(200);
        expect(alerts).toEqual([{ nodeId: 'term-1', text: 'Done' }]);
    });

    test('refuses without the local secret, also on loopback', async () => {
        const without = ask({ nodeId: 'term-1', text: 'Done' }, null);
        expect((await without.response).status).toBe(403);
        const wrong = ask({ nodeId: 'term-1', text: 'Done' }, 'Bearer another');
        expect((await wrong.response).status).toBe(403);
        expect([...without.alerts, ...wrong.alerts]).toEqual([]);
    });

    test('a body without a node or text is a 400, and a node no project holds a 422', async () => {
        expect((await ask({ text: 'Done' }).response).status).toBe(400);
        expect((await ask({ nodeId: 'term-1', text: 'x'.repeat(501) }).response).status).toBe(400);
        const gone = await ask({ nodeId: 'gone', text: 'Done' }).response;
        expect(gone.status).toBe(422);
        expect(await gone.json()).toEqual({ code: 'node-not-found', message: 'The notifying session is no longer in a project' });
    });
});
