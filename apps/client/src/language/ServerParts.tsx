import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LanguageLogLine } from '@ruimte/contracts';
import type { LanguageServerStatus } from '@ruimte/contracts';
import { Button, Dialog } from '@adecore/ui';
import { report, useStatuses } from './server-status';
import type { LanguageStatusTracker } from './status';
import { actionsOf, kindOf, nameOf, type ServerTone } from './status-view';

const DOT_CLASSES: Record<ServerTone, string> = {
    ok: 'bg-status-idle',
    busy: 'bg-status-needs-you',
    error: 'bg-status-error',
    idle: 'bg-text-faint'
};

export function Dot({ tone }: { tone: ServerTone }) {
    return <span aria-hidden className={`size-2 shrink-0 rounded-full ${DOT_CLASSES[tone]}`} />;
}

export function LogDialog({ server, tracker, onClose }: { server: string | null; tracker: LanguageStatusTracker; onClose(): void }) {
    const { t } = useTranslation('panels');
    const [lines, setLines] = useState<LanguageLogLine[] | null>(null);
    const statuses = useStatuses(tracker);

    useEffect(() => {
        if (server === null) {
            return;
        }
        let alive = true;
        void tracker
            .log(server)
            .catch(() => [])
            .then((answer) => alive && setLines(answer));
        return () => {
            alive = false;
            setLines(null);
        };
    }, [server, tracker]);

    return (
        <Dialog.Root open={server !== null} onOpenChange={(next) => !next && onClose()}>
            <Dialog.Popup className="flex h-[480px] w-[720px] flex-col gap-3 p-4">
                <Dialog.Title>{t('language.logTitle', { name: server === null ? '' : nameOf(server, statuses) })}</Dialog.Title>
                <div className="min-h-0 grow overflow-auto rounded-md bg-surface-sunken p-3 font-mono text-xs whitespace-pre-wrap text-text-muted select-text">
                    {lines !== null && (lines.length === 0 ? t('language.logEmpty') : lines.map((line) => line.text).join('\n'))}
                </div>
            </Dialog.Popup>
        </Dialog.Root>
    );
}

/* Install, update, step back, restart and show the log of one server, the buttons the status bar and the settings both draw. */
export function ServerActionButtons({
    status,
    tracker,
    size,
    stepBack,
    stepBackVariant,
    onLog
}: {
    status: LanguageServerStatus;
    tracker: LanguageStatusTracker;
    size: 'xs' | 'sm';
    /* Whether the step back to the previous version is offered; the status bar keeps it for a server that broke. */
    stepBack: boolean;
    stepBackVariant?: 'secondary';
    onLog(): void;
}) {
    const { t } = useTranslation('panels');
    const kind = kindOf(status.server);
    const actions = actionsOf(status);
    const fail = (error: unknown): void => report(error, t);

    return (
        <>
            {kind !== null && actions.install && (
                <Button size={size} variant="secondary" onClick={() => void tracker.install(kind).catch(fail)}>
                    {t('language.install')}
                </Button>
            )}
            {kind !== null && actions.update && status.update !== undefined && (
                <Button size={size} variant="secondary" onClick={() => void tracker.install(kind).catch(fail)}>
                    {status.update.rebuild === true ? t('language.rebuild') : t('language.update', { version: status.update.version })}
                </Button>
            )}
            {kind !== null && stepBack && status.previous !== undefined && (
                <Button size={size} variant={stepBackVariant} onClick={() => void tracker.rollback(kind).catch(fail)}>
                    {t('language.rollback', { version: status.previous.version })}
                </Button>
            )}
            {actions.restart && (
                <Button size={size} variant="secondary" onClick={() => void tracker.restart(status.server).catch(fail)}>
                    {t('language.restart')}
                </Button>
            )}
            {actions.log && (
                <Button size={size} onClick={onLog}>
                    {t('language.showLog')}
                </Button>
            )}
        </>
    );
}
