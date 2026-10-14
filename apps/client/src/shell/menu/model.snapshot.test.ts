import { describe, expect, test } from 'bun:test';
import type { MenuNode } from '@ruimte/desktop-bridge';
import { menuIconOf } from './icons';
import { menuModel, type MenuContext } from './model';

const OFFERS = { duplicate: true, openInChat: true, openInTerminal: true, fork: true, putOnCanvas: true, showOnCanvas: true, reveal: true, share: true };

function context(patch: Partial<MenuContext> = {}): MenuContext {
    return {
        host: 'desktop',
        apple: true,
        workspace: true,
        folder: true,
        fileManager: 'Finder',
        view: 'canvas',
        offers: OFFERS,
        shared: false,
        selection: 1,
        promote: true,
        groupArrangeable: true,
        anyLocked: false,
        cells: 2,
        tabs: { hosted: false, count: 0, index: 0, splitOff: false },
        split: { right: true, down: false },
        maximized: false,
        nodeMaximizable: false,
        nodeMaximized: false,
        nodeZoomable: true,
        closesRight: true,
        panel: 'git',
        sidebar: true,
        views: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'],
        moveTargets: [{ id: 'v2', name: 'Other' }],
        layouts: ['Review', 'Focus'],
        agents: [
            { kind: 'claude', name: 'Claude Code', chat: true, terminal: true },
            { kind: 'codex', name: 'Codex', chat: true, terminal: false }
        ],
        launches: [
            { id: 'dev', name: 'Dev', live: true },
            { id: 'tests', name: 'Tests', live: false }
        ],
        chosenLaunch: 'dev',
        afterSettle: { tasks: [{ id: 'tests', name: 'Tests' }], chosen: null },
        releaseNotes: true,
        fullscreen: false,
        keepAwake: 'working',
        settingsOpen: false,
        windows: true,
        newChat: true,
        scratch: false,
        prWatch: false,
        chat: false,
        prRepos: [],
        ...patch
    };
}

const START_SCREEN = context({ workspace: false, folder: false, view: null, offers: null, views: [], layouts: [], cells: 0, launches: [], chosenLaunch: null });

const KINDS = ['canvas', 'drawing', 'diagram', 'chat', 'terminal', 'browser', 'file'] as const;

const CONTEXTS: [name: string, context: MenuContext][] = [
    ['start screen', START_SCREEN],
    ['start screen off macOS', { ...START_SCREEN, apple: false, keepAwake: null }],
    ['start screen on the station', { ...START_SCREEN, host: 'station', keepAwake: null, windows: false, releaseNotes: false }],
    ['start screen with the settings open', { ...START_SCREEN, settingsOpen: true, newChat: false }],
    ...KINDS.flatMap((view): [string, MenuContext][] => [
        [`${view} on macOS`, context({ view })],
        [`${view} off macOS`, context({ view, apple: false, keepAwake: null })],
        [`${view} on the station`, context({ view, host: 'station', keepAwake: null, windows: false, releaseNotes: false, fullscreen: true })]
    ]),
    [
        'a chat in a tab host',
        context({
            view: 'chat',
            chat: true,
            prWatch: true,
            shared: true,
            tabs: { hosted: true, count: 3, index: 1, splitOff: true },
            cells: 1,
            closesRight: false,
            prRepos: [
                { path: '/work/web', label: 'web' },
                { path: '/work/api', label: 'api' }
            ]
        })
    ],
    [
        'a canvas with a node maximized',
        context({ chat: true, nodeMaximizable: true, nodeMaximized: true, maximized: true, anyLocked: true, panel: 'processes', sidebar: false, selection: 0 })
    ],
    ['the Chats project', context({ view: 'chat', scratch: true, folder: false, offers: { ...OFFERS, reveal: false, share: false } })],
    [
        'the settings over a workspace',
        context({ settingsOpen: true, chosenLaunch: null, afterSettle: { tasks: [{ id: 'tests', name: 'Tests' }], chosen: 'tests' } })
    ],
    ['a workspace without cells', context({ view: null, offers: null, cells: 0, launches: [], chosenLaunch: null, afterSettle: { tasks: [], chosen: null } })],
    ['a workspace without cells on the station', context({ view: null, offers: null, cells: 0, host: 'station', apple: false, keepAwake: null })]
];

function iconName(id: string): string {
    const icon = menuIconOf(id);
    if (icon === null) {
        return '';
    }
    return 'agent' in icon ? `agent:${icon.agent}` : ((icon.icon as { displayName?: string }).displayName ?? '?');
}

function lines(nodes: readonly MenuNode[], depth: number): string[] {
    const indent = '  '.repeat(depth);
    return nodes.flatMap((node) => {
        switch (node.kind) {
            case 'separator':
                return [`${indent}---`];
            case 'role':
                return [`${indent}role ${node.role} | ${node.label}`];
            case 'shell':
                return [`${indent}shell ${node.action} | ${node.label}`];
            case 'submenu':
                return [`${indent}submenu ${node.id} | ${node.label} | ${node.enabled ?? ''} | ${iconName(node.id)}`, ...lines(node.items, depth + 1)];
            case 'command':
                return [
                    [
                        `${indent}${node.id}`,
                        node.label,
                        node.accelerator ?? '',
                        node.keys ?? '',
                        node.enabled ?? '',
                        node.checked ?? '',
                        node.radio ?? '',
                        iconName(node.id)
                    ].join(' | ')
                ];
        }
        return [];
    });
}

describe('the menu tree', () => {
    for (const [name, entry] of CONTEXTS) {
        test(`stays the same: ${name}`, () => {
            const spec = menuModel(entry);
            expect(spec.menus.flatMap((menu) => [`${menu.id} | ${menu.label} | ${iconName(menu.id)}`, ...lines(menu.items, 1)])).toMatchSnapshot();
        });
    }
});
