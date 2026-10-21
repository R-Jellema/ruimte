import { useTranslation } from 'react-i18next';
import type { ProviderInfo } from '@ruimte/contracts';
import { ChatHostProvider, type ChatHost } from '@adecore/agents-react';
import { ProvidersPane as Pane } from '@adecore/agents-react/providers';
import { canRunProviderCommand, runProviderCommand } from '@/chat/provider-command';
import { AcpServerSection, AcpServerStepBody } from '@/shell/settings/providers/AcpServerSection';
import { useAcpServer } from '@/shell/settings/providers/use-acp-server';
import { AppleFoundationSection } from '@/shell/settings/providers/AppleFoundationSection';
import { useEndpointId } from '@/state/keys';
import { useProject } from '@/state/project';
import { useUi } from '@/state/ui';
import { useDetectProviders } from '@/transport/provider-detection';

// Here and not in the app's chat host: a command is typed into a terminal of the open project, which the start screen has none of.
const RUNS_COMMANDS: Partial<ChatHost> = { runProviderCommand: (endpointId, _kind, command) => void runProviderCommand(endpointId, command) };
const COPIES_COMMANDS: Partial<ChatHost> = {};

/* The providers of the machine in scope, with the model that machine runs on its own drawn by Ruimte. */
export function ProvidersPane() {
    const { t } = useTranslation('settings');
    const endpointId = useEndpointId();
    const target = useUi((s) => s.settings.target);
    const runs = useProject((s) => canRunProviderCommand(s, endpointId));
    const antigravity = useAcpServer(endpointId, 'antigravity');
    useDetectProviders();
    const detailOf = (provider: ProviderInfo) => {
        if (provider.kind === 'apple') {
            return <AppleFoundationSection endpointId={endpointId} provider={provider} />;
        }
        if (provider.kind !== 'antigravity') {
            return null;
        }
        return antigravity.server === null ? null : <AcpServerSection provider={provider} acp={antigravity} server={antigravity.server} />;
    };
    // The server is the step after the CLI; none while the machine has not said where it stands.
    const installStepOf = (provider: ProviderInfo) =>
        provider.kind !== 'antigravity' || antigravity.server === null
            ? null
            : {
                  title: t('providers.acpServer.step'),
                  done: antigravity.server.state === 'installed',
                  body: <AcpServerStepBody acp={antigravity} server={antigravity.server} />
              };
    return (
        <ChatHostProvider key={runs ? 'runs' : 'copies'} host={runs ? RUNS_COMMANDS : COPIES_COMMANDS}>
            <Pane target={target} detailOf={detailOf} installStepOf={installStepOf} />
        </ChatHostProvider>
    );
}
