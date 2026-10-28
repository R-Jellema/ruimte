import { describe, expect, test } from 'bun:test';
import {
    PersonalTemplatesFileSchema,
    ProjectTemplatesFileSchema,
    TemplateChangedEventSchema,
    TemplateConfigurePayloadSchema,
    TemplateSavePayloadSchema,
    TemplateSaveResultSchema
} from './templates.ts';

const live = { key: 'log', body: 'console.log($0);', languages: ['javascript'] };

describe('the template requests', () => {
    test('a save names its kind and carries the template of that kind', () => {
        const save = { scope: 'personal', revision: 3, kind: 'live', template: live };

        expect(TemplateSavePayloadSchema.safeParse(save).success).toBe(true);
        expect(TemplateSavePayloadSchema.safeParse({ ...save, kind: 'postfix' }).success).toBe(true);
        expect(TemplateSavePayloadSchema.safeParse({ ...save, kind: 'other' }).success).toBe(false);
        expect(TemplateSavePayloadSchema.safeParse({ ...save, revision: -1 }).success).toBe(false);
    });

    test('a client cannot set the mark of an agent', () => {
        const parsed = TemplateSavePayloadSchema.parse({
            scope: 'personal',
            revision: 0,
            kind: 'live',
            template: { ...live, addedBy: { kind: 'agent', chatId: 'chat', at: 1 } }
        });

        expect(parsed.template).not.toHaveProperty('addedBy');
    });

    test('a result and an event carry the snapshot of their scope', () => {
        const snapshot = { revision: 1, live: [], postfix: [], disabled: [], settings: {} };

        expect(TemplateChangedEventSchema.safeParse({ scope: 'personal', snapshot }).success).toBe(true);
        expect(TemplateChangedEventSchema.safeParse({ scope: 'project', projectId: 'p1', snapshot: { revision: 1, live: [], postfix: [] } }).success).toBe(
            true
        );
        expect(TemplateChangedEventSchema.safeParse({ scope: 'project', snapshot }).success).toBe(false);
        expect(TemplateSaveResultSchema.safeParse({ revision: 1, kind: 'live', template: { id: 'a', ...live } }).success).toBe(true);
    });

    test('configure changes nothing it does not name', () => {
        expect(TemplateConfigurePayloadSchema.safeParse({ revision: 1 }).success).toBe(true);
        expect(TemplateConfigurePayloadSchema.safeParse({ revision: 1, disabled: [''] }).success).toBe(false);
    });
});

describe('the template files', () => {
    test('a key of a later release is kept when the file is read', () => {
        const file = { version: 1, live: [], later: { a: 1 }, settings: { postfix: true, laterSwitch: 1 } };

        expect(PersonalTemplatesFileSchema.parse(file)).toEqual(file);
        expect(ProjectTemplatesFileSchema.parse({ version: 1, later: true })).toEqual({ version: 1, later: true });
    });

    test('a file without a version is not one of ours', () => {
        expect(ProjectTemplatesFileSchema.safeParse({ live: [] }).success).toBe(false);
    });
});
