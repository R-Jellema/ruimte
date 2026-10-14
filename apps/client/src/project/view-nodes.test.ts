import { afterEach, describe, expect, test } from 'bun:test';
import type { ProjectCanvasView, ProjectView } from '@ruimte/contracts';
import { nodeRefsOfView, nodesOfView } from '@/project/view-nodes';
import { defaultCanvases } from '@/state/canvas';

function canvas(id: string, nodeIds: string[]): ProjectCanvasView {
    return {
        kind: 'canvas',
        id,
        name: id,
        nodes: nodeIds.map((nodeId) => ({ id: nodeId, kind: 'note', title: nodeId, x: 0, y: 0, w: 100, h: 80 })),
        texts: [],
        edges: [],
        layouts: []
    };
}

afterEach(() => {
    defaultCanvases.keep([]);
});

describe('nodesOfView', () => {
    test('is the document for a canvas that is not on screen', () => {
        const view = canvas('main', ['a']);
        expect(nodesOfView(view)).toBe(view.nodes);
    });

    test('is the editor for a canvas on screen, in its order, and the same list until a node changes', () => {
        const saved = canvas('main', ['a']);
        const editor = defaultCanvases.of('main');
        editor.getState().loadView(canvas('main', ['b', 'a']), null);
        const first = nodesOfView(saved);
        expect(first.map((node) => node.id)).toEqual(['b', 'a']);
        editor.setState({ selection: ['a'] });
        expect(nodesOfView(saved)).toBe(first);
        editor.getState().renameNode('a', 'Renamed');
        expect(nodesOfView(saved).map((node) => node.title)).toEqual(['b', 'Renamed']);
    });

    test('is the document while an editor made for the view has not loaded it yet', () => {
        const view = canvas('main', ['a']);
        defaultCanvases.of('main');
        expect(nodesOfView(view)).toBe(view.nodes);
    });

    test('is empty for a view that is no canvas', () => {
        expect(nodesOfView({ kind: 'chat', id: 'chat', name: 'Chat', node: {} } as ProjectView)).toEqual([]);
    });
});

describe('nodeRefsOfView', () => {
    test('counts a session view as the one node it is', () => {
        expect(nodeRefsOfView({ kind: 'terminal', id: 'term', name: 'Shell', node: {} } as ProjectView)).toEqual([
            { id: 'term', kind: 'terminal', title: 'Shell' }
        ]);
    });
});
