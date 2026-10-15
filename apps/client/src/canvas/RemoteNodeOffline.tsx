import { useTranslation } from 'react-i18next';
import { MachineGlyph } from '@/endpoint/MachineGlyph';
import { describeLastSeen } from '@/shell/connection-info';
import { StatusCard } from '@/shell/ProjectSwitchScreen';
import { useMachineEntry } from '@/shell/use-machine-entry';
import { useMachineIcon } from '@/shell/settings/machine-icon';
import { nameOf } from '@/shell/settings/machine-list';
import { pool } from '@/transport';
import { useLastSeenAt } from '@/transport/status';
import type { RemoteNodeState } from '@/canvas/remote-node-state';
import { Button, useNow } from '@adecore/ui';

const MINUTE_MS = 60_000;

/*
 * The body of a node whose machine is not there: which machine, when it last answered, and what
 * can be done. It is the card the whole window shows when its own machine is lost, for one node
 * (`shell/MachineLostScreen.tsx`); the other nodes of the canvas keep working.
 */
export function RemoteNodeOffline({ machine, state, onLinkAgain }: { machine: string; state: Exclude<RemoteNodeState, 'ready'>; onLinkAgain(): void }) {
    const { t } = useTranslation(['canvas', 'common']);
    const entry = useMachineEntry(machine);
    const icon = useMachineIcon(entry);
    const lastSeen = useLastSeenAt(machine);
    const now = useNow(MINUTE_MS);
    const name = nameOf(entry);
    const seen = state === 'connecting' || state === 'offline' ? describeLastSeen(lastSeen, now) : null;
    const connecting = state === 'connecting';
    return (
        <div className="grid h-full place-items-center bg-surface" role="status" aria-live="polite">
            <StatusCard
                glyph={<MachineGlyph icon={icon} size={24} className="text-text-faint" />}
                title={name}
                meta={seen && <span className="text-xs text-text-muted">{seen}</span>}
                line={t(`remote.${state === 'too-old' ? 'tooOld' : state === 'connecting' ? 'retrying' : state}`, { machine: name })}
                failed={!connecting}
            >
                {(state === 'connecting' || state === 'offline') && (
                    <Button size="sm" variant="primary" disabled={connecting} onClick={() => pool.reconnect(machine)}>
                        {t('common:action.retry')}
                    </Button>
                )}
                {state === 'unlinked' && (
                    <Button size="sm" variant="secondary" onClick={onLinkAgain}>
                        {t('remote.linkAgain')}
                    </Button>
                )}
            </StatusCard>
        </div>
    );
}
