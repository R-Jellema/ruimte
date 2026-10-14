import { useState } from 'react';
import { Laptop } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, Icon } from '@adecore/ui';
import { DetailHeader, SettingsRow } from '@adecore/ui/settings';
import { SetUpMachineDialog } from '@/shell/settings/SetUpMachineDialog';
import { SettingsSection } from '@/shell/settings/SettingsSection';

/*
 * What a desktop app without a machine of its own offers for this computer. It never connects by
 * itself: the person sets one up, or picks the one that already runs here, and the app restarts.
 */
export function ThisComputerDetail({ found }: { found: boolean }) {
    const { t } = useTranslation('settings');
    const [confirming, setConfirming] = useState(false);
    const key = found ? 'use' : 'setUp';
    return (
        <>
            <DetailHeader
                mark={
                    <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-surface-hover">
                        <Icon icon={Laptop} size={20} className="text-text-muted" />
                    </span>
                }
                title={t('machines.thisComputer.row')}
                subtitle={t('machines.thisComputer.subtitle')}
            />
            <SettingsSection>
                <SettingsRow
                    searchId="machines.thisComputer"
                    label={t(`machines.thisComputer.${key}.label`)}
                    description={t(`machines.thisComputer.${key}.description`)}
                    control={
                        <Button variant="secondary" onClick={() => setConfirming(true)}>
                            {t(`machines.thisComputer.${key}.action`)}
                        </Button>
                    }
                />
            </SettingsSection>
            <SetUpMachineDialog open={confirming} onOpenChange={setConfirming} />
        </>
    );
}
