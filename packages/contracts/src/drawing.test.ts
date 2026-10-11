import { describe, expect, test } from 'bun:test';
import { type DrawingElement } from './drawing-host.ts';
import { ProjectDocumentSchema } from './project.ts';
import { duplicateIdIn } from './project-migrate.ts';
import { REQUEST_SCHEMAS } from './index.ts';

const rect: DrawingElement = { kind: 'rect', id: 'el-1', x: 0, y: 0, w: 160, h: 96, stroke: 'ink', strokeWidth: 2, seed: 7 };

describe('a drawing view in a project document', () => {
    const document = {
        version: 3,
        rev: 1,
        name: 'ruimte',
        color: '#7c74ff',
        views: [
            { kind: 'canvas', id: 'main', name: 'Canvas', nodes: [], texts: [], edges: [], layouts: [] },
            { kind: 'drawing', id: 'view-abc', name: 'Drawing' }
        ]
    };

    test('it parses and carries nothing but its id and name', () => {
        const parsed = ProjectDocumentSchema.parse(document);
        expect(parsed.views[1]).toEqual({ kind: 'drawing', id: 'view-abc', name: 'Drawing' });
    });

    test('element ids stay out of the project namespace, so only view and node ids collide', () => {
        const parsed = ProjectDocumentSchema.parse(document);
        expect(duplicateIdIn(parsed.views)).toBeNull();
    });
});

describe('the wire', () => {
    test('a save names the rev it was built on', () => {
        const payload = REQUEST_SCHEMAS['drawing.save'].payload.parse({
            projectId: 'p1',
            viewId: 'view-abc',
            baseRev: 3,
            content: { elements: [rect] }
        });
        expect(payload).toMatchObject({ baseRev: 3 });
        expect(REQUEST_SCHEMAS['drawing.save'].payload.safeParse({ projectId: 'p1', viewId: 'view-abc', content: { elements: [] } }).success).toBe(false);
    });
});
