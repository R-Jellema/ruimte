import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MonitorDown } from 'lucide-react';
import type { Artifact, ArtifactVersion } from '@ruimte/contracts';
import { Button, Icon, Spinner, Tooltip } from '@adecore/ui';
import { useLinkedMachines } from '@/output/linked-machines';
import { openArtifact } from '@/output/open';
import { useEndpoints } from '@/state/endpoints';
import { useEndpointId } from '@/state/keys';
import { useProject } from '@/state/project';
import { useToasts } from '@/state/toasts';
import { machineTransport } from '@/transport';
import { useMachineAnswers } from '@/transport/features';
import { TransportError } from '@/transport/transport';

const FAILURES: Readonly<Record<string, string>> = {
    'machine-unreachable': 'copyHere.unreachable',
    'not-linked': 'copyHere.unlinked',
    'not-found': 'copyHere.gone',
    'hash-mismatch': 'copyHere.mismatch',
    'bad-reply': 'copyHere.mismatch',
    'disk-full': 'copyHere.diskFull',
    'too-large': 'copyHere.tooLarge'
};

/*
 * Copies a version another machine keeps into Output of the window's project on the window's machine.
 * Only offered where that works: the window's machine copies, and it does so over the link its project
 * has to the other machine's project, so an artifact of any other project there is not offered.
 */
export function CopyToThisMachine({ machineId, artifact, version }: { machineId: string; artifact: Artifact; version: ArtifactVersion }) {
    const { t } = useTranslation('output');
    const endpointId = useEndpointId();
    const answers = useMachineAnswers(endpointId, 'artifact.importFrom');
    const project = useProject((s) => s.current);
    const links = useLinkedMachines();
    const link = links.find((candidate) => candidate.machineId === machineId && candidate.remoteProjectId === artifact.projectId);
    const machine = useEndpoints((s) => s.endpoints.find((entry) => entry.id === machineId || entry.daemonId === machineId)?.label) ?? link?.label ?? '';
    const [copying, setCopying] = useState(false);
    if (!answers || project === null || link === undefined) {
        return null;
    }

    const copy = (): void => {
        setCopying(true);
        machineTransport(endpointId)
            .request('artifact.importFrom', { machineId, artifactId: artifact.artifactId, versionId: version.versionId, projectId: project.projectId })
            .then(({ artifactId }) => {
                useToasts.getState().show({ kind: 'success', title: t('copyHere.copied'), description: t('copyHere.copiedDetail', { project: project.name }) });
                openArtifact(artifactId, artifact.title);
            })
            .catch((failure: unknown) => {
                const code = failure instanceof TransportError ? failure.code : '';
                useToasts.getState().show({ kind: 'error', title: t('copyHere.failed'), description: t(FAILURES[code] ?? 'copyHere.other', { machine }) });
            })
            .finally(() => setCopying(false));
    };

    return (
        <Tooltip label={t('copyHere.tip', { project: project.name })}>
            <Button size="sm" aria-disabled={copying} onClick={() => !copying && copy()}>
                {copying ? <Spinner size={14} /> : <Icon icon={MonitorDown} size={14} />}
                {copying ? t('copyHere.copying') : t('copyHere.action')}
            </Button>
        </Tooltip>
    );
}
