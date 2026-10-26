import { afterEach, beforeEach, describe, expect, setSystemTime, test } from 'bun:test';
import { act } from 'react';
import { REQUEST_SCHEMAS, zonedTime, type ProjectCanvasView, type ProviderInfo, type RequestType, type RoutineEntry, type RoutineRun } from '@ruimte/contracts';
import { formatDateTime } from '@adecore/ui/format';
import { isApplePlatform } from '@/desktop/bridge';
import { showRoutine, useRoutinesStage } from '@/routines/stage';
import { liveCanvas } from '@/state/canvas';
import { useUi } from '@/state/ui';
import { chatInfoOf } from '../../testing/chat-info';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { clickOn, mount, pressKey, until, type Mounted } from '../../testing/dom';

const AMS = 'Europe/Amsterdam';
const MAIN: ProjectCanvasView = { kind: 'canvas', id: 'main', name: 'Main', nodes: [], texts: [], edges: [], layouts: [] };
// Sunday 25 October 2026, 14:20 on the machine's clock.
const NOW = zonedTime(2026, 10, 25, 14, 20, AMS);

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;
let routines: RoutineEntry[];

function run(runId: string, day: number, patch: Partial<RoutineRun> & Pick<RoutineRun, 'state'>): RoutineRun {
    const due = zonedTime(2026, 10, day, 9, 0, AMS);
    return { runId, routineId: 'morning', projectId: 'project-atlas', kind: 'scheduled', due, at: due, endedAt: due + 180_000, ...patch };
}

function entry(id: string, title: string, patch: Partial<RoutineEntry> = {}): RoutineEntry {
    return {
        routine: {
            id,
            kind: 'agent',
            title,
            schedule: { kind: 'weekly', days: [1, 2, 3, 4, 5], time: '09:00' },
            outputKey: id,
            prompt: 'Summarize what changed on main.',
            provider: 'claude',
            mode: 'supervised',
            perRun: 'new'
        },
        projectId: 'project-atlas',
        projectName: 'Atlas',
        shared: false,
        local: {},
        digest: `digest-${id}`,
        approved: true,
        next: zonedTime(2026, 10, 26, 9, 0, AMS),
        runs: [],
        ...patch
    };
}

const MORNING = entry('morning', 'Morning summary', {
    runs: [
        run('fri', 23, { state: 'skipped', skipped: 'overlap' }),
        run('thu', 22, { state: 'done', waited: true }),
        run('wed', 21, { state: 'done', kind: 'caught-up', at: zonedTime(2026, 10, 21, 9, 41, AMS) }),
        run('tue', 20, { state: 'limit' }),
        run('mon', 19, { state: 'done' })
    ]
});

const HELD: RoutineEntry = {
    ...entry('changelog', 'Weekly changelog draft', { approved: false, held: 'outside', shared: true, next: null }),
    routine: {
        ...MORNING.routine,
        id: 'changelog',
        title: 'Weekly changelog draft',
        outputKey: 'changelog',
        schedule: { kind: 'weekly', days: [5], time: '16:00' }
    }
};

const CLAUDE = {
    kind: 'claude',
    name: 'Claude Code',
    installed: true,
    version: '2.1.0',
    models: [{ slug: 'model', name: 'Model', legacy: false, isDefault: true, options: [] }],
    defaultModel: 'model',
    capabilities: { chat: true, terminal: true, hooks: true, diffs: 'before-after', slashCommands: true },
    resumeCommand: 'claude --resume {id}'
} as unknown as ProviderInfo;

function text(): string {
    return page.host.textContent ?? '';
}

function stage(): HTMLElement | null {
    return page.host.querySelector('section[aria-label="Routines"]');
}

function clock(): HTMLElement | null {
    return page.host.querySelector<HTMLElement>('header button[aria-label^="Routines"]');
}

function buttonWithText(label: string, within: ParentNode = document): HTMLElement | null {
    return ([...within.querySelectorAll('button')] as HTMLElement[]).find((button) => button.textContent?.trim() === label) ?? null;
}

function sidePanelShown(): boolean {
    return page.host.querySelector('.ade-workspace')?.hasAttribute('data-side-panel') ?? false;
}

function looksOf(routineId: string): string[] {
    return [...page.host.querySelectorAll(`[data-routine="${routineId}"] [data-look]`)].map((block) => block.getAttribute('data-look') ?? '');
}

async function openStage(): Promise<void> {
    await until(() => clock() !== null);
    await clickOn(clock());
    await until(() => stage() !== null && text().includes('Week 43'));
}

beforeEach(async () => {
    setSystemTime(NOW);
    localStorage.clear();
    routines = [MORNING];
    machine = new FakeMachine();
    machine.answer('provider.list', () => ({ providers: [CLAUDE] }));
    machine.answer('routine.list', () => ({ routines, revs: { 'project-atlas': 4 }, timeZone: AMS }));
    workspace = await openFakeWorkspace(machine, { views: [MAIN] }, { activeViewId: MAIN.id, views: {} });
    page = mount();
    await page.renderApp();
});

afterEach(async () => {
    await act(async () => {
        useRoutinesStage.setState({ open: false, week: 0, filter: 'project', routine: null, runId: null });
        useUi.getState().setPanel({ open: false, kind: 'files' });
    });
    await page.unmount();
    workspace.close();
    setSystemTime();
});

describe('Routines', () => {
    test('opens over the view and its panel, and Close brings both back', async () => {
        await act(async () => useUi.getState().setPanel({ open: true, kind: 'output' }));
        await until(() => sidePanelShown());
        await openStage();
        expect(sidePanelShown()).toBe(false);
        expect(machine.requests('routine.watch')).toHaveLength(1);
        // Routines covers the view, so no view in the sidebar reads as the one in front.
        expect(page.host.querySelector('aside [aria-current="true"]')).toBeNull();

        await clickOn(buttonWithText('Close', page.host));
        await until(() => stage() === null);
        expect(sidePanelShown()).toBe(true);
        expect(page.host.querySelector('aside [aria-current="true"]')).not.toBeNull();
        expect(useUi.getState().panel).toEqual({ open: true, kind: 'output' });

        // The key toggles it, with a modifier; a bare Escape leaves it where it is.
        await pressKey(document.body, 's', { altKey: true, metaKey: isApplePlatform(), ctrlKey: !isApplePlatform() });
        await until(() => stage() !== null);
        await pressKey(document.body, 'Escape');
        expect(stage()).not.toBeNull();
        await clickOn(clock());
        await until(() => stage() === null);

        // Picking a view in the sidebar leaves it too.
        await openStage();
        const row = ([...page.host.querySelectorAll('aside button')] as HTMLElement[]).find((button) => button.textContent?.trim() === 'Main') ?? null;
        await clickOn(row);
        await until(() => stage() === null);
    });

    test('draws a block per run by its state, and the times still to come', async () => {
        await openStage();
        expect(looksOf('morning')).toEqual(['done', 'limit', 'caught-up', 'waited', 'skipped']);
        expect(text()).toContain('October 19 to 25');
        const row = page.host.querySelector('[data-routine="morning"] [role="rowheader"]')?.textContent ?? '';
        expect(row).toContain('Weekdays at');
        expect(row).toContain('Claude Code');
        await clickOn(page.host.querySelector('button[aria-label="Next week"]'));
        await until(() => text().includes('Week 44'));
        expect(looksOf('morning')).toEqual(['next', 'next', 'next', 'next', 'next']);
    });

    test('a block opens a card of its run, and its actions go where the stage goes', async () => {
        machine.answer('routine.runNow', () => ({ outcome: 'started' as const, runId: 'now' }));
        await openStage();
        const card = (): Element | null => document.querySelector('[aria-label="Run of Morning summary"]');
        await clickOn(page.host.querySelector('[data-routine="morning"] button[data-look="done"]'));
        await until(() => card()?.textContent?.includes('Started') === true);
        expect(card()?.textContent).toContain('Atlas');
        expect(card()?.textContent).toContain('Done in 3 min');
        // Only a routine with a node on a canvas offers the way there.
        expect(buttonWithText('Open on canvas', card()!)).toBeNull();

        await clickOn(buttonWithText('Run now', card()!));
        await until(() => machine.requests('routine.runNow').length === 1);
        expect(machine.requests('routine.runNow')[0]).toEqual({ projectId: 'project-atlas', routineId: 'morning' });
        await until(() => card() === null);

        await clickOn(page.host.querySelector('[data-routine="morning"] button[data-look="done"]'));
        await until(() => card() !== null);
        await clickOn(buttonWithText('Open in Routines', card()!));
        expect(useRoutinesStage.getState()).toMatchObject({ routine: { projectId: 'project-atlas', routineId: 'morning' }, runId: 'mon' });
    });

    test('a paused routine draws the rest of the week as one band, and Resume picks it up again', async () => {
        const pausedRun = (day: number): RoutineRun => ({ ...run(`bundle-${day}`, day, { state: 'skipped', skipped: 'paused' }), routineId: 'bundle' });
        routines = [
            MORNING,
            entry('bundle', 'Bundle size report', {
                local: { pausedAt: zonedTime(2026, 10, 13, 10, 0, AMS) },
                next: null,
                runs: [pausedRun(23), pausedRun(22), pausedRun(21)]
            })
        ];
        await openStage();
        await act(async () => machine.emit('routine.changed', { projectId: 'project-atlas' }));
        const band = (): Element | null => page.host.querySelector('[data-routine="bundle"] [data-band="paused"]');
        await until(() => band() !== null);
        expect(band()?.textContent).toContain('Paused since');
        expect(band()?.textContent).toContain('3 runs skipped');
        await clickOn(buttonWithText('Resume', band()!));
        await until(() => machine.requests('routine.resume').length === 1);
        expect(machine.requests('routine.resume')[0]).toEqual({ projectId: 'project-atlas', routineId: 'bundle' });
    });

    test('approving a routine from git sends the digest that was shown', async () => {
        routines = [MORNING, HELD];
        await openStage();
        await act(async () => machine.emit('routine.changed', { projectId: 'project-atlas' }));
        await until(() => page.host.querySelector('article[aria-label="Weekly changelog draft"]') !== null);
        const card = page.host.querySelector('article[aria-label="Weekly changelog draft"]');
        expect(card?.textContent).toContain('Every Friday at');
        expect(card?.textContent).toContain('Added through the project file');
        await clickOn(buttonWithText('Approve', card!));
        await until(() => machine.requests('routine.approve').length === 1);
        expect(machine.requests('routine.approve')[0]).toEqual({ projectId: 'project-atlas', routineId: 'changelog', digest: 'digest-changelog' });
    });

    test("what waits in another project shows beside this project's week, so the clock's dot is never unexplained", async () => {
        routines = [MORNING, { ...HELD, projectId: 'project-other', projectName: 'Other' }];
        await openStage();
        await act(async () => machine.emit('routine.changed', { projectId: 'project-other' }));
        await until(() => page.host.querySelector('article[aria-label="Weekly changelog draft"]') !== null);
        // The week stays this project's; only the column reaches further.
        expect(page.host.querySelector('[data-routine="changelog"]')).toBeNull();
        expect(clock()?.getAttribute('aria-label')).toBe('Routines, 1 needs you');
    });

    test('a routine that waits for approval says so over its definition, and approves from there', async () => {
        routines = [MORNING, HELD];
        await act(async () => machine.emit('routine.changed', { projectId: 'project-atlas' }));
        await act(async () => showRoutine({ projectId: 'project-atlas', routineId: 'changelog' }));
        await until(() => text().includes('Needs your approval'));
        expect(text()).toContain('Added through the project file');
        await clickOn(buttonWithText('Approve', page.host));
        await until(() => machine.requests('routine.approve').length === 1);
        expect(machine.requests('routine.approve')[0]).toEqual({ projectId: 'project-atlas', routineId: 'changelog', digest: 'digest-changelog' });
    });

    test('a drag across the days makes a routine on those days', async () => {
        await openStage();
        const day = (index: number): Element => page.host.querySelector(`[data-drag-day="${index}"]`)!;
        await act(async () => {
            day(1).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1 }));
        });
        await act(async () => {
            day(3).dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerId: 1 }));
            day(3).dispatchEvent(new PointerEvent('pointerenter', { bubbles: false, pointerId: 1 }));
        });
        await act(async () => {
            window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
        });
        await until(() => document.querySelector('form[aria-label="New routine"]') !== null);
        const form = document.querySelector('form[aria-label="New routine"]')!;
        const prompt = form.querySelector('textarea')!;
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(prompt, 'Write three bullets for standup.');
            prompt.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await clickOn(buttonWithText('Create routine', form));
        await until(() => machine.requests('routine.save').length === 1);
        const saved = machine.requests('routine.save')[0]!;
        expect(saved.baseRev).toBe(4);
        expect(saved.shared).toBe(false);
        expect(saved.routine).toMatchObject({
            id: 'write-three-bullets-for-standup',
            kind: 'agent',
            title: 'Write three bullets for standup',
            prompt: 'Write three bullets for standup.',
            mode: 'supervised',
            perRun: 'new',
            schedule: { kind: 'weekly', days: [2, 3, 4], time: '09:00' }
        });
    });

    test('a cron routine waits for an expression it reads, shows its next times and sends it', async () => {
        await openStage();
        await clickOn(buttonWithText('New routine', page.host));
        await until(() => document.querySelector('form[aria-label="New routine"]') !== null);
        const form = document.querySelector('form[aria-label="New routine"]')!;
        const type = async (field: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> => {
            await act(async () => {
                Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), 'value')!.set!.call(field, value);
                field.dispatchEvent(new Event('input', { bubbles: true }));
            });
        };
        await type(form.querySelector('textarea')!, 'Check the build.');
        await clickOn(buttonWithText('Cron', form));
        await until(() => [...form.querySelectorAll('label')].some((label) => label.textContent === 'Cron expression'));
        const label = [...form.querySelectorAll('label')].find((candidate) => candidate.textContent === 'Cron expression')!;
        const field = document.getElementById(label.htmlFor) as HTMLInputElement;
        const create = buttonWithText('Create routine', form) as HTMLButtonElement;

        await type(field, '*/5 * * * *');
        expect(form.querySelector('[role="alert"]')?.textContent).toStartWith('This runs more often than every 15 minutes.');
        expect(create.disabled).toBe(true);
        await type(field, '0 25 * * *');
        expect(form.querySelector('[role="alert"]')?.textContent).toBe('The hour (0-23) field does not take “25”.');

        await type(field, ' 30 8  * * 1-5');
        expect(form.querySelector('[role="alert"]')).toBeNull();
        const shown = (day: number): string =>
            formatDateTime(zonedTime(2026, 10, day, 8, 30, AMS), {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
                timeZone: AMS
            });
        expect(form.querySelector('[data-cron-next]')?.textContent).toBe(`Next: ${[26, 27, 28].map(shown).join(', ')}`);
        expect(create.disabled).toBe(false);
        await clickOn(create);
        await until(() => machine.requests('routine.save').length === 1);
        expect(machine.requests('routine.save')[0]!.routine.schedule).toEqual({ kind: 'cron', expression: '30 8 * * 1-5' });
    });

    test('a routine through the day sends its days, its step and its first and last time', async () => {
        await openStage();
        await clickOn(buttonWithText('New routine', page.host));
        await until(() => document.querySelector('form[aria-label="New routine"]') !== null);
        const form = document.querySelector('form[aria-label="New routine"]')!;
        const type = async (field: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> => {
            await act(async () => {
                Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), 'value')!.set!.call(field, value);
                field.dispatchEvent(new Event('input', { bubbles: true }));
            });
        };
        await type(form.querySelector('textarea')!, 'Check the build.');
        await clickOn(buttonWithText('Through the day', form));
        await until(() => form.querySelector('[aria-label="How often"]') !== null);
        await clickOn(buttonWithText('Sat', form));
        await clickOn(form.querySelector('[aria-label="How often"]'));
        await until(() => document.querySelector('[role="option"]') !== null);
        await clickOn([...document.querySelectorAll('[role="option"]')].find((option) => option.textContent === 'every 30 minutes') ?? null);
        await type(form.querySelector<HTMLInputElement>('input[aria-label="First time"]')!, '08:00');
        await type(form.querySelector<HTMLInputElement>('input[aria-label="Last time"]')!, '18:00');
        await clickOn(buttonWithText('Create routine', form));
        await until(() => machine.requests('routine.save').length === 1);
        expect(machine.requests('routine.save')[0]!.routine.schedule).toEqual({
            kind: 'interval',
            days: [1, 2, 3, 4, 5, 6],
            every: 30,
            from: '08:00',
            to: '18:00'
        });
    });

    test('the day of a routine through the day folds its runs and its coming times', async () => {
        const hour = (value: number): number => zonedTime(2026, 10, 23, value, 0, AMS);
        const runs = [9, 10, 11, 12].map((value) => ({
            ...run(`h${value}`, 23, { state: value === 10 ? 'failed' : 'done' }),
            routineId: 'hourly',
            due: hour(value),
            at: hour(value)
        }));
        const hourly = entry('hourly', 'Build check', { runs });
        routines = [
            { ...hourly, routine: { ...hourly.routine, schedule: { kind: 'interval', days: [1, 2, 3, 4, 5, 6, 7], every: 60, from: '09:00', to: '17:00' } } }
        ];
        await openStage();
        await act(async () => machine.emit('routine.changed', { projectId: 'project-atlas' }));
        await until(() => page.host.querySelector('[data-routine="hourly"] [data-fold="runs"]') !== null);
        const row = page.host.querySelector('[data-routine="hourly"]')!;
        const folded = row.querySelector<HTMLElement>('[data-fold="runs"]')!;
        expect(folded.textContent).toBe('4 runs · 1 failed');
        // Sunday from 14:20 on: 15:00, 16:00 and 17:00 are still to come.
        expect(row.querySelector('[data-fold="coming"]')?.getAttribute('aria-label')).toStartWith('Build check, 3 more times from');
        await clickOn(folded);
        await until(() => document.querySelector('[aria-label="Runs of Build check"]') !== null);
        const list = document.querySelector('[aria-label="Runs of Build check"]')!;
        expect([...list.querySelectorAll('[data-look]')].map((block) => block.getAttribute('data-look'))).toEqual(['done', 'failed', 'done', 'done']);
        await clickOn(list.querySelector('[data-look="failed"]'));
        await until(() => document.querySelector('[aria-label="Runs of Build check"]') === null);
    });

    test('the keys of the canvas under it do nothing while it is open', async () => {
        await openStage();
        await pressKey(document.body, 'n', { altKey: true });
        expect(Object.keys(liveCanvas('main')?.nodes ?? {})).toEqual([]);

        await clickOn(buttonWithText('Close', page.host));
        await until(() => stage() === null);
        await pressKey(document.body, 'n', { altKey: true });
        await until(() => Object.values(liveCanvas('main')?.nodes ?? {}).some((node) => node.kind === 'note'));
    });

    test('a run that waits says what its chat asks, once the machine said so', async () => {
        const waiting = run('sun', 25, { state: 'needs-you', chatId: 'routine-chat-sun', at: zonedTime(2026, 10, 25, 9, 0, AMS) });
        routines = [{ ...MORNING, runs: [waiting, ...MORNING.runs] }];
        await openStage();
        await act(async () => machine.emit('routine.changed', { projectId: 'project-atlas' }));
        const needsYou = (): string => page.host.querySelector('section[aria-label="Needs you"]')?.textContent ?? '';
        await until(() => needsYou().includes('Since'));
        const question = { id: 'q1', header: 'Branch', question: 'Which branch should the summary cover?', choices: [], multiSelect: false };
        const info = chatInfoOf('routine-chat-sun', {
            status: 'needs-you',
            requests: [{ requestId: 'r1', itemId: 'i1', kind: 'question', createdAt: waiting.at, question: { questions: [question] } }]
        });
        await act(async () => machine.emit('chat.status', { chatId: 'routine-chat-sun', info }));
        await until(() => needsYou().includes('Which branch should the summary cover?'));
    });

    test('a machine without routines shows no clock', async () => {
        machine.answersOnly((Object.keys(REQUEST_SCHEMAS) as RequestType[]).filter((type) => !type.startsWith('routine.')));
        await until(() => page.host.querySelector('header button[aria-label="Search"]') !== null);
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
        expect(clock()).toBeNull();
    });
});
