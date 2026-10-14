import { describe, expect, test } from 'bun:test';
import { EVENT_SCHEMAS, REQUEST_SCHEMAS } from './index.ts';
import { ProjectDocumentSchema, ProjectNodeOverlaySchema, storedViewsOf, type ProjectCanvasView, type ProjectNode, type ProjectView } from './project.ts';

/* A document as a newer Ruimte writes it: keys on every stored entry that this version has no field for. */
const NEWER_DOCUMENT = {
    version: 3,
    rev: 4,
    name: 'repo',
    color: '#7c74ff',
    views: [
        {
            kind: 'canvas',
            id: 'main',
            name: 'Canvas',
            futureView: { nested: [null, 42] },
            nodes: [
                { id: 'file', kind: 'file', title: 'File', x: 0, y: 0, w: 320, h: 200, path: 'a.ts', location: { line: 3 } },
                { kind: 'hologram', id: 'holo', title: 'Hologram', x: 600, y: 40, w: 480, h: 360, beam: { color: 'teal' } }
            ],
            texts: [{ id: 'label', x: 0, y: 240, text: 'Note', size: 16, futureStyle: 'wavy' }],
            edges: [],
            layouts: [
                {
                    name: 'Layout',
                    futureLayout: true,
                    nodes: { file: { x: 0, y: 0, w: 320, h: 200, futureRect: 1 } },
                    texts: { label: { x: 0, y: 240, futureRect: 2 } }
                }
            ]
        },
        { kind: 'chat', id: 'chat', name: 'Chat', futureView: 1, node: { cwd: 'src', futureFlag: true } },
        { kind: 'file', id: 'readme', name: 'Readme', path: 'README.md', futureView: 2 },
        { kind: 'separator', id: 'line', futureView: 3 }
    ]
};

function canvasOf(views: readonly ProjectView[]): ProjectCanvasView {
    return views[0] as ProjectCanvasView;
}

function expectKept(document: { views: readonly ProjectView[] }): void {
    const stored = storedViewsOf(document.views) as Record<string, unknown>[];
    const expected = NEWER_DOCUMENT.views as Record<string, unknown>[];
    expect(stored[0]!.futureView).toEqual(expected[0]!.futureView);
    const canvas = canvasOf(document.views);
    expect(canvas.nodes[0]).toMatchObject({ location: { line: 3 } });
    expect(canvas.texts[0]).toMatchObject({ futureStyle: 'wavy' });
    expect(canvas.layouts[0]).toMatchObject({ futureLayout: true, nodes: { file: { futureRect: 1 } }, texts: { label: { futureRect: 2 } } });
    expect(stored[1]).toMatchObject({ futureView: 1, node: { futureFlag: true } });
    expect(stored[2]).toMatchObject({ futureView: 2 });
    expect(stored[3]).toMatchObject({ futureView: 3 });
}

describe('fields of a stored entry this version does not know', () => {
    test('the document keeps them', () => {
        expectKept(ProjectDocumentSchema.parse(structuredClone(NEWER_DOCUMENT)));
    });

    test('a save, an open and a change event keep them', () => {
        const content = { name: 'repo', color: '', views: structuredClone(NEWER_DOCUMENT.views) };
        const saved = REQUEST_SCHEMAS['project.save'].payload.parse({ projectId: 'p', baseRev: 4, content });
        expectKept(saved.content);

        const opened = REQUEST_SCHEMAS['project.open'].result.parse({
            summary: {
                projectId: 'p',
                name: 'repo',
                color: '',
                folder: '/work/repo',
                lastOpenedAt: 0,
                available: true,
                icon: { kind: 'initial', value: 'R' },
                nameSource: 'folder'
            },
            document: structuredClone(NEWER_DOCUMENT),
            local: { activeViewId: null, views: {}, panels: {} }
        });
        expectKept(opened.document);

        const changed = EVENT_SCHEMAS['project.changed'].parse({ projectId: 'p', document: structuredClone(NEWER_DOCUMENT) });
        expectKept(changed.document);
    });

    test('the file view gets written out unchanged', () => {
        const document = ProjectDocumentSchema.parse(structuredClone(NEWER_DOCUMENT));
        const stored = storedViewsOf(document.views) as Record<string, unknown>[];
        expect(stored[2]).toEqual(NEWER_DOCUMENT.views[2] as never);
        expect(stored[3]).toEqual(NEWER_DOCUMENT.views[3] as never);
    });

    test('a node of an unknown kind still wraps around what it read', () => {
        const node = canvasOf(ProjectDocumentSchema.parse(structuredClone(NEWER_DOCUMENT)).views).nodes[1]!;
        expect(node).toMatchObject({ kind: 'unknown', id: 'holo', raw: { kind: 'hologram', beam: { color: 'teal' } } });
        expect(node).not.toHaveProperty('beam');
    });

    test('the overlay keeps a private field of a newer Ruimte', () => {
        expect(ProjectNodeOverlaySchema.parse({ cwd: 'src', machine: 'B' })).toEqual({ cwd: 'src', machine: 'B' } as never);
    });

    test('the types stay the known fields, so a typo fails the build', () => {
        const node: ProjectNode = {
            id: 'n',
            kind: 'note',
            title: 'Note',
            x: 0,
            y: 0,
            w: 1,
            h: 1,
            // @ts-expect-error a key this version does not know is not a field of the type
            location: { line: 1 }
        };
        expect(node.id).toBe('n');
    });
});
