import { expect, test } from 'bun:test';
import { runSmoke, smokeBrowser, smokeNode, withDevServer } from './testing/dev-smoke';

test.skipIf(smokeBrowser === null || smokeNode === null)(
    'the image save dialog selects project folders and replaces only after the explicit button',
    async () => {
        await withDevServer({}, async (_server, url) => {
            expect((await runSmoke(url, 'image-save')).saved).toEqual({
                saveDisabled: true,
                pathShown: true,
                saveBeforeReplace: 0,
                busyStaysOpen: true,
                savedPath: '/project/assets/rabbit.png',
                writes: [
                    {
                        type: 'chat.saveImage',
                        payload: { chatId: 'chat-original', attachmentId: 'image-original', path: '/project/assets/rabbit.png', replace: 'checked-image' }
                    }
                ]
            });
        });
    },
    30000
);
