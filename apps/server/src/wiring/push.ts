import { join } from 'node:path';
import type { AuthStore } from '../auth/auth-store.ts';
import type { EndpointIdentity } from '../endpoint-id.ts';
import { errorText } from '../error-text.ts';
import type { ProjectStore } from '../projects/project-store.ts';
import { PushService } from '../push/service.ts';
import type { SnoozeStore } from '../push/snoozes.ts';
import type { AgentsBundle } from './agents.ts';

/* The notifications and live activities that tell a person's phone an agent needs them. */
export function wirePush(
    home: string,
    auth: AuthStore,
    identity: EndpointIdentity,
    agents: AgentsBundle,
    projects: ProjectStore,
    snoozes: SnoozeStore
): PushService {
    const { sessions, chats } = agents;
    return new PushService({
        auth,
        attentionPath: join(home, 'push-attention.json'),
        identity,
        titleFor: (nodeId) => projects.index.titleFor(nodeId),
        projectOf: (nodeId) => projects.index.locate(nodeId)?.projectId ?? null,
        targetOf: (nodeId) => (chats.get(nodeId) ? 'chat' : 'terminal'),
        machineName: () => identity.label,
        activityNodes: () => [
            ...sessions.list().flatMap((session) =>
                !session.exited && session.agent
                    ? [
                          {
                              nodeId: session.sessionId,
                              target: 'terminal' as const,
                              title: session.agent.suggestedTitle ?? 'Terminal agent',
                              status: session.agent.status
                          }
                      ]
                    : []
            ),
            ...chats.list().map((chat) => ({ nodeId: chat.chatId, target: 'chat' as const, title: chat.suggestedTitle ?? 'AI chat', status: chat.status }))
        ],
        onError: (error) => console.error('Push delivery failed:', errorText(error)),
        snoozes
    });
}
