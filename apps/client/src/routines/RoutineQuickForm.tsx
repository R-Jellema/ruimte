import { useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarPlus, Monitor, Moon, Repeat, ShieldCheck } from 'lucide-react';
import type { RuntimeMode } from '@ruimte/contracts';
import { ModelPicker } from '@adecore/agents-react/chat/ui';
import { runtimeModeLabel } from '@adecore/agents-react/chat';
import { Button, FieldHint, FormError, Icon, Input, Pill, Select, TextArea, messageOf } from '@adecore/ui';
import { firstLine, useAgentPick, type AgentPick } from '@/routines/agent-pick';
import { freshRoutineId, scheduleForDays, type AgendaWeek } from '@/routines/agenda';
import { openRoutineForm } from '@/routines/form-state';
import { routineIdsTaken, saveRoutine } from '@/routines/routine-save';
import { spanWords } from '@/routines/words';
import { useEndpoints } from '@/state/endpoints';
import { isThisMachine } from '@/state/local-machine';
import { useProjectList } from '@/state/project-list';

// A routine made by a drag starts as unattended as a new one in the full form.
const MODE: RuntimeMode = 'supervised';

/*
 * The short form under a drag across the days: an agent routine on the days it picked, saved the way the
 * full form saves. Everything else a routine can be is behind More options.
 */
export function RoutineQuickForm({
    endpointId,
    projectId: initialProject,
    pickProject,
    week,
    from,
    to,
    timeZone,
    onDone,
    onCancel
}: {
    endpointId: string;
    projectId: string;
    pickProject: boolean;
    week: AgendaWeek;
    from: number;
    to: number;
    timeZone: string;
    onDone(): void;
    onCancel(): void;
}) {
    const { t } = useTranslation('routines');
    const allProjects = useProjectList((s) => s.projects);
    const projects = allProjects.filter((row) => row.endpointId === endpointId && (pickProject || row.summary.projectId === initialProject));
    const machine = useEndpoints((s) => s.endpoints.find((candidate) => candidate.id === endpointId)?.label ?? '');
    const [projectId, setProjectId] = useState(initialProject);
    const [title, setTitle] = useState('');
    const [prompt, setPrompt] = useState('');
    const [time, setTime] = useState('09:00');
    const [pick, setPick] = useState<AgentPick | null>(null);
    const [pickerOpen, setPickerOpen] = useState(false);
    const [failure, setFailure] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const { pickable, provider, selection } = useAgentPick(pick);
    const shownTitle = title.trim() !== '' ? title.trim() : firstLine(prompt);
    const schedule = scheduleForDays(week, from, to, time);
    const ready = shownTitle !== '' && prompt.trim() !== '' && provider !== null && /^([01]\d|2[0-3]):[0-5]\d$/.test(time);

    const submit = async (event: FormEvent): Promise<void> => {
        event.preventDefault();
        if (!ready || busy || provider === null) {
            return;
        }
        setBusy(true);
        setFailure(null);
        const id = freshRoutineId(shownTitle, routineIdsTaken(endpointId, projectId));
        const routine = {
            id,
            title: shownTitle,
            schedule,
            outputKey: id,
            kind: 'agent' as const,
            prompt: prompt.trim(),
            provider,
            ...(selection === undefined ? {} : { selection }),
            mode: MODE,
            perRun: 'new' as const
        };
        try {
            await saveRoutine(endpointId, projectId, routine, false);
            onDone();
        } catch (e) {
            setFailure(messageOf(e, t('form.failed')));
            setBusy(false);
        }
    };

    const more = (): void => {
        onCancel();
        openRoutineForm({ projectId, pickProject, schedule, ...(prompt.trim() === '' ? {} : { prompt: prompt.trim() }) });
    };

    return (
        <form className="flex flex-col gap-2.5" onSubmit={(event) => void submit(event)} aria-label={t('form.newTitle')}>
            <div className="flex min-w-0 items-center gap-2">
                <Icon icon={CalendarPlus} size={14} className="shrink-0 text-text-muted" />
                <span className="text-sm font-medium text-text">{t('form.newTitle')}</span>
                <span className="grow" />
                <Pill tone="accent" icon={<Icon icon={Repeat} size={12} />}>
                    {spanWords(week, from, to, timeZone)}
                </Pill>
            </div>
            <Input
                aria-label={t('form.title')}
                value={title}
                placeholder={shownTitle === '' ? t('form.titlePlaceholder') : shownTitle}
                onChange={(e) => setTitle(e.target.value)}
            />
            <TextArea
                rows={3}
                aria-label={t('form.prompt')}
                value={prompt}
                placeholder={t('form.promptPlaceholder')}
                onChange={(e) => setPrompt(e.target.value)}
            />
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_96px] items-end gap-2">
                <Labeled label={t('form.project')}>
                    <Select
                        size="sm"
                        label={t('form.project')}
                        value={projectId}
                        disabled={projects.length < 2}
                        onValueChange={setProjectId}
                        items={projects.map((row) => ({ value: row.summary.projectId, label: row.summary.name }))}
                    />
                </Labeled>
                <Labeled label={t('form.agent')}>
                    {provider !== null && selection !== undefined ? (
                        <ModelPicker
                            providers={pickable}
                            provider={provider}
                            selection={selection}
                            open={pickerOpen}
                            onOpenChange={setPickerOpen}
                            onChange={(next, model) => setPick({ provider: next, selection: { model, options: {} } })}
                        />
                    ) : (
                        <FieldHint>{t('form.noAgent')}</FieldHint>
                    )}
                </Labeled>
                <Labeled label={t('form.time')}>
                    <Input type="time" size="sm" aria-label={t('form.time')} value={time} onChange={(e) => setTime(e.target.value)} />
                </Labeled>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
                <Pill icon={<Icon icon={Monitor} size={12} />}>{isThisMachine(endpointId) ? t('quick.thisMachine') : t('quick.onMachine', { machine })}</Pill>
                <Pill icon={<Icon icon={ShieldCheck} size={12} />}>{runtimeModeLabel(MODE)}</Pill>
                <Pill icon={<Icon icon={Moon} size={12} />}>{t('quick.missed')}</Pill>
            </div>
            {failure !== null && <FormError className="break-words">{failure}</FormError>}
            <div className="flex items-center gap-2">
                <Button size="sm" onClick={more}>
                    {t('quick.more')}
                </Button>
                <span className="grow" />
                <Button size="sm" onClick={onCancel}>
                    {t('common:action.cancel')}
                </Button>
                <Button size="sm" type="submit" variant="primary" disabled={!ready || busy}>
                    {t('form.create')}
                </Button>
            </div>
        </form>
    );
}

function Labeled({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="flex min-w-0 flex-col gap-1">
            <span aria-hidden="true" className="text-xs text-text-muted">
                {label}
            </span>
            {children}
        </div>
    );
}
