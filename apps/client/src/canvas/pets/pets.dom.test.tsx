import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import type { ProjectCanvasView, ProjectNode } from '@ruimte/contracts';
import { canvasOfNode } from '@/state/canvas';
import { useSettings } from '@/state/settings';
import { useUi } from '@/state/ui';
import { chatInfoOf } from '../../../testing/chat-info';
import { FakeMachine } from '../../../testing/fake-machine';
import { clickOn, until } from '../../../testing/dom';
import { openCanvasPage, type CanvasPage } from '../../../testing/canvas-page';

const WRITER: ProjectNode = { id: 'writer', kind: 'chat', title: 'Writer', x: 2000, y: 1000, w: 480, h: 520 };
const PLAN: ProjectNode = { id: 'plan', kind: 'note', title: 'Plan', body: 'Ship it', x: 0, y: 0, w: 400, h: 320 };
const MAIN: ProjectCanvasView = { kind: 'canvas', id: 'main', name: 'Main', nodes: [PLAN, WRITER], texts: [], edges: [], layouts: [] };
const VIEWPORT = { w: 1280, h: 800 };

let machine: FakeMachine;
let canvas: CanvasPage;

function pet(id: string): HTMLElement | null {
    return canvas.page.host.querySelector(`[data-pet="${id}"]`);
}

function petsSwitch(): HTMLElement | null {
    return document.querySelector('[role="switch"][aria-label="Pets"]');
}

function store() {
    return canvasOfNode(PLAN.id)!;
}

async function open(): Promise<void> {
    canvas = await openCanvasPage(machine, [MAIN], PLAN.id);
    await act(async () => {
        store().getState().setViewport(VIEWPORT);
        store().getState().setCamera({ x: 0, y: 0, zoom: 1 });
    });
}

beforeEach(() => {
    machine = new FakeMachine();
});

afterEach(async () => {
    await act(async () => useUi.getState().setSettings({ open: false }));
    await canvas.close();
    useSettings.getState().update({ pets: false, petsPlace: 'nodes', petsSets: ['buddies'], petsVisitor: true });
});

describe('pets on a canvas', () => {
    test('stay away until a person turns them on in Settings, Views, and go again when they turn them off', async () => {
        await open();
        await act(async () => machine.emit('chat.status', { chatId: WRITER.id, info: chatInfoOf(WRITER.id) }));
        expect(pet(WRITER.id)).toBeNull();

        await act(async () => useUi.getState().setSettings({ open: true, section: 'views' }));
        await until(() => petsSwitch() !== null);
        expect(petsSwitch()?.getAttribute('aria-checked')).toBe('false');

        await clickOn(petsSwitch());
        await until(() => pet(WRITER.id) !== null);
        // A note has no agent, so no pet.
        expect(pet(PLAN.id)).toBeNull();

        await clickOn(petsSwitch());
        await until(() => pet(WRITER.id) === null);
    });

    test('the visitor is on until a person turns it off in Settings, Views', async () => {
        await open();
        await act(async () => useUi.getState().setSettings({ open: true, section: 'views' }));
        const visitorSwitch = (): HTMLElement | null => document.querySelector('[role="switch"][aria-label="Visitor"]');
        await until(() => visitorSwitch() !== null);
        expect(visitorSwitch()?.getAttribute('aria-checked')).toBe('true');

        await clickOn(visitorSwitch());
        await until(() => useSettings.getState().petsVisitor === false);
    });

    test('a person picks several sets of figures in Settings, Views, and never none', async () => {
        await open();
        await act(async () => useUi.getState().setSettings({ open: true, section: 'views' }));
        const setBox = (label: string): HTMLElement | null => document.querySelector(`[role="checkbox"][aria-label="${label}"]`);
        await until(() => setBox('Buddies') !== null);
        expect(setBox('Buddies')?.getAttribute('aria-checked')).toBe('true');
        expect(setBox('Fox and frog')?.getAttribute('aria-checked')).toBe('false');
        // The only set picked cannot be left out.
        expect(setBox('Buddies')?.hasAttribute('data-disabled')).toBe(true);

        await clickOn(setBox('Fox and frog')?.closest('label') ?? null);
        await until(() => setBox('Fox and frog')?.getAttribute('aria-checked') === 'true');
        expect(useSettings.getState().petsSets).toEqual(['buddies', 'animals']);

        await clickOn(setBox('Buddies')?.closest('label') ?? null);
        await until(() => setBox('Buddies')?.getAttribute('aria-checked') === 'false');
        expect(useSettings.getState().petsSets).toEqual(['animals']);
        expect(setBox('Fox and frog')?.hasAttribute('data-disabled')).toBe(true);
    });

    test('a chat that waits on you has a pet that says so, until the question is answered', async () => {
        useSettings.getState().update({ pets: true });
        await open();
        await act(async () => machine.emit('chat.status', { chatId: WRITER.id, info: chatInfoOf(WRITER.id) }));
        await until(() => pet(WRITER.id) !== null);
        expect(pet(WRITER.id)?.getAttribute('data-pet-mood')).toBe('idle');

        await act(async () => machine.emit('chat.status', { chatId: WRITER.id, info: chatInfoOf(WRITER.id, { status: 'needs-you' }) }));
        await until(() => pet(WRITER.id)?.getAttribute('data-pet-mood') === 'waiting');
        expect(pet(WRITER.id)?.getAttribute('aria-label')).toBe('Writer needs you');

        await act(async () => machine.emit('chat.status', { chatId: WRITER.id, info: chatInfoOf(WRITER.id) }));
        await until(() => pet(WRITER.id)?.getAttribute('data-pet-mood') === 'idle');
        expect(pet(WRITER.id)?.getAttribute('aria-label')).toBe('Go to Writer');
    });

    test('a pet standing on the node above takes no press, so the bottom of that node stays its own', async () => {
        // happy-dom does no hit testing, so this holds what decides it: the box that takes a press and whether it takes one.
        const upper: ProjectNode = { id: 'upper', kind: 'chat', title: 'Upper', x: 0, y: 0, w: 480, h: 300 };
        const close: ProjectNode = { id: 'close', kind: 'chat', title: 'Close', x: 0, y: 310, w: 480, h: 300 };
        const spaced: ProjectNode = { id: 'spaced', kind: 'chat', title: 'Spaced', x: 600, y: 340, w: 480, h: 300 };
        const above: ProjectNode = { id: 'above', kind: 'chat', title: 'Above', x: 600, y: 0, w: 480, h: 300 };
        useSettings.getState().update({ pets: true });
        canvas = await openCanvasPage(machine, [{ ...MAIN, nodes: [PLAN, upper, close, above, spaced] }], PLAN.id);
        await act(async () => {
            for (const node of [upper, close, above, spaced]) {
                machine.emit('chat.status', { chatId: node.id, info: chatInfoOf(node.id) });
            }
        });
        await until(() => pet(spaced.id) !== null && pet(close.id) !== null);

        expect(pet(close.id)?.hasAttribute('data-pet-blocked')).toBe(true);
        expect(pet(close.id)?.classList.contains('pointer-events-none')).toBe(true);
        // Forty pixels apart, the gap new nodes get, the figure stands clear of the node above and takes its press.
        expect(pet(spaced.id)?.hasAttribute('data-pet-blocked')).toBe(false);
        expect(pet(spaced.id)?.classList.contains('pointer-events-auto')).toBe(true);
        expect(pet(spaced.id)?.style.height).toBe('38px');
    });

    test('a click on a pet brings its node to the middle of the view and selects it', async () => {
        useSettings.getState().update({ pets: true });
        await open();
        await act(async () => machine.emit('chat.status', { chatId: WRITER.id, info: chatInfoOf(WRITER.id, { status: 'needs-you' }) }));
        await until(() => pet(WRITER.id) !== null);

        await clickOn(pet(WRITER.id));

        const camera = store().getState().camera;
        expect(store().getState().selection).toEqual([WRITER.id]);
        expect((VIEWPORT.w / 2 - camera.x) / camera.zoom).toBeCloseTo(WRITER.x + WRITER.w / 2);
        expect((VIEWPORT.h / 2 - camera.y) / camera.zoom).toBeCloseTo(WRITER.y + WRITER.h / 2);
    });

    test('along the bottom of the screen, a pet leaves its node and still leads to it', async () => {
        useSettings.getState().update({ pets: true, petsPlace: 'screen' });
        await open();
        await act(async () => machine.emit('chat.status', { chatId: WRITER.id, info: chatInfoOf(WRITER.id) }));
        const roaming = (): HTMLElement | null => document.querySelector(`[data-pet-roam] [data-pet="${WRITER.id}"]`);
        await until(() => roaming() !== null);
        expect(document.querySelectorAll(`[data-pet="${WRITER.id}"]`)).toHaveLength(1);
        expect(roaming()?.getAttribute('aria-label')).toBe('Go to Writer');

        await clickOn(roaming());

        expect(store().getState().selection).toEqual([WRITER.id]);
    });
});
