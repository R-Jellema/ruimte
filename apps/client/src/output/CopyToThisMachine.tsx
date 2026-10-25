import { useTranslation } from 'react-i18next';
import { MonitorDown } from 'lucide-react';
import type { Artifact, ArtifactVersion } from '@ruimte/contracts';
import { Tooltip } from '@adecore/ui';
import { useCopyToThisMachine } from '@/output/artifact-actions';
import { ActionRow } from '@/output/look';

/* Copy to this machine as a row of an artifact view's actions, only where the copy works. */
export function CopyToThisMachine({ machineId, artifact, version }: { machineId: string; artifact: Artifact; version: ArtifactVersion }) {
    const { t } = useTranslation('output');
    const machineCopy = useCopyToThisMachine(machineId, artifact);
    if (machineCopy === null) {
        return null;
    }
    const { copying, tip, copy } = machineCopy;
    return (
        <Tooltip label={tip}>
            <ActionRow icon={MonitorDown} busy={copying} aria-disabled={copying} onClick={() => !copying && copy(version)}>
                {copying ? t('copyHere.copying') : t('copyHere.action')}
            </ActionRow>
        </Tooltip>
    );
}
