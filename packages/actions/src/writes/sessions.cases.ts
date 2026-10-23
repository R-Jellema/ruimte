import { MAX_TITLE_LENGTH } from '../index.ts';
import { type WriteCases } from './case.ts';

const selection = { model: 'claude-opus-5-5', options: { effort: 'high', thinking: true } };
const fork = { chatId: 'chat-1', turnId: null, title: null, branch: 'fork/tests' } as const;
const answer = { chatId: 'chat-1', requestId: 'request-1', answers: [{ questionId: 'q1', answer: 'The second one' }] };

export const cases: WriteCases = {
    'terminal.prepare': {
        actors: ['person'],
        input: { endpointId: 'endpoint-1', machineId: 'machine-1', token: 'prepare-1' },
        refused: {
            'an empty token': { endpointId: 'endpoint-1', machineId: 'machine-1', token: '' },
            'no machine': { endpointId: 'endpoint-1', token: 'prepare-1' }
        }
    },
    'chat.stopTurn': {
        actors: ['person', 'voice'],
        input: { chatId: 'chat-1', subagents: true },
        refused: { 'no answer to subagents': { chatId: 'chat-1' } },
        confirms: true
    },
    'chat.unqueue': {
        actors: ['person', 'voice'],
        input: { chatId: 'chat-1', messageId: 'message-1' },
        refused: { 'an empty message': { chatId: 'chat-1', messageId: '' } }
    },
    'chat.sendNow': {
        actors: ['person', 'voice'],
        input: { chatId: 'chat-1', messageId: 'message-1' },
        refused: { 'no message': { chatId: 'chat-1' } }
    },
    'chat.compact': {
        actors: ['person', 'voice'],
        input: { chatId: 'chat-1' },
        refused: { 'an empty chat': { chatId: '' } }
    },
    'chat.restart': {
        actors: ['person'],
        input: { chatId: 'chat-1' },
        refused: { 'no chat': {} }
    },
    'chat.configure': {
        actors: ['person', 'voice'],
        input: { chatId: 'chat-1', model: 'claude-opus-5-5', option: { id: 'effort', value: 'high' } },
        refused: {
            'a blank model': { chatId: 'chat-1', model: ' ', option: null },
            'an option without a value': { chatId: 'chat-1', model: null, option: { id: 'effort', value: '' } },
            'a mode it has not': { chatId: 'chat-1', model: null, option: null, runtimeMode: 'yolo' }
        },
        restricted: {
            runtimeMode: { value: 'auto', actors: ['person'] },
            resumeAtReset: { value: true, actors: ['person'] },
            selection: { value: selection, actors: ['person'] },
            account: { value: 'work', actors: ['person', 'voice'] }
        }
    },
    'chat.setProvider': {
        actors: ['person', 'voice'],
        input: { chatId: 'chat-1', provider: 'codex', model: null },
        refused: {
            'a CLI that is no identifier': { chatId: 'chat-1', provider: 'Cursor CLI', model: null },
            'no model at all': { chatId: 'chat-1', provider: 'codex' }
        },
        restricted: {
            selection: { value: selection, actors: ['person'] }
        }
    },
    'chat.fork': {
        actors: ['person', 'voice', 'agent'],
        input: fork,
        refused: {
            'a title past the title limit': { ...fork, title: 'x'.repeat(MAX_TITLE_LENGTH + 1) },
            'a blank branch': { ...fork, branch: ' ' },
            'an account that is no account id': { ...fork, account: 'Work Account' }
        },
        restricted: {
            asView: { value: true, actors: ['person'] },
            filesAfterTurn: { value: true, actors: ['person'] },
            provider: { value: 'codex', actors: ['person'] },
            selection: { value: selection, actors: ['person'] },
            account: { value: 'work', actors: ['person', 'voice'] }
        },
        confirms: true
    },
    'chat.continueOn': {
        actors: ['person', 'voice'],
        input: { chatId: 'chat-1', account: 'work' },
        refused: { 'an account that is no account id': { chatId: 'chat-1', account: 'Work' }, 'no account': { chatId: 'chat-1' } }
    },
    'chat.summarize': {
        actors: ['person', 'voice'],
        input: { chatId: 'fork-1' },
        refused: { 'no fork': {} }
    },
    'chat.stopSubagent': {
        actors: ['person', 'voice'],
        input: { chatId: 'chat-1', toolUseId: 'tool-1' },
        refused: { 'an empty sub-agent': { chatId: 'chat-1', toolUseId: '' } },
        confirms: true
    },
    'chat.stopTask': {
        actors: ['person', 'voice'],
        input: { chatId: 'chat-1', taskId: 'task-1' },
        refused: { 'no task': { chatId: 'chat-1' } },
        confirms: true
    },
    'chat.goal': {
        actors: ['person', 'voice'],
        input: { chatId: 'chat-1', change: 'pause' },
        refused: { 'a change it has not': { chatId: 'chat-1', change: 'abandon' } },
        confirms: true
    },
    'chat.answer': {
        actors: ['person', 'voice'],
        input: answer,
        refused: {
            'no answers': { ...answer, answers: [] },
            'a blank answer': { ...answer, answers: [{ questionId: 'q1', answer: ' ' }] },
            'an answer to no question': { ...answer, answers: [{ questionId: '', answer: 'Yes' }] }
        },
        confirms: true
    },
    'chat.dismissQuestion': {
        actors: ['person', 'voice'],
        input: { chatId: 'chat-1', itemId: 'item-1' },
        refused: { 'an empty question': { chatId: 'chat-1', itemId: '' } },
        confirms: true
    },
    'chat.approve': {
        actors: ['person'],
        input: { chatId: 'chat-1', requestId: 'request-1', decision: 'deny', message: 'Not on main' },
        refused: {
            'a decision it has not': { chatId: 'chat-1', requestId: 'request-1', decision: 'maybe', message: null },
            'no message at all': { chatId: 'chat-1', requestId: 'request-1', decision: 'allow' }
        }
    },
    'terminal.stop': {
        actors: ['person', 'voice'],
        input: { terminalId: 'term-1' },
        refused: { 'an empty terminal': { terminalId: '' } },
        confirms: true
    },
    'terminal.resumeAgent': {
        actors: ['person', 'voice'],
        input: { terminalId: 'term-1' },
        refused: { 'no terminal': {} }
    },
    'terminal.restart': {
        actors: ['person', 'voice'],
        input: { terminalId: 'term-1' },
        refused: { 'no terminal': {} }
    }
};
