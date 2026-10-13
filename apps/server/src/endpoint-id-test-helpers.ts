import type { EndpointIdentity } from './endpoint-id.ts';

/* Lends a machine identity what the daemon would, as a test of the identity and its handlers alone has it: no rule, no consent, no broker and a closed door. */
export function lendNothing(identity: EndpointIdentity): EndpointIdentity {
    identity.attachClosedLid({ describe: () => ({ keepAwakeLidRule: false }) });
    identity.attachAgentIntegrations({ describe: () => ({ agentIntegrations: { providers: [], fixed: false } }) });
    identity.attachBroker({ apply: async () => undefined, describe: () => ({ brokerUrl: null, brokerFixed: false }) });
    identity.attachLanDoor({ apply: () => undefined, describe: () => ({ lan: null, lanDoorFixed: false }) });
    return identity;
}

/* The fields of `endpoint.changed` that `lendNothing` makes an identity announce. */
export const LENT_NOTHING = {
    keepAwakeLidRule: false,
    agentIntegrations: { providers: [], fixed: false },
    brokerUrl: null,
    brokerFixed: false,
    lan: null,
    lanDoorFixed: false
} as const;
