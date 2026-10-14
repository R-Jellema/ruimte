import { describe, expect, test } from 'bun:test';
import { machineAnswers } from './features';

describe('machineAnswers', () => {
    test('is true for a request the machine named at open', () => {
        expect(machineAnswers({ features: ['chat.list', 'session.attach'] }, 'chat.list')).toBe(true);
    });

    test('is false for a request the machine did not name', () => {
        expect(machineAnswers({ features: ['chat.list'] }, 'session.attach')).toBe(false);
    });

    test('is false while the link has not told yet', () => {
        expect(machineAnswers({}, 'chat.list')).toBe(false);
        expect(machineAnswers(undefined, 'chat.list')).toBe(false);
    });
});
