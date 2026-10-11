import { describe, expect, test } from 'bun:test';
import { EndpointChangedEventSchema, REQUEST_SCHEMAS, type AgentIntegrationsSummary } from './index.ts';

describe('agent integrations on the wire', () => {
    test('an endpoint event without the summary still parses, and one with it keeps it', () => {
        const base = { id: 'm1', label: 'Mac', nameSource: 'default', icon: null };
        const summary: AgentIntegrationsSummary = { providers: [{ provider: 'claude', state: 'unset', reviewed: false }], fixed: false };

        expect(EndpointChangedEventSchema.parse(base).agentIntegrations).toBeUndefined();
        expect(EndpointChangedEventSchema.parse({ ...base, agentIntegrations: summary }).agentIntegrations).toEqual(summary);
    });

    test('the switch request names a provider and a direction', () => {
        const schema = REQUEST_SCHEMAS['endpoint.setAgentIntegration'].payload;

        expect(schema.safeParse({ provider: 'codex', on: true }).success).toBe(true);
        expect(schema.safeParse({ provider: 'codex' }).success).toBe(false);
    });
});
