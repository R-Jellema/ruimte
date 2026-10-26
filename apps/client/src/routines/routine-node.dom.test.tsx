import { afterEach, beforeEach, describe, expect, setSystemTime, test } from 'bun:test';
import { act } from 'react';
import { zonedTime, type ArtifactGetResult, type ProjectCanvasView, type ProjectNode, type RoutineEntry, type RoutineRun } from '@ruimte/contracts';
import { showRoutine, useRoutinesStage } from '@/routines/stage';
import { liveCanvas } from '@/state/canvas';
import { windowWorkspace } from '@/state/window';
import { clickOn, mount, openSubmenu, until, type Mounted } from '../../testing/dom';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';

const AMS = 'Europe/Amsterdam';
// Sunday 25 October 2026, 14:20 on the machine's clock.
const NOW = zonedTime(2026, 10, 25, 14, 20, AMS);
const REPORT = '# Morning\n\nAll green\n';

function run(runId: string, day: number, patch: Partial<RoutineRun> & Pick<RoutineRun, 'state'>): RoutineRun {
    const due = zonedTime(2026, 10, day, 9, 0, AMS);
    return { runId, routineId: 'morning', projectId: 'project-atlas', kind: 'scheduled', due, at: due, endedAt: due + 180_000, ...patch };
}

const MORNING: RoutineEntry = {
    routine: {
        id: 'morning',
        kind: 'agent',
        title: 'Morning summary',
        schedule: { kind: 'weekly', days: [1, 2, 3, 4, 5], time: '09:00' },
        outputKey: 'morning',
        prompt: 'Summarize what changed on main.',
        provider: 'claude',
        mode: 'supervised',
        perRun: 'new'
    },
    projectId: 'project-atlas',
    projectName: 'Atlas',
    shared: true,
    local: {},
    digest: 'digest-morning',
    approved: true,
    next: zonedTime(2026, 10, 26, 9, 0, AMS),
    runs: [
        run('fri', 23, { state: 'skipped', skipped: 'overlap' }),
        run('thu', 22, { state: 'done', waited: true, chatId: 'chat-thu' }),
        run('wed', 21, { state: 'done', kind: 'caught-up' })
    ],
    artifactId: 'art-1'
};

const ARTIFACT: ArtifactGetResult = {
    artifact: { artifactId: 'art-1', projectId: 'project-atlas', projectName: 'Atlas', title: 'Morning summary', kind: 'report', createdAt: 0 },
    versions: [
        {
            versionId: 'ver-15',
            number: 15,
            createdAt: zonedTime(2026, 10, 22, 9, 3, AMS),
            files: [{ name: 'morning.md', mime: 'text/markdown', size: REPORT.length, sha256: 'ver-15' }],
            bytes: REPORT.length,
            provenance: { maker: 'routine', machineId: 'mac' },
            copiedTo: []
        }
    ],
    chatPresent: false
};

function routineNode(id: string, routine?: string): ProjectNode {
    return { id, kind: 'routine', title: 'Morning summary', x: 0, y: 0, w: 400, h: 560, ...(routine === undefined ? {} : { routine }) };
}

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

async function open(nodes: ProjectNode[]): Promise<void> {
    const main: ProjectCanvasView = { kind: 'canvas', id: 'main', name: 'Main', nodes, texts: [], edges: [], layouts: [] };
    workspace = await openFakeWorkspace(machine, { views: [main] }, { activeViewId: main.id, views: {} });
    page = mount();
    await page.renderApp();
}

function frameOf(id: string): HTMLElement | null {
    return page.host.querySelector<HTMLElement>(`[data-node-id="${id}"]`);
}

function looks(frame: HTMLElement): string[] {
    return [...frame.querySelectorAll('[data-look]')].map((block) => block.getAttribute('data-look') ?? '');
}

beforeEach(() => {
    setSystemTime(NOW);
    localStorage.clear();
    machine = new FakeMachine();
    machine.answer('routine.list', () => ({ routines: [MORNING], revs: { 'project-atlas': 4 }, timeZone: AMS }));
    machine.answer('artifact.get', () => ARTIFACT);
    machine.answer('bytes.read', ({ offset }) => ({ mime: 'text/markdown', size: REPORT.length, version: 'v', offset, data: btoa(REPORT.slice(offset)) }));
    machine.answer('project.save', ({ baseRev }) => ({ rev: baseRev + 1 }) as never);
});

afterEach(async () => {
    await act(async () => useRoutinesStage.setState({ open: false, week: 0, filter: 'project', routine: null, runId: null }));
    await page.unmount();
    workspace.close();
    setSystemTime();
});

describe('a routine node', () => {
    test('draws its runs oldest first with the next time, its schedule and the latest version of its Output', async () => {
        await open([routineNode('node-1', 'morning')]);
        await until(() => (frameOf('node-1')?.textContent ?? '').includes('All green'));
        const frame = frameOf('node-1')!;
        expect(looks(frame)).toEqual(['caught-up', 'waited', 'skipped', 'next']);
        expect(frame.textContent).toContain('Weekdays at');
        expect(frame.textContent).toContain('Mon 09:00');
        // The newest run that ran is picked, and says what happened.
        expect(frame.textContent).toContain('Waited for you, then done in');
        expect(frame.querySelector('[aria-pressed="true"]')?.getAttribute('data-look')).toBe('waited');
        expect(frame.textContent).toContain('v15');
    });

    test("a block opens that run in Routines, and the clock the routine's own page", async () => {
        await open([routineNode('node-1', 'morning')]);
        await until(() => frameOf('node-1')?.querySelector('[data-look="caught-up"]') != null);
        await clickOn(frameOf('node-1')!.querySelector('[data-look="caught-up"]'));
        expect(useRoutinesStage.getState()).toMatchObject({ open: true, routine: { projectId: 'project-atlas', routineId: 'morning' }, runId: 'wed' });

        await act(async () => useRoutinesStage.setState({ open: false, routine: null, runId: null }));
        await clickOn(frameOf('node-1')!.querySelector('button[aria-label="Open in Routines"]'));
        expect(useRoutinesStage.getState()).toMatchObject({ open: true, routine: { routineId: 'morning' }, runId: null });
    });

    test('the switch in its header pauses the routine on the machine', async () => {
        await open([routineNode('node-1', 'morning')]);
        await until(() => frameOf('node-1')?.querySelector('[role="switch"]') != null);
        const toggle = frameOf('node-1')!.querySelector('[role="switch"]')!;
        expect(toggle.getAttribute('aria-checked')).toBe('true');
        await clickOn(toggle);
        await until(() => machine.requests('routine.pause').length === 1);
        expect(machine.requests('routine.pause')[0]).toEqual({ projectId: 'project-atlas', routineId: 'morning' });
    });

    test('a routine this machine does not keep says so', async () => {
        await open([routineNode('node-1', 'nightly'), routineNode('node-2')]);
        await until(() => (frameOf('node-2')?.textContent ?? '').includes('not on this machine'));
        expect(frameOf('node-1')?.textContent).toContain('This routine is not on this machine');
    });

    test("Show on canvas in a routine's page places it on the canvas", async () => {
        await open([]);
        await act(async () => showRoutine({ projectId: 'project-atlas', routineId: 'morning' }));
        await until(() => [...page.host.querySelectorAll('button')].some((button) => button.textContent?.trim() === 'Show on canvas'));
        await clickOn([...page.host.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Show on canvas') ?? null);
        await until(() => !useRoutinesStage.getState().open && liveCanvas('main') !== null);
        // The page has no layout to measure, so the canvas gets the size a window would give it.
        await act(async () => liveCanvas('main')!.setViewport({ w: 1280, h: 800 }));
        await until(() => Object.values(liveCanvas('main')!.nodes).some((node) => node.kind === 'routine'));
        await act(async () => windowWorkspace()!.connection.projects.flush());
        await until(() => machine.requests('project.save').length > 0);
        const view = machine
            .requests('project.save')
            .at(-1)
            ?.content.views.find((candidate) => candidate.id === 'main');
        expect(view?.kind === 'canvas' ? view.nodes[0] : null).toMatchObject({ kind: 'routine', routine: 'morning', title: 'Morning summary' });
    });

    test("the dock's plus places one of the project's routines on the canvas", async () => {
        await open([]);
        await until(() => liveCanvas('main') !== null);
        await act(async () => liveCanvas('main')!.setViewport({ w: 1280, h: 800 }));
        await clickOn(page.host.querySelector<HTMLElement>('[aria-label="Add"]'));
        await until(() => document.querySelector('[role="menu"]') !== null);
        await openSubmenu('Routine');
        await clickOn([...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent?.trim() === 'Morning summary') ?? null);
        await until(() => Object.values(liveCanvas('main')!.nodes).some((node) => node.kind === 'routine' && node.routine === 'morning'));
    });

    test("a right-click on the canvas places one of the project's routines there", async () => {
        await open([]);
        await until(() => liveCanvas('main') !== null);
        await act(async () => liveCanvas('main')!.setViewport({ w: 1280, h: 800 }));
        const surface = page.host.querySelector('[data-canvas-surface]')!;
        await act(async () => {
            surface.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 400, clientY: 300, button: 2 }));
        });
        await until(() => document.querySelector('[role="menu"]') !== null);
        await openSubmenu('Routine');
        const items = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
        expect(items().some((item) => item.textContent?.trim() === 'New routine…')).toBe(true);
        await clickOn(items().find((item) => item.textContent?.trim() === 'Morning summary') ?? null);
        await until(() => Object.values(liveCanvas('main')!.nodes).some((node) => node.kind === 'routine'));
        await act(async () => windowWorkspace()!.connection.projects.flush());
        await until(() => machine.requests('project.save').length > 0);
        const view = machine
            .requests('project.save')
            .at(-1)
            ?.content.views.find((candidate) => candidate.id === 'main');
        expect(view?.kind === 'canvas' ? view.nodes[0] : null).toMatchObject({ kind: 'routine', routine: 'morning', title: 'Morning summary' });
    });
});
