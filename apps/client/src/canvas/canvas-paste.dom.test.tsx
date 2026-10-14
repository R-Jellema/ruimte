import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import type { ProjectCanvasView, ProjectNode } from '@ruimte/contracts';
import { focusedCanvas } from '@/state/canvas';
import { windowWorkspace } from '@/state/window';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { mount, until, type Mounted } from '../../testing/dom';

const PLAN: ProjectNode = { id: 'plan', kind: 'note', title: 'Plan', body: 'Ship it', x: 0, y: 0, w: 280, h: 200 };
const MAIN: ProjectCanvasView = { kind: 'canvas', id: 'main', name: 'Main', nodes: [PLAN], texts: [], edges: [], layouts: [] };

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

function surface(): HTMLElement | null {
    return page.host.querySelector('[data-canvas-surface]');
}

function noteNodes(): Element[] {
    return [...page.host.querySelectorAll('[data-node-id]')].filter((node) => node.getAttribute('data-node-id') !== PLAN.id);
}

/* What the platform's paste sends to what has the focus; answers whether something took it. */
async function pasteText(target: Element, text: string): Promise<boolean> {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', text);
    const event = new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true });
    await act(async () => {
        target.dispatchEvent(event);
    });
    return event.defaultPrevented;
}

/* The nodes of the canvas in the last save that went over the wire. */
function savedNodes(): ProjectNode[] {
    const saves = machine.requests('project.save');
    const view = saves.at(-1)?.content.views.find((candidate) => candidate.id === MAIN.id);
    return view?.kind === 'canvas' ? (view.nodes ?? []) : [];
}

beforeEach(async () => {
    machine = new FakeMachine();
    machine.answer('project.save', ({ baseRev }) => ({ rev: baseRev + 1 }) as never);
    workspace = await openFakeWorkspace(machine, { views: [MAIN] }, { activeViewId: MAIN.id, views: {} });
    page = mount();
    await page.renderApp();
    await until(() => surface() !== null && page.host.querySelector(`[data-node-id="${PLAN.id}"]`) !== null);
});

afterEach(async () => {
    await page.unmount();
    workspace.close();
});

describe('pasting text on a canvas', () => {
    test('makes a note under the pointer that a person sees and the machine saves', async () => {
        const camera = focusedCanvas().getState().camera;
        await act(async () => {
            surface()!.dispatchEvent(new PointerEvent('pointermove', { clientX: 600, clientY: 400, bubbles: true }));
        });
        expect(await pasteText(document.body, 'Call the printer\nabout the toner\n')).toBe(true);
        await until(() => noteNodes().length === 1);
        expect(noteNodes()[0]!.textContent).toContain('Call the printer');

        const note = Object.values(focusedCanvas().getState().nodes).find((node) => node.id !== PLAN.id)!;
        const middle = { x: (600 - camera.x) / camera.zoom, y: (400 - camera.y) / camera.zoom };
        expect(Math.abs(note.x + note.w / 2 - middle.x)).toBeLessThanOrEqual(16);
        expect(Math.abs(note.y + note.h / 2 - middle.y)).toBeLessThanOrEqual(16);

        await act(async () => windowWorkspace()!.connection.projects.flush());
        expect(savedNodes()).toContainEqual(
            expect.objectContaining({ id: note.id, kind: 'note', title: 'Call the printer', body: 'Call the printer\nabout the toner' })
        );
    });

    test('leaves the paste to a note being typed in', async () => {
        await act(async () => focusedCanvas().getState().activateNode(PLAN.id));
        await until(() => document.activeElement instanceof HTMLTextAreaElement);
        expect(await pasteText(document.activeElement!, 'Call the printer')).toBe(false);
        expect(Object.keys(focusedCanvas().getState().nodes)).toEqual([PLAN.id]);
    });

    test('makes nothing of blank text', async () => {
        expect(await pasteText(document.body, '  \n ')).toBe(false);
        expect(Object.keys(focusedCanvas().getState().nodes)).toEqual([PLAN.id]);
    });
});
