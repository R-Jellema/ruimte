import { describe, expect, test } from 'bun:test';
import { agentProvenance } from './artifact-provenance.ts';

const CHAT = { provider: 'claude', model: 'claude-opus-5-5', selection: { model: 'opus' }, activeTurnId: 'turn-3' };

describe('the provenance of a version an agent publishes', () => {
    test('names the CLI and the model the caller chat ran, from its record', () => {
        expect(agentProvenance({ machineId: 'mac', caller: 'chat-1', chat: CHAT, isChat: true, taskId: 'task-2' })).toEqual({
            maker: 'agent',
            machineId: 'mac',
            nodeId: 'chat-1',
            chatId: 'chat-1',
            turnId: 'turn-3',
            taskId: 'task-2',
            agent: 'claude',
            model: 'claude-opus-5-5'
        });
    });

    test('takes the model picked while the CLI has not reported one', () => {
        expect(agentProvenance({ machineId: 'mac', caller: 'chat-1', chat: { ...CHAT, model: null }, isChat: true }).model).toBe('opus');
    });

    test('names neither for a caller with no running chat', () => {
        const provenance = agentProvenance({ machineId: 'mac', caller: 'term-1', isChat: false });
        expect(provenance).toEqual({ maker: 'agent', machineId: 'mac', nodeId: 'term-1' });
    });
});
