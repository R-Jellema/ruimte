import { describe, expect, test } from 'bun:test';
import { MACHINE_SWITCHES } from './machine-switches';

describe('the switches of a machine', () => {
    test('visual replies sit beside the resume after a limit', () => {
        expect(MACHINE_SWITCHES).toEqual(['resumeAtReset', 'visualReplies', 'agentsDeleteAnyView']);
    });
});
