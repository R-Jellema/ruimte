import { describe, expect, test } from 'bun:test';
import { FS_READ_MAX_TEXT_BYTES, ProjectContentSchema } from '@ruimte/contracts';
import { MEASURE_VARIANTS, measureScene, sceneFacts } from './scene';

describe('the measurement scenes', () => {
    test('each is the same on every build', () => {
        for (const variant of MEASURE_VARIANTS) {
            expect(measureScene(variant)).toEqual(measureScene(variant));
        }
    });

    test('hold the counts the measurements name', () => {
        expect(sceneFacts(measureScene('scene')).nodes).toEqual({ terminal: 10, chat: 10, file: 10 });
        expect(sceneFacts(measureScene('grid')).nodes).toEqual({ terminal: 3, chat: 3, file: 3 });
        expect(sceneFacts(measureScene('files')).nodes).toEqual({ file: 10 });
        expect(sceneFacts(measureScene('chats')).nodes).toEqual({ chat: 100 });
        expect(sceneFacts(measureScene('terminals')).nodes).toEqual({ terminal: 16 });
    });

    test('lay the grid out three by three over its own views', () => {
        const scene = measureScene('grid');
        expect(scene.grid?.map((column) => column.length)).toEqual([3, 3, 3]);
        expect(new Set(scene.grid?.flat())).toEqual(new Set(scene.content.views.map((view) => view.id)));
    });

    test('are projects a daemon takes, with ids no other scene uses', () => {
        const ids = new Set<string>();
        for (const variant of MEASURE_VARIANTS) {
            const { content } = measureScene(variant);
            expect(ProjectContentSchema.safeParse(content).success).toBe(true);
            for (const view of content.views) {
                for (const id of view.kind === 'canvas' ? view.nodes.map((node) => node.id) : [view.id]) {
                    expect(ids.has(id) ? `${id} twice` : id).toBe(id);
                    ids.add(id);
                }
            }
        }
    });

    test('keep a large file under what a file request writes', () => {
        const facts = sceneFacts(measureScene('files'));
        expect(facts.fileLines).toBe(200_000);
        for (const file of measureScene('files').files) {
            expect(new TextEncoder().encode(file.text).length).toBeLessThan(FS_READ_MAX_TEXT_BYTES);
        }
    });
});
