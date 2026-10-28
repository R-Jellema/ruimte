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
    useSettings.getState().update({ pets: false });
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
});
