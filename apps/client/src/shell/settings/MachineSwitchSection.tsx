import { useTranslation } from 'react-i18next';
import { SettingsRow } from '@adecore/ui/settings';
import { Switch } from '@adecore/ui';
import { MACHINE_SWITCHES, type MachineSwitch } from '@/shell/settings/machine-switches';
import { useMachineSetting } from '@/shell/settings/machine-setting';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { LOCAL_ENDPOINT_ID, useEndpoints, type Endpoint } from '@/state/endpoints';
import { listedEndpoints } from '@/state/local-machine';
import { useServers } from '@/state/server';
import { useEndpointConnection } from '@/transport/status';

// The i18n group under `agents` each switch reads its words from.
const WORDS: Record<MachineSwitch, string> = { agentsDeleteAnyView: 'deleteAnyView', resumeAtReset: 'resumeAtReset', visualReplies: 'visualReplies' };

function MachineSwitchRow({ endpoint, setting, searchId }: { endpoint: Endpoint; setting: MachineSwitch; searchId?: string }) {
    const { t } = useTranslation('settings');
    const info = useServers((s) => s.byEndpoint[endpoint.id]);
    const connection = useEndpointConnection(endpoint.id);
    const connected = connection.status === 'open';
    const { busy, save } = useMachineSetting(endpoint);
    const words = `agents.${WORDS[setting]}`;

    return (
        <SettingsRow
            searchId={searchId}
            label={t(`${words}.label`)}
            description={connected ? t(`${words}.description`) : connection.noLink === true ? t(`${words}.notConnected`) : t('machine.notAnswering')}
            control={
                <Switch
                    checked={info?.[setting] === true}
                    onCheckedChange={(checked) => void save({ [setting]: checked })}
                    // The section names the machine, a screen reader reading the switch alone does not.
                    label={t(`${words}.rowLabel`, { machine: endpoint.label })}
                    disabled={busy || !connected}
                />
            }
        />
    );
}

/*
 * One section per machine for what its agents may do, under the settings about agents rather than in
 * the Account pane. That pane is about reaching a machine and whether it answers; this is about an agent.
 */
export function MachineSwitchSections() {
    const { t } = useTranslation('settings');
    const stored = useEndpoints((s) => s.endpoints);
    const endpoints = listedEndpoints(stored);

    // This machine first, which is the one a person with a single machine is looking at.
    const ordered = [
        ...endpoints.filter((endpoint) => endpoint.id === LOCAL_ENDPOINT_ID),
        ...endpoints.filter((endpoint) => endpoint.id !== LOCAL_ENDPOINT_ID)
    ];

    return (
        <>
            {ordered.map((endpoint) => (
                <SettingsSection
                    key={endpoint.id}
                    title={t('agents.machine.title', { machine: endpoint.label })}
                    description={t('agents.machine.description')}
                    scope="machine"
                >
                    {MACHINE_SWITCHES.map((setting) => (
                        <MachineSwitchRow
                            key={setting}
                            endpoint={endpoint}
                            setting={setting}
                            searchId={ordered[0]?.id === endpoint.id ? `agents.${WORDS[setting]}` : undefined}
                        />
                    ))}
                </SettingsSection>
            ))}
        </>
    );
}
