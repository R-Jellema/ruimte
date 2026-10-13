import { afterEach, describe, expect, test } from 'bun:test';
import { NO_TABS, useWindowTabs } from './window-tabs';
import { moveToNewWindow, outsideViewport, wantsNewWindow, type MoveDeps } from './windows';

function spyMove(over: Partial<MoveDeps> = {}): { deps: Partial<MoveDeps>; steps: string[] } {
    const steps: string[] = [];
    return {
        steps,
        deps: {
            shell: {
                moveToNewWindow: async () => {
                    steps.push('move');
                    return true;
                }
            },
            hasProject: () => true,
            confirm: async () => true,
            flush: async () => {
                steps.push('flush');
            },
            leave: async () => {
                steps.push('leave');
            },
            toStart: () => {
                steps.push('start');
            },
            shownKey: () => 'local:a',
            showTab: async (key) => {
                steps.push(`show ${key}`);
            },
            ...over
        }
    };
}

describe('moving the project to a new window', () => {
    afterEach(() => useWindowTabs.setState({ tabs: NO_TABS }));

    test('with tabs the window goes on to the tab beside it, and the moved one leaves its tabs', async () => {
        useWindowTabs.setState({ tabs: { keys: ['local:a', 'local:b'], active: 'local:a' } });
        const { deps, steps } = spyMove();
        expect(await moveToNewWindow(deps)).toBe(true);
        expect(steps).toEqual(['flush', 'move', 'show local:b']);
        expect(useWindowTabs.getState().tabs.keys).toEqual(['local:b']);
    });

    test('hands the shell the point the new window goes to', async () => {
        const points: unknown[] = [];
        const { deps } = spyMove({
            shell: {
                moveToNewWindow: async (at) => {
                    points.push(at);
                    return true;
                }
            }
        });
        await moveToNewWindow({ ...deps, at: { x: 5, y: 6 } });
        expect(points).toEqual([{ x: 5, y: 6 }]);
    });

    test('writes what is on screen, hands the project over, and only then lets go of it', async () => {
        const { deps, steps } = spyMove();
        expect(await moveToNewWindow(deps)).toBe(true);
        expect(steps).toEqual(['flush', 'move', 'leave', 'start']);
    });

    test('a shell that did not hand it over leaves the window as it was', async () => {
        const { deps, steps } = spyMove({
            shell: {
                moveToNewWindow: async () => {
                    steps.push('move');
                    return false;
                }
            }
        });
        expect(await moveToNewWindow(deps)).toBe(false);
        expect(steps).toEqual(['flush', 'move']);
    });

    test('staying with a conflict moves nothing', async () => {
        const { deps, steps } = spyMove({ confirm: async () => false });
        expect(await moveToNewWindow(deps)).toBe(false);
        expect(steps).toEqual([]);
    });

    test('a save that cannot be written does not keep the project from moving', async () => {
        const { deps, steps } = spyMove({ flush: () => Promise.reject(new Error('conflict')) });
        expect(await moveToNewWindow(deps)).toBe(true);
        expect(steps).toEqual(['move', 'leave', 'start']);
    });

    test('nothing moves from the start screen or without a shell that keeps windows', async () => {
        expect(await moveToNewWindow(spyMove({ hasProject: () => false }).deps)).toBe(false);
        expect(await moveToNewWindow(spyMove({ shell: null }).deps)).toBe(false);
        expect(await moveToNewWindow(spyMove({ shell: {} }).deps)).toBe(false);
    });
});

describe('wantsNewWindow', () => {
    const shell = { openWindow: () => undefined };

    test('is Cmd on macOS and Ctrl elsewhere', () => {
        expect(wantsNewWindow({ metaKey: true, ctrlKey: false }, true, shell)).toBe(true);
        expect(wantsNewWindow({ metaKey: false, ctrlKey: true }, true, shell)).toBe(false);
        expect(wantsNewWindow({ metaKey: false, ctrlKey: true }, false, shell)).toBe(true);
        expect(wantsNewWindow({ metaKey: true, ctrlKey: false }, false, shell)).toBe(false);
    });

    test('is never true where no shell opens windows', () => {
        expect(wantsNewWindow({ metaKey: true, ctrlKey: true }, true, null)).toBe(false);
    });
});

describe('letting go of a tab outside the window', () => {
    const size = { innerWidth: 800, innerHeight: 600 };

    test('is outside past any edge and inside on the edge itself', () => {
        expect(outsideViewport(-1, 300, size)).toBe(true);
        expect(outsideViewport(400, 601, size)).toBe(true);
        expect(outsideViewport(0, 0, size)).toBe(false);
        expect(outsideViewport(800, 600, size)).toBe(false);
    });
});
