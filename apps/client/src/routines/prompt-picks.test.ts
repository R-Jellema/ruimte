import { describe, expect, test } from 'bun:test';
import type { Referables } from '@adecore/agents-react/chat';
import { promptDraftOf, routinePicked } from './prompt-picks';

const HERE: Referables = { items: [{ id: 'sketch', name: 'Sketch', kind: 'drawing', group: 'views' }], chatsOnly: false };

describe('what a routine keeps of the picks in its prompt', () => {
    test('only what the prompt still holds, and nothing at all without picks', () => {
        const draft = { ...promptDraftOf('Use $report on #Sketch', { skills: ['report', 'gone'], references: ['sketch'] }), mentions: ['src/a.ts'] };
        expect(routinePicked(draft, HERE)).toEqual({ skills: ['report'], references: ['sketch'] });
        expect(routinePicked(promptDraftOf('Plain words', undefined), HERE)).toBeUndefined();
    });

    test("keeps another project's views as they were, since this window cannot read them", () => {
        const draft = promptDraftOf('Look at #Sketch', { references: ['sketch'], chats: ['chat-1'] });
        expect(routinePicked(draft, null)).toEqual({ chats: ['chat-1'], references: ['sketch'] });
    });
});
