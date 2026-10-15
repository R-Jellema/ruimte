import { describe, expect, test } from 'bun:test';
import { checkedReply } from './peer-reply.ts';

describe('what another machine answered', () => {
    test('passes an answer that fits and drops the keys the answer does not name', () => {
        expect(checkedReply<object>('peer.taskStart', { cwd: '/work', branch: null, extra: 'left out' })).toEqual({ cwd: '/work', branch: null });
        expect(checkedReply<object>('peer.result', { status: 'open', result: null, bundle: null })).toEqual({ status: 'open', result: null, bundle: null });
    });

    test('refuses an answer that is not one to the request', () => {
        expect(() => checkedReply('peer.result', { status: 'finished', result: 'text', bundle: null })).toThrow('not an answer to it');
        expect(() => checkedReply('peer.taskStart', 'ok')).toThrow('not an answer to it');
        expect(() => checkedReply('peer.bundleRead', { size: -1, offset: 0, data: 5 })).toThrow('not an answer to it');
    });

    test('refuses a request this machine has no answer for', () => {
        expect(() => checkedReply('peer.nothing', {})).toThrow('does not know');
    });
});
