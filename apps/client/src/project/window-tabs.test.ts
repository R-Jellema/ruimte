import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ProjectSummary } from '@ruimte/contracts';
import type { DesktopBridge } from '@/desktop/bridge';
import { useProject } from '@/state/project';
import { useSettings } from '@/state/settings';
import { useWindow } from '@/state/window';
import type { Workspace } from '@/transport/connections';
import {
    dragsWindow,
    keptTabs,
    moveTab,
    neighborOf,
    NO_TABS,
    parseTabsState,
    showNoTab,
    showTab,
    startWindowTabs,
    stepTab,
    useWindowTabs,
    withoutClosed,
    withoutTab,
    dropWindowTab,
    type TabsShell,
    type TabsPlace,
    type WindowTabs
} from './window-tabs';

function memoryPlace(initial: string | null = null): TabsPlace & { written: (string | null)[] } {
    let current = initial;
    const written: (string | null)[] = [];
    return {
        written,
        read: () => current,
        write: (state) => {
            current = state;
            written.push(state);
        }
    };
}

const tabs = (keys: string[], active: string | null): WindowTabs => ({ keys, active });

describe('the tabs of a window', () => {
    test('a new project goes right after the tab in front', () => {
        expect(showTab(tabs(['a', 'b', 'c'], 'a'), 'd')).toEqual(tabs(['a', 'd', 'b', 'c'], 'd'));
        expect(showTab(NO_TABS, 'a')).toEqual(tabs(['a'], 'a'));
    });

    test('a project the window had already is picked, not added again', () => {
        expect(showTab(tabs(['a', 'b'], 'a'), 'b')).toEqual(tabs(['a', 'b'], 'b'));
    });

    test('with no tab in front a new project goes at the end', () => {
        expect(showTab(tabs(['a', 'b'], null), 'c')).toEqual(tabs(['a', 'b', 'c'], 'c'));
    });

    test('showing what has no tab keeps every tab', () => {
        expect(showNoTab(tabs(['a', 'b'], 'b'))).toEqual(tabs(['a', 'b'], null));
    });

    test('closing a tab takes it out and leaves nothing in front when it was', () => {
        expect(withoutTab(tabs(['a', 'b'], 'b'), 'b')).toEqual(tabs(['a'], null));
        expect(withoutTab(tabs(['a', 'b'], 'b'), 'a')).toEqual(tabs(['b'], 'b'));
    });

    test('a project this client closed loses its tab, wherever it was closed', () => {
        expect(withoutClosed(tabs(['a', 'b', 'c'], 'b'), new Set(['b']))).toEqual(tabs(['a', 'c'], null));
        const untouched = tabs(['a'], 'a');
        expect(withoutClosed(untouched, new Set(['z']))).toBe(untouched);
    });

    test('the neighbor of a closing tab is the one to its right, then its left', () => {
        expect(neighborOf(tabs(['a', 'b', 'c'], 'b'), 'b')).toBe('c');
        expect(neighborOf(tabs(['a', 'b', 'c'], 'c'), 'c')).toBe('b');
        expect(neighborOf(tabs(['a'], 'a'), 'a')).toBeNull();
    });

    test('stepping goes round the ends', () => {
        expect(stepTab(tabs(['a', 'b', 'c'], 'c'), 1)).toBe('a');
        expect(stepTab(tabs(['a', 'b', 'c'], 'a'), -1)).toBe('c');
        expect(stepTab(tabs(['a', 'b'], null), -1)).toBe('b');
        expect(stepTab(NO_TABS, 1)).toBeNull();
    });
});

describe('the tabs a window keeps', () => {
    test('read as a list of keys, each once', () => {
        expect(parseTabsState('["a","b","a"]')).toEqual(['a', 'b']);
    });

    test('read as no tabs when they are anything else', () => {
        expect(parseTabsState(null)).toEqual([]);
        expect(parseTabsState('not json')).toEqual([]);
        expect(parseTabsState('{"a":1}')).toEqual([]);
        expect(parseTabsState('[1,"",null,"a"]')).toEqual(['a']);
    });

    test('leave out the keys the caller refuses', () => {
        expect(parseTabsState('["local:a","m1:b"]', (key) => !key.startsWith('local:'))).toEqual(['m1:b']);
    });
});

describe('moving and keeping tabs', () => {
    test('a tab moves to another place among them', () => {
        expect(moveTab(tabs(['a', 'b', 'c'], 'a'), 'a', 2)).toEqual(tabs(['b', 'c', 'a'], 'a'));
        expect(moveTab(tabs(['a', 'b', 'c'], 'a'), 'c', 0)).toEqual(tabs(['c', 'a', 'b'], 'a'));
        const same = tabs(['a', 'b'], 'a');
        expect(moveTab(same, 'a', 0)).toBe(same);
    });

    test('only the project on screen, as the one tab, takes its window along when dragged', () => {
        expect(dragsWindow(['a'], 'a', 'a')).toBe(true);
        expect(dragsWindow(['a', 'b'], 'a', 'a')).toBe(false);
        expect(dragsWindow(['a', 'b'], 'a', 'b')).toBe(false);
        expect(dragsWindow(['a'], null, 'a')).toBe(false);
    });

    test('a tab another window keeps goes, but never the one on screen', () => {
        expect(keptTabs(tabs(['a', 'b', 'c'], 'a'), ['c'])).toEqual(tabs(['a', 'c'], 'a'));
        const all = tabs(['a', 'b'], 'a');
        expect(keptTabs(all, ['a', 'b'])).toBe(all);
    });
});

function summary(projectId: string, scratch = false): ProjectSummary {
    return { projectId, name: projectId, ...(scratch ? { scratch: true } : {}) } as ProjectSummary;
}

function show(projectId: string | null, scratch = false): void {
    if (projectId === null) {
        useWindow.setState({ content: { kind: 'start' } });
        useProject.setState({ current: null, currentEndpointId: null });
        return;
    }
    useWindow.setState({ content: { kind: 'workspace', workspace: {} as Workspace } });
    useProject.setState({ current: summary(projectId, scratch), currentEndpointId: 'local' });
}

function fakeShell(refuse: string[] = []): TabsShell & { held: string[][]; show(key: string): void; take(key: string): void; release(key: string): void } {
    const held: string[][] = [];
    let onShow: ((key: string) => void) | null = null;
    let onTake: ((key: string, x: number | null) => void) | null = null;
    let onRelease: ((key: string) => void) | null = null;
    return {
        held,
        holdTabs: async (keys) => {
            held.push(keys);
            return keys.filter((key) => !refuse.includes(key));
        },
        onShowProject: (listener) => {
            onShow = listener;
            return () => {
                onShow = null;
            };
        },
        onTakeProject: (listener) => {
            onTake = listener;
            return () => {
                onTake = null;
            };
        },
        onReleaseProject: (listener) => {
            onRelease = listener;
            return () => {
                onRelease = null;
            };
        },
        onTabDragOver: () => () => undefined,
        show: (key) => onShow?.(key),
        take: (key) => onTake?.(key, null),
        release: (key) => onRelease?.(key)
    };
}

describe('following the window', () => {
    const scope = globalThis as unknown as { window?: { ruimteDesktop?: Partial<DesktopBridge> } };
    let stop: (() => void) | null = null;
    const previousNavigation = useSettings.getState().projectNavigation;

    // The keys name this computer's machine, so the window is the desktop app's with one.
    beforeEach(() => {
        scope.window = { ruimteDesktop: { platform: 'darwin' } };
    });

    afterEach(() => {
        delete scope.window;
        stop?.();
        stop = null;
        show(null);
        useSettings.setState({ projectNavigation: previousNavigation });
    });

    async function start(place = memoryPlace(), shell = fakeShell()) {
        const opened: string[] = [];
        const switching = { busy: false, listeners: [] as (() => void)[] };
        useSettings.setState({ projectNavigation: 'tabs' });
        stop = startWindowTabs({
            place,
            shell: () => shell,
            open: (key) => void opened.push(key),
            switches: async () => ({
                busy: () => switching.busy,
                subscribe: (listener) => {
                    switching.listeners.push(listener);
                    return () => undefined;
                }
            })
        });
        await Promise.resolve();
        await Promise.resolve();
        const setSwitching = (busy: boolean): void => {
            switching.busy = busy;
            for (const listener of switching.listeners) {
                listener();
            }
        };
        return { place, shell, opened, setSwitching };
    }

    test('adds every project the window opens and keeps them through the Chats project', async () => {
        await start();
        show('a');
        show('b');
        show('chats', true);
        expect(useWindowTabs.getState().tabs).toEqual(tabs(['local:a', 'local:b'], null));
        show('a');
        expect(useWindowTabs.getState().tabs).toEqual(tabs(['local:a', 'local:b'], 'local:a'));
    });

    test('brings back the tabs its window kept, and writes them as they change', async () => {
        const place = memoryPlace('["local:a","local:b"]');
        await start(place);
        expect(useWindowTabs.getState().tabs).toEqual(tabs(['local:a', 'local:b'], null));
        show('b');
        expect(useWindowTabs.getState().tabs).toEqual(tabs(['local:a', 'local:b'], 'local:b'));
        expect(place.written).toEqual([]);
        show('c');
        expect(place.written).toEqual(['["local:a","local:b","local:c"]']);
    });

    test('does nothing while the switcher is chosen, and lets go when it is chosen again', () => {
        useSettings.setState({ projectNavigation: 'switcher' });
        stop = startWindowTabs({
            place: memoryPlace(),
            shell: () => null,
            open: () => undefined,
            switches: async () => ({ busy: () => false, subscribe: () => () => undefined })
        });
        show('a');
        expect(useWindowTabs.getState().tabs).toEqual(NO_TABS);
        useSettings.setState({ projectNavigation: 'tabs' });
        expect(useWindowTabs.getState().tabs).toEqual(tabs(['local:a'], 'local:a'));
        useSettings.setState({ projectNavigation: 'switcher' });
        expect(useWindowTabs.getState().tabs).toEqual(NO_TABS);
    });

    test('tells the shell the tabs it keeps and lets go of one another window keeps', async () => {
        const shell = fakeShell(['local:b']);
        await start(memoryPlace('["local:a","local:b"]'), shell);
        show('a');
        await Promise.resolve();
        await Promise.resolve();
        expect(shell.held[0]).toEqual(['local:a', 'local:b']);
        expect(useWindowTabs.getState().tabs).toEqual(tabs(['local:a'], 'local:a'));
    });

    test('shows a tab the shell asks for, and takes in one dropped from another window', async () => {
        const { shell, opened } = await start();
        show('a');
        shell.show('local:a');
        shell.take('local:c');
        expect(opened).toEqual(['local:a', 'local:c']);
        expect(useWindowTabs.getState().tabs.keys).toEqual(['local:a', 'local:c']);
    });

    test('a tab that left while the window still shows it stays gone until the window moves on', async () => {
        const { setSwitching } = await start();
        show('a');
        show('b');
        setSwitching(true);
        dropWindowTab('local:b');
        show('b');
        expect(useWindowTabs.getState().tabs).toEqual(tabs(['local:a'], null));
        show('a');
        setSwitching(false);
        show('b');
        expect(useWindowTabs.getState().tabs.keys).toEqual(['local:a', 'local:b']);
    });

    test('a tab dragged in and straight out again stays gone while the window is still on its way to it', async () => {
        const { shell, setSwitching } = await start();
        show('a');
        setSwitching(true);
        shell.take('local:c');
        shell.release('local:c');
        show('c');
        expect(useWindowTabs.getState().tabs.keys).toEqual(['local:a']);
        show('a');
        setSwitching(false);
        expect(useWindowTabs.getState().tabs).toEqual(tabs(['local:a'], 'local:a'));
    });

    test('a tab dragged in and out again goes, and what was in front comes back', async () => {
        const { shell, opened } = await start();
        show('a');
        shell.take('local:c');
        shell.release('local:c');
        expect(useWindowTabs.getState().tabs.keys).toEqual(['local:a']);
        expect(opened).toEqual(['local:c', 'local:a']);
    });
});
