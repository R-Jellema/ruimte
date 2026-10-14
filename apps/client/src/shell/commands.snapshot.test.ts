import { afterAll, describe, expect, mock, test } from 'bun:test';
import type { LaunchesDocument, ProjectSummary, ProjectView, ProviderInfo, SplitLayout } from '@ruimte/contracts';
import type { Shortcut } from '@adecore/ui';
import type { PrRepo } from '@/state/pr-repos';

// The theme store touches the page as it loads, and no row here reads more of it than its toggle.
mock.module('@/state/theme', () => ({ useTheme: { getState: () => ({ toggle: () => undefined }) } }));

const globals = globalThis as { window?: unknown };
const previousWindow = globals.window;
globals.window = Object.assign(new EventTarget(), {
    ruimteDesktop: { openWindow: () => undefined, moveToNewWindow: () => undefined, platform: 'darwin', setKeepAwake: () => undefined }
});

const { appCommands } = await import('@/shell/commands');
const { useWindow } = await import('@/state/window');
const { useProject } = await import('@/state/project');
const { useDocument } = await import('@/state/document');
const { defaultCanvasStore } = await import('@/state/canvas');
const { useProvidersStore } = await import('@adecore/agents-react/state');
const { useLaunches } = await import('@/launches/state');
const { usePrWatches } = await import('@/state/pr-watches');

afterAll(() => {
    globals.window = previousWindow;
});

const ENDPOINT = 'local';
const PROJECT = 'p1';

function summary(scratch: boolean): ProjectSummary {
    return {
        projectId: PROJECT,
        name: 'Work',
        color: 'blue',
        folder: '/work',
        lastOpenedAt: 0,
        available: true,
        icon: { kind: 'lucide', value: 'folder' },
        nameSource: 'folder',
        ...(scratch ? { scratch: true } : {})
    } as ProjectSummary;
}

const CHAT_NODE = { id: 'n-chat', kind: 'chat', title: 'Chat', x: 0, y: 0, w: 100, h: 100 };
const GROUP_NODE = { id: 'n-group', kind: 'group', title: 'Group', x: 0, y: 0, w: 400, h: 400 };

const VIEWS = [
    { kind: 'canvas', id: 'c1', name: 'Main', nodes: [CHAT_NODE, GROUP_NODE], texts: [], edges: [], layouts: [] },
    { kind: 'canvas', id: 'c2', name: 'Other', nodes: [], texts: [], edges: [], layouts: [] },
    { kind: 'drawing', id: 'd1', name: 'Sketch' },
    { kind: 'diagram', id: 'g1', name: 'Flow' },
    { kind: 'chat', id: 'h1', name: 'Talk', node: {} },
    { kind: 'terminal', id: 't1', name: 'Shell', node: {} }
] as unknown as ProjectView[];

function layoutOn(viewId: string, tabs?: string[]): SplitLayout {
    return {
        columns: [
            { cells: [{ viewId, size: 1, ...(tabs ? { tabs } : {}) }], size: 0.5 },
            { cells: [{ viewId: 'c2', size: 1 }], size: 0.5 }
        ],
        focus: { column: 0, cell: 0 }
    };
}

const PROVIDERS = [
    { kind: 'claude', name: 'Claude Code', installed: true, capabilities: { chat: true, terminal: true } },
    { kind: 'codex', name: 'Codex', installed: false, capabilities: { chat: true, terminal: true } }
] as unknown as ProviderInfo[];

const LAUNCHES = {
    rev: 1,
    launches: [{ id: 'tests', name: 'Tests', kind: 'task', command: 'bun test' }],
    approved: [],
    afterSettle: { launchId: 'tests', approved: false }
} as unknown as LaunchesDocument;

interface Scenario {
    name: string;
    workspace: boolean;
    scratch?: boolean;
    view?: string;
    tabs?: string[];
    selection?: string[];
    maximized?: boolean;
    prRepos?: PrRepo[];
}

function arrange(scenario: Scenario): void {
    useWindow.setState({
        content: scenario.workspace ? { kind: 'workspace', workspace: { connection: { endpointId: ENDPOINT } } } : { kind: 'start' }
    } as never);
    useProject.setState({ current: scenario.workspace ? summary(scenario.scratch === true) : null, currentEndpointId: scenario.workspace ? ENDPOINT : null });
    const view = scenario.view ?? null;
    useDocument.setState({
        views: scenario.workspace ? VIEWS : [],
        activeViewId: view,
        layout: view === null ? null : layoutOn(view, scenario.tabs),
        maximized: scenario.maximized === true ? view : null
    });
    defaultCanvasStore.setState({
        viewId: 'c1',
        nodes: Object.fromEntries([CHAT_NODE, GROUP_NODE].map((node) => [node.id, node])),
        selection: scenario.selection ?? [],
        bodyFocusId: null,
        locks: {},
        layouts: [{ name: 'Review' }]
    } as never);
    useProvidersStore.setState({ byScope: { [ENDPOINT]: { providers: PROVIDERS } } } as never);
    useLaunches.setState({ documents: scenario.workspace ? { [`${ENDPOINT}:${PROJECT}`]: LAUNCHES } : {}, statuses: {} } as never);
    usePrWatches.setState({ byChat: { [`${ENDPOINT}:n-chat`]: {} } } as never);
}

function keysOf(shortcut: Shortcut | undefined): string {
    if (shortcut === undefined) {
        return '';
    }
    const modifiers = (['mod', 'ctrl', 'meta', 'alt', 'shift'] as const).filter((field) => shortcut[field]);
    return [...modifiers, shortcut.key].join('+');
}

const SCENARIOS: Scenario[] = [
    { name: 'start screen', workspace: false },
    { name: 'canvas with a chat selected', workspace: true, view: 'c1', selection: ['n-chat'] },
    { name: 'canvas with a group selected in a tab host', workspace: true, view: 'c1', tabs: ['d1', 'c1', 'g1'], selection: ['n-group'], maximized: true },
    {
        name: 'canvas with several repositories',
        workspace: true,
        view: 'c1',
        prRepos: [{ path: '/work/web', label: 'web' } as PrRepo, { path: '/work/api', label: 'api' } as PrRepo]
    },
    { name: 'drawing', workspace: true, view: 'd1' },
    { name: 'diagram in a single tab', workspace: true, view: 'g1', tabs: ['g1'] },
    { name: 'chat view', workspace: true, view: 'h1' },
    { name: 'Chats project', workspace: true, scratch: true, view: 'h1' }
];

describe('the palette', () => {
    for (const scenario of SCENARIOS) {
        test(`offers the same rows: ${scenario.name}`, () => {
            arrange(scenario);
            const rows = appCommands(scenario.prRepos ?? []).map((command) =>
                [command.id, command.label, command.hint ?? '', keysOf(command.shortcut), command.agent ?? ''].join(' | ')
            );
            expect(rows).toMatchSnapshot();
        });
    }
});
