import { create } from 'zustand';
import { isRecentProject } from '@ruimte/contracts';
import { WINDOW_STATE_PARAM } from '@ruimte/desktop-bridge';
import { desktop, type DesktopBridge } from '@/desktop/bridge';
import { endpointKey, splitKey } from '@/state/keys';
import { isRealMachine } from '@/state/local-machine';
import { isScratchProject, useProject } from '@/state/project';
import { useProjectList } from '@/state/project-list';
import { useSettings } from '@/state/settings';
import { useWindow } from '@/state/window';

/* The projects this window opened, as `endpointKey`s in the order of its tabs, and the one on screen. */
export interface WindowTabs {
    keys: string[];
    /* Null on the start screen and in the Chats project, which has no tab. */
    active: string | null;
}

export const NO_TABS: WindowTabs = { keys: [], active: null };

/* A project the window already had is picked; a new one goes right after the tab that was in front. */
export function showTab(tabs: WindowTabs, key: string): WindowTabs {
    if (tabs.keys.includes(key)) {
        return tabs.active === key ? tabs : { ...tabs, active: key };
    }
    const after = tabs.active === null ? tabs.keys.length : tabs.keys.indexOf(tabs.active) + 1;
    return { keys: [...tabs.keys.slice(0, after), key, ...tabs.keys.slice(after)], active: key };
}

/* What the window shows has no tab; the tabs stay, since leaving one is not closing it. */
export function showNoTab(tabs: WindowTabs): WindowTabs {
    return tabs.active === null ? tabs : { ...tabs, active: null };
}

export function withoutTab(tabs: WindowTabs, key: string): WindowTabs {
    if (!tabs.keys.includes(key)) {
        return tabs;
    }
    return { keys: tabs.keys.filter((one) => one !== key), active: tabs.active === key ? null : tabs.active };
}

/* Takes out the tabs of the projects this client closed, in this window or another. */
export function withoutClosed(tabs: WindowTabs, closed: ReadonlySet<string>): WindowTabs {
    if (!tabs.keys.some((key) => closed.has(key))) {
        return tabs;
    }
    return {
        keys: tabs.keys.filter((key) => !closed.has(key)),
        active: tabs.active !== null && closed.has(tabs.active) ? null : tabs.active
    };
}

/* The tab that comes to the front when `key` closes: the one to its right, or else the one to its left. */
export function neighborOf(tabs: WindowTabs, key: string): string | null {
    const index = tabs.keys.indexOf(key);
    if (index === -1) {
        return null;
    }
    return tabs.keys[index + 1] ?? tabs.keys[index - 1] ?? null;
}

/* The tabs with `key` moved to `index` among them. */
export function moveTab(tabs: WindowTabs, key: string, index: number): WindowTabs {
    const from = tabs.keys.indexOf(key);
    const to = Math.max(0, Math.min(index, tabs.keys.length - 1));
    if (from === -1 || from === to) {
        return tabs;
    }
    const keys = tabs.keys.filter((one) => one !== key);
    keys.splice(to, 0, key);
    return { ...tabs, keys };
}

/* The tabs that are left of the ones a window asked to keep, in their order. */
export function keptTabs(tabs: WindowTabs, kept: readonly string[]): WindowTabs {
    const refused = tabs.keys.filter((key) => !kept.includes(key) && key !== tabs.active);
    return refused.length === 0 ? tabs : { ...tabs, keys: tabs.keys.filter((key) => !refused.includes(key)) };
}

/* The tab `step` places from the one in front, round the ends; the first or the last when none is. */
export function stepTab(tabs: WindowTabs, step: 1 | -1): string | null {
    const count = tabs.keys.length;
    if (count === 0) {
        return null;
    }
    const index = tabs.active === null ? -1 : tabs.keys.indexOf(tabs.active);
    if (index === -1) {
        return tabs.keys[step === 1 ? 0 : count - 1]!;
    }
    return tabs.keys[(index + step + count) % count]!;
}

/*
 * Where a window keeps its tabs: its own address, which a reload keeps, and the shell's session,
 * which hands them back in the address of the window it opens again at the next start.
 */
export interface TabsPlace {
    read(): string | null;
    write(state: string | null): void;
}

/* `keep` leaves out the keys it refuses, such as the projects of a machine this app no longer runs. */
export function parseTabsState(state: string | null, keep: (key: string) => boolean = () => true): string[] {
    if (state === null) {
        return [];
    }
    try {
        const keys = JSON.parse(state) as unknown;
        return Array.isArray(keys) ? [...new Set(keys.filter((key): key is string => typeof key === 'string' && key !== '' && keep(key)))] : [];
    } catch {
        return [];
    }
}

function windowPlace(): TabsPlace | null {
    if (typeof location === 'undefined' || typeof history === 'undefined') {
        return null;
    }
    return {
        read: () => new URLSearchParams(location.search).get(WINDOW_STATE_PARAM),
        write: (state) => {
            const query = new URLSearchParams(location.search);
            if (state === null) {
                query.delete(WINDOW_STATE_PARAM);
            } else {
                query.set(WINDOW_STATE_PARAM, state);
            }
            const search = query.size === 0 ? '' : `?${query.toString()}`;
            if (search !== location.search) {
                history.replaceState(history.state, '', `${location.pathname}${search}${location.hash}`);
            }
            desktop()?.setWindowState?.(state);
        }
    };
}

/*
 * The shell's side of the tabs: it keeps every window's set, so a project is a tab of one window
 * only, and asks a window to show or to take one.
 */
export type TabsShell = Pick<DesktopBridge, 'holdTabs' | 'onShowProject' | 'onTakeProject' | 'onReleaseProject' | 'onTabDragOver'>;

interface WindowTabsState {
    tabs: WindowTabs;
}

export const useWindowTabs = create<WindowTabsState>(() => ({ tabs: NO_TABS }));

/* The project the window shows, as its tab key; null on the start screen and in the Chats project. */
function shownKey(): string | null {
    if (useWindow.getState().content.kind !== 'workspace') {
        return null;
    }
    const { current, currentEndpointId } = useProject.getState();
    if (current === null || currentEndpointId === null || isScratchProject(current)) {
        return null;
    }
    return endpointKey(currentEndpointId, current.projectId);
}

/* The pieces a test stands in for; the app passes none of them. */
export interface WindowTabsDeps {
    place: TabsPlace | null;
    /* Whether a switch of project is under way, and a call whenever that changes. */
    switches(): Promise<{ busy(): boolean; subscribe(listener: () => void): () => void }>;
    shell: () => TabsShell | null;
    open(key: string): void;
}

const REAL_DEPS: WindowTabsDeps = {
    place: windowPlace(),
    // Through a call: the switch reaches this module, so its exports are not in yet when this one loads.
    switches: async () => {
        const { projectSwitch } = await import('@/project/open');
        return {
            busy: () => projectSwitch.state.kind !== 'idle' && projectSwitch.state.kind !== 'failed',
            subscribe: (listener) => projectSwitch.store.subscribe(listener)
        };
    },
    shell: () => desktop(),
    open: (key) => {
        const { endpointId, id } = splitKey(key);
        void import('@/project/open').then(({ openProject }) => openProject(endpointId, id));
    }
};

let place: TabsPlace | null = null;
let shell: TabsShell | null = null;
/* Where along the strip a point lies, as the place a tab dragged there takes; the strip on screen sets it. */
let stripIndexAt: ((key: string, x: number) => number) | null = null;
/*
 * Tabs that left this window while it shows them or is on its way to them, as when one tears off or
 * is dragged in and straight out again. Until no switch is under way and the window shows another
 * project, what it shows is no reason to bring the tab back.
 */
const leaving = new Set<string>();

/* Whether a switch of project is under way in this window, which the switch itself answers once it loaded. */
let switching: () => boolean = () => false;

/* A tab dragged in from another window and the tab that was in front before it, which comes back if it goes again. */
let taken: { key: string; before: string | null } | null = null;

export function setStripIndexAt(locate: ((key: string, x: number) => number) | null): void {
    stripIndexAt = locate;
}

/* Tells the shell which projects the window keeps, and lets go of the ones another window keeps already. */
function hold(keys: string[]): void {
    void shell
        ?.holdTabs?.(keys)
        .then((kept) => {
            const { tabs } = useWindowTabs.getState();
            if (tabs.keys === keys) {
                commit(keptTabs(tabs, kept), false);
            }
        })
        .catch(() => undefined);
}

/* Sets the window's tabs and writes them where a reload, a restart and the shell find them. */
function commit(tabs: WindowTabs, tell = true): void {
    const previous = useWindowTabs.getState().tabs;
    if (tabs === previous) {
        return;
    }
    useWindowTabs.setState({ tabs });
    if (tabs.keys !== previous.keys) {
        place?.write(tabs.keys.length === 0 ? null : JSON.stringify(tabs.keys));
        if (tell) {
            hold(tabs.keys);
        }
    }
}

/* Takes a tab out of this window, without closing its project or showing another one. */
export function dropWindowTab(key: string): void {
    leaveTab(key, true);
}

/*
 * Takes out a tab the shell is about to detach into a window of its own. The shell lets go of it as
 * it detaches it, and finds nothing to detach of a tab this window already told it it left.
 */
export function detachWindowTab(key: string): void {
    leaveTab(key, false);
}

function leaveTab(key: string, tellShell: boolean): void {
    if (shownKey() === key) {
        leaving.add(key);
    }
    commit(withoutTab(useWindowTabs.getState().tabs, key), tellShell);
}

/* Puts the tabs back as they were, after a drag the shell did not start. */
export function restoreWindowTabs(tabs: WindowTabs): void {
    for (const key of tabs.keys) {
        leaving.delete(key);
    }
    commit(tabs);
}

/* Puts a tab at another place in the strip. */
export function reorderWindowTab(key: string, index: number): void {
    commit(moveTab(useWindowTabs.getState().tabs, key, index));
}

/*
 * Whether dragging `key` out of the strip takes its window along. Only the project on screen does,
 * as the one tab shown; a lone tab beside the start screen or the Chats project tears off instead.
 */
export function dragsWindow(shown: readonly string[], active: string | null, key: string): boolean {
    return shown.length === 1 && shown[0] === key && active === key;
}

/* Whether `key` is the one tab this window has. */
export function isOnlyTab(key: string): boolean {
    const { keys } = useWindowTabs.getState().tabs;
    return keys.length === 1 && keys[0] === key;
}

/*
 * The project this window shows next when the person closes `key`: the tab beside it, when it is the
 * tab in front. Null when there is none, and closing goes to the start screen as it always did.
 */
export function tabAfterClosing(key: string): string | null {
    const { tabs } = useWindowTabs.getState();
    return tabs.active === key ? neighborOf(tabs, key) : null;
}

/* A project closed elsewhere is under Recent in the list every window of this client reads. */
function closedKeys(): Set<string> {
    const closed = new Set<string>();
    for (const row of useProjectList.getState().projects) {
        if (isRecentProject(row.summary)) {
            closed.add(endpointKey(row.endpointId, row.summary.projectId));
        }
    }
    return closed;
}

function follow(): void {
    const key = shownKey();
    if (!switching()) {
        for (const gone of leaving) {
            if (gone !== key) {
                leaving.delete(gone);
            }
        }
    }
    const tabs = withoutClosed(useWindowTabs.getState().tabs, closedKeys());
    commit(key === null || leaving.has(key) ? showNoTab(tabs) : showTab(tabs, key));
}

/* A tab dragged over this window comes in where the pointer is, or at the end, and is shown at once. */
function take(key: string, x: number | null, open: (key: string) => void): void {
    leaving.delete(key);
    const { tabs } = useWindowTabs.getState();
    taken = { key, before: tabs.active === key ? null : tabs.active };
    const index = x === null || stripIndexAt === null ? tabs.keys.length : stripIndexAt(key, x);
    const others = tabs.keys.filter((one) => one !== key);
    commit({ ...tabs, keys: [...others.slice(0, index), key, ...others.slice(index)] });
    open(key);
}

/* The tab dragged in went on, still held: what was in front before it comes back. */
function release(key: string, open: (key: string) => void): void {
    const { tabs } = useWindowTabs.getState();
    const before = taken?.key === key ? taken.before : null;
    taken = null;
    const back = before !== null && tabs.keys.includes(before) ? before : neighborOf(tabs, key);
    // The window may show the tab already or be on its way to it, and goes back to `back` from either.
    leaving.add(key);
    commit(withoutTab(tabs, key));
    // The switch to the tab may still be on its way, so whether it is in front yet says nothing.
    if ((before !== null || tabs.active === key) && back !== null) {
        open(back);
    }
}

function dragOver(key: string, x: number): void {
    if (stripIndexAt !== null) {
        reorderWindowTab(key, stripIndexAt(key, x));
    }
}

/*
 * Keeps the window's tabs in step with the project it shows, while a person has tabs on. Every way
 * into a project (the switcher, the palette, a notification, the start screen) ends in the project
 * store, so following that store catches them all. Turned off, the window keeps no tabs with the
 * shell, and leaves them in its address, so turning tabs on again in this window brings them back.
 */
export function startWindowTabs(deps: WindowTabsDeps = REAL_DEPS): () => void {
    let offs: (() => void)[] | null = null;

    const on = (): void => {
        place = deps.place;
        shell = deps.shell();
        // A reload or a restart hands the page the tabs its window had.
        const keys = parseTabsState(place?.read() ?? null, (key) => isRealMachine(splitKey(key).endpointId));
        useWindowTabs.setState({ tabs: { keys, active: null } });
        hold(keys);
        offs = [
            useProject.subscribe(follow),
            useWindow.subscribe(follow),
            useProjectList.subscribe(follow),
            shell?.onShowProject?.((key) => deps.open(key)) ?? (() => undefined),
            shell?.onTakeProject?.((key, x) => take(key, x, deps.open)) ?? (() => undefined),
            shell?.onReleaseProject?.((key) => release(key, deps.open)) ?? (() => undefined),
            shell?.onTabDragOver?.(dragOver) ?? (() => undefined)
        ];
        follow();
        void deps.switches().then((watch) => {
            if (offs === null) {
                return;
            }
            switching = watch.busy;
            offs.push(watch.subscribe(follow));
        });
    };
    const off = (): void => {
        for (const stop of offs ?? []) {
            stop();
        }
        offs = null;
        leaving.clear();
        switching = () => false;
        void shell?.holdTabs?.([]).catch(() => undefined);
        place = null;
        shell = null;
        useWindowTabs.setState({ tabs: NO_TABS });
    };

    const apply = (enabled: boolean): void => {
        if (enabled && offs === null) {
            on();
        } else if (!enabled && offs !== null) {
            off();
        }
    };
    apply(useSettings.getState().projectNavigation === 'tabs');
    const offSettings = useSettings.subscribe((state) => apply(state.projectNavigation === 'tabs'));
    return () => {
        offSettings();
        off();
    };
}
