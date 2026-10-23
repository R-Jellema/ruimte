import { describe, expect, test } from 'bun:test';
import type { z } from 'zod';
import {
    ACTION_DEFINITIONS,
    ActionRefusal,
    ActionRegistry,
    MAX_TITLE_LENGTH,
    REVISION_CONFLICT,
    revisionConflict,
    type ActionCall,
    type ActionHandlers,
    type ActionName
} from './index.ts';

interface Context {
    name: string;
}

function call(kind: 'person' | 'voice' = 'person'): ActionCall<Context> {
    return { actor: { kind, id: `${kind}-1` }, context: { name: 'Board' } };
}

describe('ActionRegistry', () => {
    test('catalog only exposes handlers installed in this adapter', () => {
        const registry = new ActionRegistry<Context>({
            'view.focus': ({ viewId }, { context }) => ({ output: { viewId, view: context.name, kind: 'canvas', changed: true } })
        });

        expect(registry.catalog(call()).map((entry) => entry.name)).toEqual(['view.focus']);
        expect(registry.catalog(call())[0]?.input).toMatchObject({ type: 'object' });
    });

    test('answers work that goes on after it with its status and an operation id, and a dry run as completed', async () => {
        const registry = new ActionRegistry<Context>(
            {
                'view.focus': ({ viewId }, { context }) => ({
                    output: { viewId, view: context.name, kind: 'canvas', changed: true },
                    operation: { id: `focus:${viewId}`, status: 'running' }
                })
            },
            { previews: ['view.focus'] }
        );

        expect(await registry.execute('view.focus', { viewId: 'board' }, call())).toEqual({
            status: 'running',
            action: 'view.focus',
            output: { viewId: 'board', view: 'Board', kind: 'canvas', changed: true },
            operationId: 'focus:board'
        });
        expect(await registry.execute('view.focus', { viewId: 'board' }, { ...call(), dryRun: true })).toMatchObject({ status: 'completed', dryRun: true });
    });

    test('holds a write to the revision it was decided on, keeps it through a confirmation, and lets a read pass', async () => {
        let revision = 4;
        const registry = new ActionRegistry<Context>(
            {
                'view.rename': ({ viewId, name }, action) =>
                    action.confirmed || action.actor.kind === 'person'
                        ? { output: { viewId, kind: 'canvas', previousName: 'Board', name, changed: true } }
                        : { confirmation: { title: 'Rename?', consequences: [] } },
                'view.focus': ({ viewId }, { context }) => ({ output: { viewId, view: context.name, kind: 'canvas', changed: false } })
            },
            {
                checkRevision: (_name, _input, action) => {
                    if (action.expectedRevision !== revision) {
                        throw revisionConflict('The board', action.expectedRevision, revision);
                    }
                }
            }
        );
        const rename = { viewId: 'board', name: 'Plan' };

        expect(await registry.execute('view.rename', rename, { ...call(), expectedRevision: 4 })).toMatchObject({ status: 'completed' });
        expect(await registry.execute('view.rename', rename, { ...call(), expectedRevision: 3 })).toMatchObject({
            status: 'failed',
            error: { code: REVISION_CONFLICT, message: 'The board is at revision 4, and this call was decided on 3; read it again and decide anew.' }
        });
        expect(await registry.execute('view.focus', { viewId: 'board' }, { ...call(), expectedRevision: 3 })).toMatchObject({ status: 'completed' });

        const waiting = await registry.execute('view.rename', rename, { ...call('voice'), expectedRevision: 4 });
        if (waiting.status !== 'needs_confirmation') {
            throw new Error('expected a confirmation');
        }
        revision = 5;
        expect(await registry.confirm(waiting.confirmationToken, true, call('voice'))).toMatchObject({ status: 'failed', error: { code: REVISION_CONFLICT } });
    });

    test.each([
        ['view.rename', { viewId: 'board', name: 'Plan' }],
        ['chat.send', { chatId: 'chat-1', prompt: 'Run the tests' }]
    ] as const)('checks missing, stale and current revisions before dispatching %s', async (name, input) => {
        const handled: unknown[] = [];
        const handlers: ActionHandlers<Context> = {
            'view.rename': (input, action) => {
                handled.push([input, action]);
                return { output: { viewId: input.viewId, kind: 'canvas', previousName: 'Board', name: input.name, changed: true } };
            },
            'chat.send': (input, action) => {
                handled.push([input, action]);
                return { output: { chatId: input.chatId, chat: 'Tests', queued: false } };
            }
        };
        const caller = call();
        expect(await new ActionRegistry(handlers).execute(name, input, { ...caller, expectedRevision: 3 })).toMatchObject({
            status: 'failed',
            action: name,
            error: { code: 'no-revision' }
        });
        expect(handled).toEqual([]);

        const checked: unknown[] = [];
        const registry = new ActionRegistry(handlers, {
            checkRevision: (action, input, call) => {
                checked.push([action, input, call]);
                if (call.expectedRevision !== 7) {
                    throw revisionConflict('The document', call.expectedRevision, 7);
                }
            }
        });
        expect(await registry.execute(name, input, { ...caller, expectedRevision: 6 })).toMatchObject({
            status: 'failed',
            action: name,
            error: { code: REVISION_CONFLICT }
        });
        expect(handled).toEqual([]);
        expect(await registry.execute(name, input, { ...caller, expectedRevision: 7 })).toMatchObject({ status: 'completed', action: name });
        expect(checked).toEqual([
            [name, input, { ...caller, expectedRevision: 6 }],
            [name, input, { ...caller, expectedRevision: 7 }]
        ]);
        expect(handled).toEqual([[input, { ...caller, expectedRevision: 7, confirmed: false }]]);
    });

    test('dispatches a local action with a revision without consulting a revision checker', async () => {
        const handled: unknown[] = [];
        const handlers: ActionHandlers<Context> = {
            'view.focus': (input, action) => {
                handled.push([input, action]);
                return { output: { viewId: input.viewId, view: action.context.name, kind: 'canvas', changed: true } };
            }
        };
        const input = { viewId: 'board' };
        const caller = { ...call(), expectedRevision: 3 };
        const checked: unknown[] = [];
        const registries = [
            new ActionRegistry(handlers),
            new ActionRegistry(handlers, {
                checkRevision: (...args) => {
                    checked.push(args);
                    throw revisionConflict('The board', 3, 7);
                }
            })
        ];
        for (const registry of registries) {
            expect(await registry.execute('view.focus', input, caller)).toMatchObject({ status: 'completed', action: 'view.focus' });
        }
        expect(checked).toEqual([]);
        expect(handled).toEqual([
            [input, { ...caller, confirmed: false }],
            [input, { ...caller, confirmed: false }]
        ]);
    });

    test('binds a confirmation to the actor id, consumes a decline and dispatches an approval only once with its input and caller', async () => {
        const handled: unknown[] = [];
        const registry = new ActionRegistry<Context>({
            'view.delete': (input, action) => {
                handled.push([input, action]);
                return action.confirmed
                    ? { output: { viewId: input.viewId, view: action.context.name, kind: 'canvas' } }
                    : { confirmation: { title: 'Delete?', consequences: ['The board is removed'] } };
            }
        });
        const input = { viewId: 'board' };
        const caller = call();
        const declined = await registry.execute('view.delete', input, caller);
        if (declined.status !== 'needs_confirmation') {
            throw new Error('expected a confirmation');
        }
        expect(handled).toEqual([[input, { ...caller, confirmed: false }]]);
        expect(await registry.confirm(declined.confirmationToken, true, { ...caller, actor: { kind: caller.actor.kind, id: 'someone-else' } })).toMatchObject({
            status: 'failed',
            error: { code: 'unknown-confirmation' }
        });
        expect(await registry.confirm(declined.confirmationToken, true, { ...caller, actor: { kind: 'voice', id: caller.actor.id } })).toMatchObject({
            status: 'failed',
            error: { code: 'unknown-confirmation' }
        });
        expect(await registry.confirm(declined.confirmationToken, false, caller)).toMatchObject({
            status: 'failed',
            action: 'view.delete',
            error: { code: 'confirmation-declined' }
        });
        expect(await registry.confirm(declined.confirmationToken, true, caller)).toMatchObject({
            status: 'failed',
            error: { code: 'unknown-confirmation' }
        });
        expect(handled).toEqual([[input, { ...caller, confirmed: false }]]);

        const waiting = await registry.execute('view.delete', input, caller);
        if (waiting.status !== 'needs_confirmation') {
            throw new Error('expected a confirmation');
        }
        const confirmer: ActionCall<Context> = { actor: { ...caller.actor }, context: { name: 'Updated board' } };
        expect(await registry.confirm(waiting.confirmationToken, true, confirmer)).toEqual({
            status: 'completed',
            action: 'view.delete',
            output: { viewId: 'board', view: 'Updated board', kind: 'canvas' }
        });
        expect(await registry.confirm(waiting.confirmationToken, true, confirmer)).toMatchObject({
            status: 'failed',
            error: { code: 'unknown-confirmation' }
        });
        expect(handled).toEqual([
            [input, { ...caller, confirmed: false }],
            [input, { ...caller, confirmed: false }],
            [input, { ...confirmer, expectedRevision: undefined, confirmed: true }]
        ]);
    });

    test('validates input and normalizes domain refusals', async () => {
        const registry = new ActionRegistry<Context>({
            'view.rename': () => {
                throw new ActionRefusal('unknown-view', 'No such view.');
            }
        });

        expect(await registry.execute('view.rename', { viewId: '', name: '' }, call())).toMatchObject({ status: 'failed', error: { code: 'invalid-input' } });
        expect(await registry.execute('view.rename', { viewId: 'missing', name: 'Plan' }, call())).toMatchObject({
            status: 'failed',
            error: { code: 'unknown-view', message: 'No such view.' }
        });
    });

    test('binds confirmation and undo to the actor that requested them', async () => {
        let name = 'Board';
        const registry = new ActionRegistry<Context>({
            'view.rename': ({ viewId, name: next }, action) => {
                if (!action.confirmed) {
                    return { confirmation: { title: 'Rename?', consequences: [`${name} becomes ${next}`] } };
                }
                const previous = name;
                name = next;
                return {
                    output: { viewId, kind: 'canvas', previousName: previous, name, changed: true },
                    undo: () => {
                        name = previous;
                    }
                };
            }
        });

        const waiting = await registry.execute('view.rename', { viewId: 'board', name: 'Plan' }, call('voice'));
        expect(waiting.status).toBe('needs_confirmation');
        if (waiting.status !== 'needs_confirmation') {
            return;
        }
        expect(await registry.confirm(waiting.confirmationToken, true, call())).toMatchObject({ status: 'failed', error: { code: 'unknown-confirmation' } });
        const completed = await registry.confirm(waiting.confirmationToken, true, call('voice'));
        expect(completed).toMatchObject({ status: 'completed', output: { name: 'Plan' } });
        expect(name).toBe('Plan');
        if (completed.status !== 'completed' || !completed.undoToken) {
            return;
        }
        expect(await registry.undo(completed.undoToken, call())).toMatchObject({ status: 'failed', error: { code: 'unknown-undo' } });
        expect(await registry.undo(completed.undoToken, call('voice'))).toMatchObject({ status: 'completed' });
        expect(name).toBe('Board');
    });

    test('forgets what an actor that is gone was asked and could undo, and nothing of anyone else', async () => {
        const registry = new ActionRegistry<Context>({
            'view.rename': ({ viewId, name }, action) =>
                action.confirmed
                    ? { output: { viewId, kind: 'canvas', previousName: 'Board', name, changed: true }, undo: () => undefined }
                    : { confirmation: { title: 'Rename?', consequences: [] } }
        });
        const asked = async (kind: 'person' | 'voice') => {
            const result = await registry.execute('view.rename', { viewId: 'board', name: 'Plan' }, call(kind));
            return result.status === 'needs_confirmation' ? result.confirmationToken : '';
        };
        const voiceToken = await asked('voice');
        const personToken = await asked('person');
        const done = await registry.confirm(await asked('voice'), true, call('voice'));
        const undoToken = done.status === 'completed' ? done.undoToken! : '';

        registry.forget(call('voice').actor);
        expect(await registry.confirm(voiceToken, true, call('voice'))).toMatchObject({ error: { code: 'unknown-confirmation' } });
        expect(await registry.undo(undoToken, call('voice'))).toMatchObject({ error: { code: 'unknown-undo' } });
        expect(await registry.confirm(personToken, true, call())).toMatchObject({ status: 'completed' });
    });

    test('a dry run reaches only an action listed under previews, and leaves nothing to undo', async () => {
        const seen: boolean[] = [];
        const registry = new ActionRegistry<Context>(
            {
                'view.rename': ({ viewId, name }, action) => {
                    seen.push(action.dryRun === true);
                    return { output: { viewId, kind: 'canvas', previousName: 'Board', name, changed: true }, undo: () => undefined };
                },
                'view.focus': ({ viewId }) => ({ output: { viewId, view: 'Board', kind: 'canvas', changed: true } })
            },
            { previews: ['view.rename'] }
        );

        const previewed = await registry.execute('view.rename', { viewId: 'board', name: 'Plan' }, { ...call(), dryRun: true });
        expect(previewed).toMatchObject({ status: 'completed', dryRun: true });
        expect(previewed).not.toHaveProperty('undoToken');
        expect(seen).toEqual([true]);
        expect(await registry.execute('view.focus', { viewId: 'board' }, { ...call(), dryRun: true })).toMatchObject({
            status: 'failed',
            error: { code: 'no-dry-run' }
        });
    });

    test('a field or a kind kept for agents is refused from anyone else', async () => {
        const made: string[] = [];
        const registry = new ActionRegistry<Context>({
            'node.create': (input) => {
                made.push(input.kind);
                return { output: { viewId: input.viewId, view: 'Board', nodeId: 'note-1', node: 'Note', kind: input.kind } };
            }
        });
        const input = { viewId: 'board', kind: 'note', title: null, content: null, url: null, command: null, path: null, provider: null, at: null } as const;

        expect(await registry.execute('node.create', { ...input, cwd: 'src' }, call('voice'))).toMatchObject({
            status: 'failed',
            error: { code: 'forbidden-field' }
        });
        expect(await registry.execute('node.create', { ...input, kind: 'drawing', source: 'sketch' }, call('voice'))).toMatchObject({
            status: 'failed',
            error: { code: 'forbidden-field' }
        });
        expect(await registry.execute('node.create', { ...input, cwd: null }, call('voice'))).toMatchObject({ status: 'completed' });
        expect(
            await registry.execute(
                'node.create',
                { ...input, kind: 'drawing', source: 'sketch' },
                { actor: { kind: 'agent', id: 'term-1' }, context: { name: 'Board' } }
            )
        ).toMatchObject({ status: 'completed' });
        expect(made).toEqual(['note', 'drawing']);
    });

    test('an executor names the refusals its own errors carry', async () => {
        class Coded extends Error {
            readonly code: string;

            constructor(code: string, message: string) {
                super(message);
                this.code = code;
            }
        }
        const registry = new ActionRegistry<Context>(
            {
                'view.rename': () => {
                    throw new Coded('rev-conflict', 'The project moved on.');
                }
            },
            { refusalOf: (error) => (error instanceof Coded ? { code: error.code, message: error.message, details: ['line'] } : null) }
        );

        expect(await registry.execute('view.rename', { viewId: 'board', name: 'Plan' }, call())).toMatchObject({
            status: 'failed',
            error: { code: 'rev-conflict', message: 'The project moved on.', details: ['line'] }
        });
    });
});

describe('the catalog', () => {
    test('holds every name a caller gives to the title limit', () => {
        const names: [ActionName, string][] = [
            ['view.create', 'name'],
            ['view.rename', 'name'],
            ['node.create', 'title'],
            ['node.rename', 'name'],
            ['layout.save', 'name'],
            ['group.create', 'label'],
            ['link.create', 'label'],
            ['task.create', 'title'],
            ['agent.start', 'title']
        ];
        for (const [action, field] of names) {
            const schema = (ACTION_DEFINITIONS[action].input.shape as Record<string, z.ZodType>)[field]!;
            expect(schema.safeParse('x'.repeat(MAX_TITLE_LENGTH)).success).toBe(true);
            expect(schema.safeParse('x'.repeat(MAX_TITLE_LENGTH + 1)).success).toBe(false);
        }
    });
});
