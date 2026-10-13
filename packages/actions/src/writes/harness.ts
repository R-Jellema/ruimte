import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import {
    ACTION_ACTOR_KINDS,
    ACTION_DEFINITIONS,
    ActionRegistry,
    REVISION_CONFLICT,
    fieldActors,
    revisionConflict,
    type ActionActor,
    type ActionActorKind,
    type ActionCall,
    type ActionDomain,
    type ActionHandler,
    type ActionHandlers,
    type ActionInput,
    type ActionName
} from '../index.ts';
import { sampleOf } from './sample.ts';

interface Context {
    project: string;
}

interface HostCall {
    action: ActionName;
    input: unknown;
    actor: ActionActor;
    context: Context;
    confirmed: boolean;
}

/* A value of a field, or of a member of a union, that only these actors may give. */
export interface RestrictedValue {
    value: unknown;
    actors: readonly ActionActorKind[];
}

export interface WriteCase<Name extends ActionName> {
    /* Who may run it, as the product rules decide; the catalog has to say the same. */
    actors: readonly ActionActorKind[];
    /* An input every actor of the action may give, already as the schema leaves it. */
    input: ActionInput<Name>;
    /* Inputs the schema refuses, by what is wrong with them. */
    refused: Record<string, unknown>;
    /* Every field or union member kept for some actors, by field name. */
    restricted?: Record<string, RestrictedValue>;
    /* Set when the catalog promises a confirmation before it runs. */
    confirms?: true;
}

export type WriteCases = { [Name in ActionName]?: WriteCase<Name> };

const CONTEXT: Context = { project: 'Ruimte' };
const WRITES: ReadonlySet<string> = new Set(['shared', 'external']);

function actor(kind: ActionActorKind, id = `${kind}-1`): ActionActor {
    return { kind, id };
}

function call(kind: ActionActorKind): ActionCall<Context> {
    return { actor: actor(kind), context: CONTEXT };
}

/* An executor for every action in the catalog, so a call that reaches the wrong one shows in what it noted. */
function fakeHost(confirming: ActionName | null = null): { handlers: ActionHandlers<Context>; calls: HostCall[] } {
    const calls: HostCall[] = [];
    const handlerFor = (action: ActionName): ActionHandler<Context, ActionName> => {
        return (input, { actor: caller, context, confirmed }) => {
            if (action === confirming && !confirmed) {
                return { confirmation: { title: `Run ${action}?`, consequences: [] } };
            }
            calls.push({ action, input, actor: caller, context, confirmed });
            return { output: sampleOf(ACTION_DEFINITIONS[action].output) };
        };
    };
    const names = Object.keys(ACTION_DEFINITIONS) as ActionName[];
    return { handlers: Object.fromEntries(names.map((name) => [name, handlerFor(name)])) as ActionHandlers<Context>, calls };
}

/* Whether a field of an input carries actors of its own, on itself or on a member of its union. */
function isRestricted(schema: z.ZodType): boolean {
    if (fieldActors(schema) !== null) {
        return true;
    }
    return schema instanceof z.ZodUnion && (schema.options as z.ZodType[]).some((option) => fieldActors(option) !== null);
}

function writesOf(domain: ActionDomain): ActionName[] {
    return (Object.keys(ACTION_DEFINITIONS) as ActionName[]).filter(
        (name) => ACTION_DEFINITIONS[name].domain === domain && ACTION_DEFINITIONS[name].effect !== 'read'
    );
}

function describeWrite<Name extends ActionName>(name: Name, writeCase: WriteCase<Name>): void {
    const definition = ACTION_DEFINITIONS[name];
    const shape = definition.input.shape as Record<string, z.ZodType>;
    const others = ACTION_ACTOR_KINDS.filter((kind) => !writeCase.actors.includes(kind));

    describe(name, () => {
        test(`is run by ${writeCase.actors.join(', ')} through its own executor, with the input as given`, async () => {
            expect([...definition.actors].sort()).toEqual([...writeCase.actors].sort());
            for (const kind of writeCase.actors) {
                const host = fakeHost();
                const registry = new ActionRegistry<Context>(host.handlers);
                const result: unknown = await registry.execute(name, writeCase.input, call(kind));
                expect(result).toEqual({ status: 'completed', action: name, output: sampleOf(definition.output as z.ZodType) });
                expect(host.calls).toEqual([{ action: name, input: writeCase.input, actor: actor(kind), context: CONTEXT, confirmed: false }]);
            }
        });

        if (others.length > 0) {
            test(`refuses ${others.join(', ')} with forbidden-action`, async () => {
                for (const kind of others) {
                    const host = fakeHost();
                    const registry = new ActionRegistry<Context>(host.handlers);
                    expect(await registry.execute(name, writeCase.input, call(kind))).toMatchObject({
                        status: 'failed',
                        action: name,
                        error: { code: 'forbidden-action' }
                    });
                    expect(host.calls).toEqual([]);
                }
            });
        }

        test('refuses an input its schema does not take', async () => {
            const refused = Object.entries(writeCase.refused);
            expect(refused.length).toBeGreaterThan(0);
            for (const [why, input] of refused) {
                const host = fakeHost();
                const registry = new ActionRegistry<Context>(host.handlers);
                const result = await registry.execute(name, input, call(writeCase.actors[0]!));
                expect({ why, result }).toMatchObject({ why, result: { status: 'failed', error: { code: 'invalid-input' } } });
                expect(host.calls).toEqual([]);
            }
        });

        test('takes a field kept for some actors only from them', async () => {
            const restricted = writeCase.restricted ?? {};
            const kept = Object.keys(shape).filter((field) => isRestricted(shape[field]!));
            expect(Object.keys(restricted).sort()).toEqual(kept.sort());
            for (const [field, { value, actors }] of Object.entries(restricted)) {
                for (const kind of writeCase.actors) {
                    const host = fakeHost();
                    const registry = new ActionRegistry<Context>(host.handlers);
                    const input = { ...writeCase.input, [field]: value };
                    const result = await registry.execute(name, input, call(kind));
                    if (actors.includes(kind)) {
                        expect({ field, kind, result }).toMatchObject({ field, kind, result: { status: 'completed' } });
                        expect(host.calls.map((noted) => noted.input)).toEqual([input]);
                    } else {
                        expect({ field, kind, result }).toMatchObject({ field, kind, result: { status: 'failed', error: { code: 'forbidden-field' } } });
                        expect(host.calls).toEqual([]);
                    }
                }
            }
        });

        if (writeCase.confirms) {
            test('runs only once the actor that asked confirms it', async () => {
                const kind = writeCase.actors[0]!;
                const host = fakeHost(name);
                const registry = new ActionRegistry<Context>(host.handlers);

                const declined = await registry.execute(name, writeCase.input, call(kind));
                if (declined.status !== 'needs_confirmation') {
                    throw new Error(`${name} did not ask for a confirmation`);
                }
                expect(await registry.confirm(declined.confirmationToken, true, { actor: actor(kind, 'someone-else'), context: CONTEXT })).toMatchObject({
                    status: 'failed',
                    error: { code: 'unknown-confirmation' }
                });
                expect(await registry.confirm(declined.confirmationToken, false, call(kind))).toMatchObject({
                    status: 'failed',
                    action: name,
                    error: { code: 'confirmation-declined' }
                });
                expect(host.calls).toEqual([]);

                const waiting = await registry.execute(name, writeCase.input, call(kind));
                if (waiting.status !== 'needs_confirmation') {
                    throw new Error(`${name} did not ask for a confirmation`);
                }
                expect(await registry.confirm(waiting.confirmationToken, true, call(kind))).toMatchObject({ status: 'completed', action: name });
                expect(host.calls).toEqual([{ action: name, input: writeCase.input, actor: actor(kind), context: CONTEXT, confirmed: true }]);
            });
        }

        if (WRITES.has(definition.effect)) {
            test('holds to the revision it was decided on', async () => {
                const kind = writeCase.actors[0]!;
                const unchecked = fakeHost();
                expect(
                    await new ActionRegistry<Context>(unchecked.handlers).execute(name, writeCase.input, { ...call(kind), expectedRevision: 3 })
                ).toMatchObject({
                    status: 'failed',
                    error: { code: 'no-revision' }
                });
                expect(unchecked.calls).toEqual([]);

                const checked: unknown[] = [];
                const host = fakeHost();
                const registry = new ActionRegistry<Context>(host.handlers, {
                    checkRevision: (action, input, { expectedRevision }) => {
                        checked.push([action, input]);
                        if (expectedRevision !== 7) {
                            throw revisionConflict('The document', expectedRevision, 7);
                        }
                    }
                });
                expect(await registry.execute(name, writeCase.input, { ...call(kind), expectedRevision: 6 })).toMatchObject({
                    status: 'failed',
                    error: { code: REVISION_CONFLICT }
                });
                expect(host.calls).toEqual([]);
                expect(await registry.execute(name, writeCase.input, { ...call(kind), expectedRevision: 7 })).toMatchObject({ status: 'completed' });
                expect(checked).toEqual([
                    [name, writeCase.input],
                    [name, writeCase.input]
                ]);
            });
        } else {
            test('changes only this client, so a revision does not hold it', async () => {
                const host = fakeHost();
                const registry = new ActionRegistry<Context>(host.handlers);
                expect(await registry.execute(name, writeCase.input, { ...call(writeCase.actors[0]!), expectedRevision: 3 })).toMatchObject({
                    status: 'completed'
                });
            });
        }
    });
}

/* The tests of every action of a domain that changes something, which have to be all of them. */
export function describeWrites(domain: ActionDomain, cases: WriteCases): void {
    describe(`the ${domain} actions that change something`, () => {
        test('each have their case', () => {
            expect(Object.keys(cases).sort()).toEqual(writesOf(domain).sort());
        });

        test('ask for a confirmation exactly where the catalog promises one', () => {
            const promised = writesOf(domain).filter((name) => /confirmation/.test(ACTION_DEFINITIONS[name].description));
            const asked = (Object.keys(cases) as ActionName[]).filter((name) => cases[name]?.confirms === true);
            expect(asked.sort()).toEqual(promised.sort());
        });

        for (const name of Object.keys(cases) as ActionName[]) {
            describeWrite(name, cases[name] as WriteCase<typeof name>);
        }
    });
}

export function without<Input extends object>(input: Input, field: keyof Input): Record<string, unknown> {
    const { [field]: _left, ...rest } = input as Record<PropertyKey, unknown>;
    return rest;
}
