import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Server } from 'lucide-react';
import type { DeviceInfo, ProjectNode } from '@ruimte/contracts';
import { rememberChatSelection } from '@adecore/agents-react/chat';
import { deleteNodesAction } from '@/actions/client-actions';
import { MachineGlyph } from '@/endpoint/MachineGlyph';
import { createRemoteNode } from '@/project/remote-node';
import type { RemoteCandidate } from '@/project/remote-candidates';
import { describeLastSeen } from '@/shell/connection-info';
import { RemoteFolderPicker } from '@/shell/RemoteFolderPicker';
import { useRemoteCheckouts, useRemoteDevices } from '@/shell/use-remote-checkouts';
import { useWorktreeStart } from '@/shell/use-worktree-start';
import { WorktreeStartFields } from '@/shell/WorktreeStartFields';
import { useMachineEntry } from '@/shell/use-machine-entry';
import { useMachineIcon } from '@/shell/settings/machine-icon';
import { machineIdOf, nameOf } from '@/shell/settings/machine-list';
import { defaultCanvases } from '@/state/canvas';
import { endpointById, endpointIdOfMachine, useEndpoints } from '@/state/endpoints';
import { useProject } from '@/state/project';
import { useUi, type RemoteNodeRequest } from '@/state/ui';
import { remoteMirror, useWorkspace } from '@/transport/connections';
import { NodeMachineScope } from '@/transport/node-machine';
import { transportFor } from '@/transport';
import { useLastSeenAt } from '@/transport/status';
import { Button, Dialog, ErrorBoundary, FieldHint, FormError, Icon, Select, Skeleton, Switch, messageOf, useNow } from '@adecore/ui';

type Kind = RemoteNodeRequest['kind'];

const KINDS: readonly Kind[] = ['chat', 'terminal', 'device'];
const MINUTE_MS = 60_000;

/*
 * A node of a canvas that works in a checkout on another machine, or that machine linked to this
 * project again after it stopped. The node is made last: the machine is linked, the project saved
 * with the node, and only then does the other machine hear of it.
 */
export function RemoteNodeDialog() {
    const request = useUi((s) => s.remoteNodeDialog);
    const close = (): void => useUi.getState().setRemoteNodeDialog(null);
    return (
        <Dialog.Root
            open={request !== null}
            onOpenChange={(open) => {
                if (!open) {
                    close();
                }
            }}
        >
            <Dialog.Popup size="sm">
                {request !== null && <RemoteNodeBody key={`${request.machineId}:${request.viewId}:${request.relink}`} request={request} onDone={close} />}
            </Dialog.Popup>
        </Dialog.Root>
    );
}

function RemoteNodeBody({ request, onDone }: { request: RemoteNodeRequest; onDone(): void }) {
    const { t } = useTranslation(['shell', 'canvas']);
    const entry = useMachineEntry(endpointIdOfMachine(request.machineId));
    const icon = useMachineIcon(entry);
    const machine = nameOf(entry);
    const [kind, setKind] = useState<Kind>(request.kind);
    // The scope needs the row, which asking for the machine makes; until then nothing under it reads another machine.
    const row = useEndpoints((state) => state.endpoints.some((candidate) => candidate.id === endpointIdOfMachine(request.machineId)));
    return (
        <>
            <Dialog.Title className="flex items-center gap-2">
                <MachineGlyph icon={icon} size={16} />
                {request.relink
                    ? t('remoteNode.relinkTitle', { machine })
                    : t('remoteNode.title', { kind: t(`shell:nodeKinds.${kind}`).toLowerCase(), machine })}
            </Dialog.Title>
            <ErrorBoundary label={t('remoteNode.failedToRender')} resetKeys={[request.machineId]}>
                <NodeMachineScope key={row ? 'row' : 'pending'} machine={request.machineId}>
                    <RemoteNodeForm request={request} machine={machine} kind={kind} onKind={setKind} onDone={onDone} />
                </NodeMachineScope>
            </ErrorBoundary>
        </>
    );
}

function RemoteNodeForm({
    request,
    machine,
    kind,
    onKind,
    onDone
}: {
    request: RemoteNodeRequest;
    machine: string;
    kind: Kind;
    onKind(kind: Kind): void;
    onDone(): void;
}) {
    const { t } = useTranslation(['shell', 'common']);
    const workspace = useWorkspace();
    const project = useProject((s) => s.current);
    const here = workspace?.connection.transport ?? null;
    const machineEndpointId = endpointIdOfMachine(request.machineId);
    const lastSeen = useLastSeenAt(machineEndpointId);
    const now = useNow(MINUTE_MS);
    const { checkouts, retry } = useRemoteCheckouts(request.machineId, project?.projectId ?? null, project?.folder ?? null, here);
    const [picked, setPicked] = useState<string | null>(null);
    const [chosen, setChosen] = useState<RemoteCandidate[]>([]);
    const [browsing, setBrowsing] = useState(false);
    const [opening, setOpening] = useState(false);
    const [inWorktree, setInWorktree] = useState(false);
    const [deviceKey, setDeviceKey] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState<string | null>(null);
    const { devices, failed: devicesFailed } = useRemoteDevices(request.machineId, kind === 'device' && !request.relink);

    const candidates =
        checkouts.state === 'ready'
            ? [...checkouts.candidates, ...chosen.filter((own) => !checkouts.candidates.some((known) => known.folder === own.folder))]
            : [];
    const candidate = candidates.find((entry) => entry.projectId === picked) ?? candidates[0] ?? null;
    const scoped = useMemo(() => endpointById(machineEndpointId) !== null, [machineEndpointId]);
    const start = useWorktreeStart(inWorktree && scoped && candidate !== null ? candidate.folder : null);
    const device =
        devices?.find((entry) => `${entry.backendId}:${entry.deviceId}` === (deviceKey ?? `${devices[0]?.backendId}:${devices[0]?.deviceId}`)) ?? null;
    const needsDevice = kind === 'device' && !request.relink;
    const ready = candidate !== null && !busy && (!inWorktree || (start !== null && start.ready)) && (!needsDevice || device !== null);

    const open = async (folder: string): Promise<void> => {
        setOpening(true);
        setFailure(null);
        try {
            const opened = await transportFor(machineEndpointId)!.request('project.open', { folder });
            // Looking at a folder does not keep its project open there.
            void transportFor(machineEndpointId)!
                .request('project.release', { projectId: opened.summary.projectId })
                .catch(() => undefined);
            const next: RemoteCandidate = {
                projectId: opened.summary.projectId,
                name: opened.summary.name,
                folder: opened.summary.folder,
                same: false,
                branch: null
            };
            setChosen((before) => [...before.filter((entry) => entry.folder !== next.folder), next]);
            setPicked(next.projectId);
            setBrowsing(false);
        } catch (e) {
            setFailure(messageOf(e, t('remoteNode.folders.failed', { machine })));
        } finally {
            setOpening(false);
        }
    };

    const submit = async (): Promise<void> => {
        if (!ready || candidate === null || checkouts.state !== 'ready' || project === null || workspace === null) {
            return;
        }
        const there = transportFor(machineEndpointId)!;
        const self = endpointById(workspace.connection.endpointId);
        const selfId = self === null ? workspace.connection.endpointId : machineIdOf(self);
        const link = {
            projectId: project.projectId,
            machineId: request.machineId,
            remoteProjectId: candidate.projectId,
            label: machine,
            rootCommit: checkouts.here?.rootCommits[0] ?? ''
        };
        setBusy(true);
        setFailure(null);
        try {
            if (request.relink) {
                await there.request('peer.bind', { machineId: selfId, label: self?.label ?? selfId, projectId: candidate.projectId });
                await workspace.connection.transport.request('remote.link', link);
                remoteMirror()?.resend(request.machineId);
                onDone();
                return;
            }
            const canvas = request.viewId === null ? null : defaultCanvases.peek(request.viewId);
            await createRemoteNode({
                linked: checkouts.links.some((known) => known.machineId === request.machineId && known.remoteProjectId === candidate.projectId),
                bindThere: async () => {
                    await there.request('peer.bind', { machineId: selfId, label: self?.label ?? selfId, projectId: candidate.projectId });
                },
                linkHere: async () => {
                    await workspace.connection.transport.request('remote.link', link);
                },
                makeWorktree: async () => {
                    if (!inWorktree || start === null) {
                        return null;
                    }
                    const { worktree } = await there.request('git.worktree-add', {
                        repo: candidate.folder,
                        branch: start.branch.trim(),
                        projectId: candidate.projectId,
                        ...(start.reuses ? {} : { base: start.base.trim() })
                    });
                    return worktree.path;
                },
                addNode: (cwd) => {
                    if (canvas === null) {
                        return null;
                    }
                    if (start !== null && start.provider !== null && start.selection !== null && kind === 'chat') {
                        rememberChatSelection(start.provider, start.selection);
                    }
                    return canvas.getState().addNode(kind, request.at ?? { x: 0, y: 0 }, {
                        machine: request.machineId,
                        cwd: cwd ?? candidate.folder,
                        ...(kind === 'chat' ? { provider: start?.provider ?? 'claude', providerFixed: true } : {}),
                        ...(kind === 'device' && device !== null ? { device: deviceReference(device) } : {})
                    });
                },
                removeNode: (nodeId) => {
                    if (canvas !== null) {
                        deleteNodesAction(canvas, [nodeId]);
                    }
                },
                save: () => workspace.connection.projects.flush(),
                holdMirror: () => remoteMirror()?.hold() ?? ((): void => undefined)
            });
            onDone();
        } catch (e) {
            setFailure(messageOf(e, t('remoteNode.failed')));
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            <Dialog.Text className="mt-1">
                {request.relink
                    ? t('remoteNode.relinkIntro', { machine })
                    : t(kind === 'chat' ? 'remoteNode.intro' : 'remoteNode.introOther', { kind: t(`shell:nodeKinds.${kind}`).toLowerCase(), machine })}
            </Dialog.Text>
            {!request.relink && (
                <div className="mt-3 flex items-center justify-between gap-3">
                    <span className="text-xs text-text-muted">{t('remoteNode.kind')}</span>
                    <Select<Kind>
                        label={t('remoteNode.kind')}
                        variant="outlined"
                        value={kind}
                        onValueChange={onKind}
                        items={KINDS.map((value) => ({ value, label: t(`shell:nodeKinds.${value}`) }))}
                    />
                </div>
            )}
            <div className="mt-3 text-xs text-text-muted">{t('remoteNode.checkout')}</div>
            {browsing ? (
                <RemoteFolderPicker endpointId={machineEndpointId} machine={machine} onPick={(folder) => void open(folder)} onBack={() => setBrowsing(false)} />
            ) : (
                <CheckoutField
                    checkouts={checkouts}
                    candidates={candidates}
                    candidate={candidate}
                    machine={machine}
                    seen={describeLastSeen(lastSeen, now)}
                    opening={opening}
                    onPick={setPicked}
                    onChoose={() => setBrowsing(true)}
                    onRetry={retry}
                />
            )}
            {!request.relink && candidate !== null && !browsing && (
                <>
                    {kind === 'device' && <DeviceField machine={machine} devices={devices} failed={devicesFailed} value={device} onPick={setDeviceKey} />}
                    <div className="mt-3 flex items-center justify-between gap-3">
                        <span className="text-xs text-text-muted">{t('remoteNode.startFrom')}</span>
                        <Select<'machine'>
                            label={t('remoteNode.startFrom')}
                            variant="outlined"
                            value="machine"
                            onValueChange={() => undefined}
                            items={[{ value: 'machine', label: t('remoteNode.asItIs', { machine }) }]}
                        />
                    </div>
                    {kind !== 'device' && (
                        <>
                            <div className="mt-3 flex items-center justify-between gap-3">
                                <span className="text-sm text-text">{t('remoteNode.worktree', { machine })}</span>
                                <Switch label={t('remoteNode.worktree', { machine })} checked={inWorktree} onCheckedChange={setInWorktree} />
                            </div>
                            {inWorktree && start !== null && <WorktreeStartFields start={start} idPrefix="remote-node" onSubmit={() => void submit()} />}
                        </>
                    )}
                </>
            )}
            {failure && <FormError className="mt-2">{failure}</FormError>}
            <Dialog.Footer>
                <Button onClick={onDone}>{t('common:action.cancel')}</Button>
                <Button variant="primary" disabled={!ready || browsing} onClick={() => void submit()}>
                    {request.relink ? (busy ? t('remoteNode.linking') : t('remoteNode.link')) : busy ? t('remoteNode.creating') : t('remoteNode.create')}
                </Button>
            </Dialog.Footer>
        </>
    );
}

function deviceReference(device: DeviceInfo): NonNullable<ProjectNode['device']> {
    return { platform: device.platform, kind: device.kind, name: device.name, runtime: device.runtime };
}

interface CheckoutFieldProps {
    checkouts: ReturnType<typeof useRemoteCheckouts>['checkouts'];
    candidates: RemoteCandidate[];
    candidate: RemoteCandidate | null;
    machine: string;
    seen: string | null;
    opening: boolean;
    onPick(projectId: string): void;
    onChoose(): void;
    onRetry(): void;
}

/* The four states of the checkout: looking, found, none, and a machine that does not answer. */
function CheckoutField({ checkouts, candidates, candidate, machine, seen, opening, onPick, onChoose, onRetry }: CheckoutFieldProps) {
    const { t } = useTranslation('shell');
    if (checkouts.state === 'loading') {
        return (
            <div className="mt-1 flex flex-col gap-2" role="status">
                <Skeleton className="w-3/4" />
                <span className="text-sm text-text-muted">{t('remoteNode.looking', { machine })}</span>
            </div>
        );
    }
    if (checkouts.state === 'error') {
        return (
            <div className="mt-1 flex flex-col gap-2">
                <FormError>{t('remoteNode.unreachable', { machine })}</FormError>
                {seen !== null && <span className="text-xs text-text-muted">{seen}</span>}
                <div>
                    <Button size="sm" variant="secondary" onClick={onRetry}>
                        {t('remoteNode.retry')}
                    </Button>
                </div>
            </div>
        );
    }
    if (candidate === null) {
        return (
            <div className="mt-1 flex flex-col gap-2">
                <span className="text-sm text-text-muted">{t('remoteNode.none')}</span>
                <div>
                    <Button size="sm" variant="secondary" disabled={opening} onClick={onChoose}>
                        {opening ? t('remoteNode.folders.opening') : t('remoteNode.choose')}
                    </Button>
                </div>
            </div>
        );
    }
    return (
        <div className="mt-1 flex flex-col gap-1">
            {candidates.length > 1 ? (
                <Select<string>
                    label={t('remoteNode.checkout')}
                    variant="outlined"
                    value={candidate.projectId}
                    onValueChange={onPick}
                    items={candidates.map((entry) => ({ value: entry.projectId, label: entry.folder }))}
                />
            ) : (
                <span className="truncate font-mono text-sm text-text">{candidate.folder}</span>
            )}
            <FieldHint>{candidate.same ? t('remoteNode.sameRepository') : t('remoteNode.otherRepository')}</FieldHint>
            <div>
                <Button size="sm" variant="ghost" disabled={opening} onClick={onChoose}>
                    {opening ? t('remoteNode.folders.opening') : t('remoteNode.choose')}
                </Button>
            </div>
        </div>
    );
}

function DeviceField({
    machine,
    devices,
    failed,
    value,
    onPick
}: {
    machine: string;
    devices: DeviceInfo[] | null;
    failed: boolean;
    value: DeviceInfo | null;
    onPick(key: string): void;
}) {
    const { t } = useTranslation('shell');
    if (failed) {
        return <FormError className="mt-3">{t('remoteNode.devices.failed', { machine })}</FormError>;
    }
    if (devices === null) {
        return <p className="mt-3 text-sm text-text-muted">{t('remoteNode.devices.looking', { machine })}</p>;
    }
    if (devices.length === 0) {
        return <p className="mt-3 text-sm text-text-muted">{t('remoteNode.devices.none', { machine })}</p>;
    }
    return (
        <div className="mt-3 flex items-center justify-between gap-3">
            <span className="text-xs text-text-muted">{t('remoteNode.device')}</span>
            <Select<string>
                label={t('remoteNode.device')}
                variant="outlined"
                value={value === null ? null : `${value.backendId}:${value.deviceId}`}
                onValueChange={onPick}
                items={devices.map((entry) => ({
                    value: `${entry.backendId}:${entry.deviceId}`,
                    label: `${entry.name} · ${entry.runtime}`,
                    icon: <Icon icon={Server} size={14} />
                }))}
            />
        </div>
    );
}
