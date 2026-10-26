import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { perform } from '@/actions/client-actions';
import type { ChatSendExtras } from '@adecore/agents-react/chat';
import { Composer, Timeline } from '@adecore/agents-react/chat/ui';
import { useChatRow } from '@adecore/agents-react/state';
import { LazyBoundary, messageOf } from '@adecore/ui';
import { NodeNotice } from '@/nodes/NodeNotice';
import { OutputChatContext } from '@/output/chat-scope';
import { useEndpointId } from '@/state/keys';
import { chatClientFor } from '@/transport/connections';
import { useTransportStatus } from '@/transport/status';

/*
 * The chat of one run, drawn the way a chat view draws one. A run's chat is a hidden chat of the
 * project, so this only observes it: it never opens one, and a person still answers its questions here.
 */
// A run keeps the agent its routine names, so the composer never offers another one to switch to.
function keepProvider(): Promise<void> {
    return Promise.resolve();
}

export function RoutineRunChat({ chatId }: { chatId: string }) {
    const { t } = useTranslation('canvas');
    const endpointId = useEndpointId();
    const info = useChatRow(chatId, (row) => row?.info);
    const status = useTransportStatus();
    const [failure, setFailure] = useState<string | null>(null);

    useEffect(() => chatClientFor(endpointId)?.observe(chatId), [endpointId, chatId]);

    const send = async (text: string, extras: ChatSendExtras): Promise<boolean> => {
        try {
            await perform('chat.send', { chatId, prompt: text, ...extras });
            return true;
        } catch (e) {
            setFailure(messageOf(e, t('chat.sendFailed')));
            return false;
        }
    };

    return (
        <div className="chat-column relative flex min-h-0 grow flex-col bg-surface">
            {status !== 'open' && <NodeNotice>{status === 'closed' ? t('notice.reconnecting') : t('notice.connecting')}</NodeNotice>}
            {failure !== null && (
                <NodeNotice tone="error" onRetry={() => setFailure(null)}>
                    {failure}
                </NodeNotice>
            )}
            <OutputChatContext value={chatId}>
                <LazyBoundary fallback={<div className="grow" />}>
                    <Timeline
                        chatId={chatId}
                        composer={
                            info && (
                                <Composer
                                    chatId={chatId}
                                    info={info}
                                    focused={false}
                                    disabled={status !== 'open'}
                                    providerFixed
                                    onSend={send}
                                    onRetarget={keepProvider}
                                />
                            )
                        }
                    />
                </LazyBoundary>
            </OutputChatContext>
        </div>
    );
}
