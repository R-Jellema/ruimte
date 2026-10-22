import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { desktop, type BackgroundServiceState } from '@/desktop/bridge';
import { leaveWorkspace, showStart } from '@/transport/connections';
import { useProjectSwitch } from '@/project/open';
import { MachineCard } from '@/shell/MachineCard';
import { machineLost, offersMachineRestart } from '@/shell/machine-lost';
import { useMachineEntry } from '@/shell/use-machine-entry';
import { nameOf } from '@/shell/settings/machine-list';
import { useEndpointId } from '@/state/keys';
import { pool } from '@/transport';
import { useEndpointConnection } from '@/transport/status';
import { Button } from '@adecore/ui';
import { ConfirmDialog } from '@adecore/ui/settings';

/*
 * Stands over the cells while the machine of the open project does not answer. Nothing of the
 * workspace goes: the nodes keep their sessions and threads, and the screen goes the moment the link
 * is back. Opening another project is a choice a person makes here, never something that happens.
 */
export function MachineLostScreen() {
    const { t } = useTranslation(['shell', 'common', 'settings']);
    const endpointId = useEndpointId();
    const connection = useEndpointConnection(endpointId);
    const switching = useProjectSwitch((s) => s.kind !== 'idle');
    const entry = useMachineEntry(endpointId);
    const [confirming, setConfirming] = useState(false);
    const service = desktop()?.backgroundService ?? null;
    const [serviceState, setServiceState] = useState<BackgroundServiceState | null>(null);

    useEffect(() => {
        if (!service) {
            return;
        }
        let live = true;
        void service.state().then((next) => {
            if (live) {
                setServiceState(next);
            }
        });
        const off = service.onState(setServiceState);
        return () => {
            live = false;
            off();
        };
    }, [service]);

    // A switch has a screen of its own, which says more about the same wait.
    if (switching || !machineLost(connection)) {
        return null;
    }
    const retrying = connection.status === 'connecting';
    const machine = nameOf(entry);
    return (
        <div className="absolute inset-0 z-10 grid place-items-center bg-surface" role="status" aria-live="polite">
            <MachineCard
                machine={endpointId}
                line={retrying ? t('machineLost.retrying', { machine }) : (connection.failure ?? t('machineLost.silent', { machine }))}
                failed={!retrying}
            >
                <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                        void leaveWorkspace().then(showStart);
                    }}
                >
                    {t('machineLost.openAnother')}
                </Button>
                <Button size="sm" variant="primary" disabled={retrying} onClick={() => pool.reconnect(endpointId)}>
                    {t('common:action.retry')}
                </Button>
                {offersMachineRestart(endpointId, connection, service, serviceState) && (
                    <Button size="sm" variant="secondary" onClick={() => setConfirming(true)}>
                        {t('machineLost.restart')}
                    </Button>
                )}
                <ConfirmDialog
                    open={confirming}
                    onOpenChange={setConfirming}
                    title={t('settings:backgroundService.confirmRestart.title')}
                    description={t('settings:backgroundService.confirmRestart.description')}
                    confirmLabel={t('settings:backgroundService.confirmRestart.action')}
                    onConfirm={async () => {
                        const next = await service?.restartNow?.();
                        if (next?.failure) {
                            throw new Error(next.failure);
                        }
                    }}
                />
            </MachineCard>
        </div>
    );
}
