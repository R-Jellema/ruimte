import { PLAN_LIMITS } from '@ruimte/contracts';
import type { ActionInput } from '../index.ts';
import { describeWrites, without } from './harness.ts';

const created = { document: null, markdown: '- [ ] Write the tests', title: 'Tests', kind: 'steps', checks: 'anyone' } as const;
const item = {
    planId: 'plan-1',
    type: 'step',
    title: 'Cover the catalog',
    description: null,
    under: null,
    after: 'step-1',
    checks: 'person',
    itemId: 'step-2'
} as const;
const stepState: ActionInput<'plan.setStepState'> = { planId: 'plan-1', stepIds: ['step-1'], state: 'done', note: null };

describeWrites('plans', {
    'plan.create': {
        actors: ['agent'],
        input: created,
        refused: {
            'a title past the plan limit': { ...created, title: 'x'.repeat(PLAN_LIMITS.title + 1) },
            'an empty title': { ...created, title: '' },
            'a kind it has not': { ...created, kind: 'roadmap' },
            'no document at all': without(created, 'document')
        }
    },
    'plan.setStepState': {
        actors: ['person', 'voice', 'agent'],
        input: stepState,
        refused: {
            'a state it has not': { ...stepState, state: 'half' },
            'no steps': { ...stepState, stepIds: [] },
            'no plan at all': without(stepState, 'planId')
        },
        restricted: {
            chatId: { value: 'chat-1', actors: ['person', 'voice'] },
            next: { value: 'step-2', actors: ['agent'] }
        }
    },
    'plan.addNote': {
        actors: ['person', 'voice', 'agent'],
        input: { planId: null, stepId: 'step-1', text: 'Waits on CI' },
        refused: { 'an empty step': { planId: null, stepId: '', text: '' }, 'no text': { planId: null, stepId: 'step-1' } },
        restricted: {
            chatId: { value: 'chat-1', actors: ['person', 'voice'] }
        }
    },
    'plan.unlock': {
        actors: ['person'],
        input: { chatId: 'chat-1', planId: 'plan-1', stepIds: null },
        refused: {
            'no chat': { planId: 'plan-1', stepIds: null },
            'an empty list of steps': { chatId: 'chat-1', planId: 'plan-1', stepIds: [] }
        }
    },
    'plan.addItem': {
        actors: ['agent'],
        input: item,
        refused: {
            'a type it has not': { ...item, type: 'task' },
            'an empty title': { ...item, title: '' },
            'checks nobody has': { ...item, checks: 'robot' }
        }
    },
    'plan.editItem': {
        actors: ['agent'],
        input: { planId: 'plan-1', itemId: 'step-1', title: 'Cover every write', description: '', checks: null },
        refused: {
            'an empty item': { planId: 'plan-1', itemId: '', title: null, description: null, checks: null },
            'an empty title': { planId: 'plan-1', itemId: 'step-1', title: '', description: null, checks: null }
        }
    },
    'plan.moveItem': {
        actors: ['agent'],
        input: { planId: null, itemId: 'step-2', under: 'section-1', after: null },
        refused: { 'no place at all': { planId: null, itemId: 'step-2' }, 'an empty section': { planId: null, itemId: 'step-2', under: '', after: null } }
    },
    'plan.removeItem': {
        actors: ['agent'],
        input: { planId: 'plan-1', itemId: 'step-2' },
        refused: { 'no item': { planId: 'plan-1' } }
    },
    'plan.setStatus': {
        actors: ['agent'],
        input: { planId: null, text: 'Writing the tests of the catalog' },
        refused: { 'no text': { planId: null } }
    },
    'plan.delete': {
        actors: ['agent'],
        input: { planId: 'plan-1' },
        refused: { 'the newest plan by default': { planId: null }, 'an empty plan': { planId: '' } }
    }
});
