import { describe, expect, test } from 'bun:test';
import { FS_READ_MAX_TEXT_BYTES, ProjectContentSchema } from '@ruimte/contracts';
import { MEASURE_VARIANTS, measureScene, sceneFacts } from './scene';

describe('the measurement scenes', () => {
    test('each preserves the benchmark fixture bytes across builds', () => {
        const hashes = {
            scene: '75eeadc69b903183ec1c13334c4aeea6cf2269427e13486b452db450cf6c0914',
            grid: 'e0950d1072eb7d537e68c870c460ae8f15d6102d46d4b3134bce538965f305cb',
            files: '8f37421c8f26f8bce749c77fcb7cb73b0536a45c309675ce7c7148b076b2d619',
            chats: 'a6febbc8ffd1db360e47b2390cc6d754de39f7bc6e9bd4a6773d4a63ffe3c4cd',
            terminals: '81d9fa753398bb8d2caabf7136f76a904e2fb423c11c7509d8f71fe24dece449'
        };
        for (const variant of MEASURE_VARIANTS) {
            expect(new Bun.CryptoHasher('sha256').update(JSON.stringify(measureScene(variant))).digest('hex')).toBe(hashes[variant]);
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
