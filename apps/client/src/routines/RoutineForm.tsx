import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Package } from 'lucide-react';
import type { Routine, RoutineKind, RoutinePerRun, RoutineSchedule, RuntimeMode } from '@ruimte/contracts';
import { ModelPicker } from '@adecore/agents-react/chat/ui';
import { RUNTIME_MODES, runtimeModeLabel } from '@adecore/agents-react/chat';
import { Button, Checkbox, Field, FieldHint, FormError, Icon, Input, Segmented, Select, TextArea, messageOf } from '@adecore/ui';
import { useLaunches } from '@/launches/state';
import { firstLine, useAgentPick, type AgentPick } from '@/routines/agent-pick';
import { freshRoutineId } from '@/routines/agenda';
import type { RoutineFormRequest } from '@/routines/form-state';
import { routineIdsTaken, saveRoutine } from '@/routines/routine-save';
import { weekdayWords } from '@/routines/words';
import { endpointKey } from '@/state/keys';
import { useProjectList } from '@/state/project-list';

const DAYS = [1, 2, 3, 4, 5, 6, 7];

function today(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/*
 * The one form a routine is made and changed in, in its dialog; a drag across the week has a short form of
 * its own over the same save. Saving is a person's save on the machine, which approves what it writes.
 */
export function RoutineForm({
    endpointId,
    request,
    onDone,
    onCancel
}: {
    endpointId: string;
    request: RoutineFormRequest;
    onDone(projectId: string, routineId: string): void;
    onCancel(): void;
}) {
    const { t } = useTranslation('routines');
    const editing = request.editing?.routine;
    const allProjects = useProjectList((s) => s.projects);
    const projects = allProjects.filter((row) => row.endpointId === endpointId);
    const [projectId, setProjectId] = useState(request.projectId);
    const [title, setTitle] = useState(editing?.title ?? '');
    const [kind, setKind] = useState<RoutineKind>(editing?.kind ?? 'agent');
    const [prompt, setPrompt] = useState(editing?.kind === 'agent' ? editing.prompt : (request.prompt ?? ''));
    const [pick, setPick] = useState<AgentPick | null>(
        editing?.kind === 'agent' ? { provider: editing.provider, selection: editing.selection } : (request.agent ?? null)
    );
    const [mode, setMode] = useState<RuntimeMode>(editing?.kind === 'agent' ? editing.mode : 'supervised');
    const [perRun, setPerRun] = useState<RoutinePerRun>(editing?.kind === 'agent' ? editing.perRun : 'new');
    const [command, setCommand] = useState(editing?.kind === 'command' ? editing.command : '');
    const [cwd, setCwd] = useState(editing?.kind === 'command' ? (editing.cwd ?? '') : '');
    const [launchId, setLaunchId] = useState<string | null>(editing?.kind === 'launch' ? editing.launchId : null);
    const schedule: RoutineSchedule = editing?.schedule ?? request.schedule ?? { kind: 'weekly', days: [1, 2, 3, 4, 5], time: '09:00' };
    const [repeat, setRepeat] = useState<RoutineSchedule['kind']>(schedule.kind);
    const [date, setDate] = useState(schedule.kind === 'once' ? schedule.date : today());
    const [days, setDays] = useState<number[]>(schedule.kind === 'weekly' ? schedule.days : [1, 2, 3, 4, 5]);
    const [time, setTime] = useState(schedule.time);
    const [shared, setShared] = useState(request.editing?.shared ?? false);
    const [pickerOpen, setPickerOpen] = useState(false);
    const [failure, setFailure] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const launches = useLaunches((s) => s.documents[endpointKey(endpointId, projectId)]?.launches ?? null);
    const { pickable, provider, selection } = useAgentPick(pick);
    const shownTitle = title.trim() !== '' ? title.trim() : kind === 'agent' ? firstLine(prompt) : kind === 'command' ? firstLine(command) : '';

    const ready =
        shownTitle !== '' &&
        /^([01]\d|2[0-3]):[0-5]\d$/.test(time) &&
        (repeat === 'once' ? /^\d{4}-\d{2}-\d{2}$/.test(date) : days.length > 0) &&
        (kind === 'agent' ? prompt.trim() !== '' && provider !== null : kind === 'command' ? command.trim() !== '' : launchId !== null);

    const build = (): Routine => {
        const id = editing?.id ?? freshRoutineId(shownTitle, routineIdsTaken(endpointId, projectId));
        const base = {
            id,
            title: shownTitle,
            schedule: repeat === 'once' ? { kind: 'once' as const, date, time } : { kind: 'weekly' as const, days: [...days].sort(), time },
            outputKey: editing?.outputKey ?? id
        };
        // What a newer release stored on the routine rides along unchanged.
        const kept = editing?.kind === kind ? editing : {};
        if (kind === 'agent') {
            return { ...kept, ...base, kind, prompt: prompt.trim(), provider: provider!, ...(selection === undefined ? {} : { selection }), mode, perRun };
        }
        if (kind === 'command') {
            return { ...kept, ...base, kind, command: command.trim(), ...(cwd.trim() === '' ? {} : { cwd: cwd.trim() }) };
        }
        return { ...kept, ...base, kind, launchId: launchId! };
    };

    const submit = async (event?: FormEvent): Promise<void> => {
        event?.preventDefault();
        if (!ready || busy) {
            return;
        }
        setBusy(true);
        setFailure(null);
        try {
            onDone(projectId, await saveRoutine(endpointId, projectId, build(), shared));
        } catch (e) {
            setFailure(messageOf(e, t('form.failed')));
            setBusy(false);
        }
    };

    return (
        <form className="flex flex-col gap-3" onSubmit={(event) => void submit(event)} aria-label={editing ? t('form.editTitle') : t('form.newTitle')}>
            <Field label={t('form.title')}>
                <Input value={title} placeholder={shownTitle === '' ? t('form.titlePlaceholder') : shownTitle} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            {request.pickProject === true && projects.length > 1 && (
                <Field label={t('form.project')} group>
                    <Select
                        label={t('form.project')}
                        value={projectId}
                        onValueChange={setProjectId}
                        items={projects.map((row) => ({ value: row.summary.projectId, label: row.summary.name }))}
                    />
                </Field>
            )}
            <Segmented
                label={t('form.kind')}
                size="sm"
                value={kind}
                onValueChange={(id) => setKind(id as RoutineKind)}
                options={[
                    { id: 'agent', label: t('kinds.agent') },
                    { id: 'command', label: t('kinds.command') },
                    { id: 'launch', label: t('kinds.launch') }
                ]}
            />
            {kind === 'agent' && (
                <>
                    {pickable.length === 0 ? (
                        <FieldHint>{t('form.noAgent')}</FieldHint>
                    ) : (
                        provider !== null &&
                        selection !== undefined && (
                            <Field label={t('form.agent')} group>
                                <div>
                                    <ModelPicker
                                        providers={pickable}
                                        provider={provider}
                                        selection={selection}
                                        open={pickerOpen}
                                        onOpenChange={setPickerOpen}
                                        onChange={(next, model) => setPick({ provider: next, selection: { model, options: {} } })}
                                        kbd={null}
                                        side="bottom"
                                        trigger="chip"
                                    />
                                </div>
                            </Field>
                        )
                    )}
                    <Field label={t('form.prompt')}>
                        <TextArea rows={4} value={prompt} placeholder={t('form.promptPlaceholder')} onChange={(e) => setPrompt(e.target.value)} />
                    </Field>
                    <Field label={t('form.mode')} group>
                        <Select
                            label={t('form.mode')}
                            value={mode}
                            onValueChange={(value) => setMode(value as RuntimeMode)}
                            items={RUNTIME_MODES.map((entry) => ({ value: entry, label: runtimeModeLabel(entry) }))}
                        />
                    </Field>
                    <Field label={t('form.perRun')} group>
                        <Segmented
                            label={t('form.perRun')}
                            size="sm"
                            value={perRun}
                            onValueChange={(id) => setPerRun(id as RoutinePerRun)}
                            options={[
                                { id: 'new', label: t('perRun.new') },
                                { id: 'continue', label: t('perRun.continue') }
                            ]}
                        />
                    </Field>
                </>
            )}
            {kind === 'command' && (
                <>
                    <Field label={t('form.command')}>
                        <Input mono value={command} spellCheck={false} onChange={(e) => setCommand(e.target.value)} />
                    </Field>
                    <Field label={t('form.folder')} hint={t('form.folderHint')}>
                        <Input mono value={cwd} spellCheck={false} placeholder="." onChange={(e) => setCwd(e.target.value)} />
                    </Field>
                </>
            )}
            {kind === 'launch' && (
                <Field label={t('form.launch')} group hint={launches === null || launches.length === 0 ? t('form.noLaunches') : undefined}>
                    <Select
                        label={t('form.launch')}
                        value={launchId}
                        placeholder={t('form.launchPlaceholder')}
                        disabled={launches === null || launches.length === 0}
                        onValueChange={setLaunchId}
                        items={(launches ?? []).map((launch) => ({ value: launch.id, label: launch.name }))}
                    />
                </Field>
            )}
            <Field label={t('form.repeat')} group>
                <div className="flex flex-col gap-2">
                    <Segmented
                        label={t('form.repeat')}
                        size="sm"
                        value={repeat}
                        onValueChange={(id) => setRepeat(id as RoutineSchedule['kind'])}
                        options={[
                            { id: 'once', label: t('form.once') },
                            { id: 'weekly', label: t('form.weekly') }
                        ]}
                    />
                    {repeat === 'once' ? (
                        <Input type="date" size="sm" aria-label={t('form.date')} value={date} onChange={(e) => setDate(e.target.value)} />
                    ) : (
                        <div className="flex flex-wrap gap-1" role="group" aria-label={t('form.days')}>
                            {DAYS.map((day) => {
                                const on = days.includes(day);
                                return (
                                    <Button
                                        key={day}
                                        size="xs"
                                        variant={on ? 'secondary' : 'ghost'}
                                        aria-pressed={on}
                                        onClick={() => setDays(on ? days.filter((entry) => entry !== day) : [...days, day])}
                                    >
                                        {weekdayWords(day)}
                                    </Button>
                                );
                            })}
                        </div>
                    )}
                    <div className="flex items-center gap-2">
                        <Input type="time" size="sm" className="w-28" aria-label={t('form.time')} value={time} onChange={(e) => setTime(e.target.value)} />
                        <span className="text-xs text-text-muted">{t('form.machineClock')}</span>
                    </div>
                </div>
            </Field>
            <label className="flex items-start gap-2 text-sm text-text">
                <Checkbox className="mt-0.5" checked={shared} onCheckedChange={setShared} label={t('form.shared')} />
                <span className="flex flex-col">
                    <span>{t('form.shared')}</span>
                    <span className="text-xs text-text-muted">{t('form.sharedHint')}</span>
                </span>
            </label>
            <p className="flex items-start gap-2 text-xs text-text-muted">
                <Icon icon={Package} size={14} className="mt-0.5 shrink-0" />
                <span>{t(kind === 'agent' ? 'form.outputAgent' : 'form.outputPrinted')}</span>
            </p>
            {failure !== null && <FormError className="break-words">{failure}</FormError>}
            <div className="flex items-center justify-end gap-2">
                <Button onClick={onCancel}>{t('common:action.cancel')}</Button>
                <Button type="submit" variant="primary" disabled={!ready || busy}>
                    {editing ? t('form.save') : t('form.create')}
                </Button>
            </div>
        </form>
    );
}
