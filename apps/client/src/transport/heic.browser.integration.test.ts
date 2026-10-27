import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { withBrowserFixture } from '../../testing/browser-fixture';

test('HEIC images decode without unsafe-eval over HTTP and direct resources, and composer thumbnails render', async () => {
    const bytes = await readFile(new URL('../../../ios/Tests/Fixtures/Files/image.heic', import.meta.url));
    const encoded = bytes.toString('base64');

    await withBrowserFixture(
        `
        import { useMachineUrl } from ${JSON.stringify(join(import.meta.dir, 'machine-url.ts'))};
        import { useEndpoints } from ${JSON.stringify(join(import.meta.dir, '../state/endpoints.ts'))};
        import { pool } from ${JSON.stringify(join(import.meta.dir, 'index.ts'))};
        import { imageDocumentForDisplay, imageForDisplay } from ${JSON.stringify(Bun.resolveSync('@adecore/agents-react/images', import.meta.dir))};
        import { readAttachments } from ${JSON.stringify(join(dirname(Bun.resolveSync('@adecore/agents-react/images', import.meta.dir)), 'chat/attachments.ts'))};
        import { UploadThumb, DisplayImage } from ${JSON.stringify(Bun.resolveSync('@adecore/agents-react/chat/ui', import.meta.dir))};
        const bytes = Uint8Array.from(atob(${JSON.stringify(encoded)}), char => char.charCodeAt(0));
        const image = new Blob([bytes], {type:'image/heic'});
        const originalFetch = window.fetch.bind(window);
        window.fetch = async (url, options) => ['/fs/file','/attachments/','/projects/'].some(prefix=>new URL(String(url),location.href).pathname.startsWith(prefix)) ? new Response(image) : originalFetch(url, options);
        const transport = {
            status:'open', subscribeStatus:()=>()=>{}, subscribe:()=>()=>{},
            readBytes:async payload=>({mime:'image/heic',size:bytes.length,version:'1',offset:payload.offset,bytes:bytes.slice(payload.offset,payload.offset+payload.length)})
        };
        const open = {status:'open',attempts:0,retryAt:null};
        pool.peek=()=>transport; pool.statusOf=()=>open;
        useEndpoints.setState({activeId:'http',endpoints:['http','direct'].map(id=>({id,label:id,direct:id==='direct',httpBaseUrl:location.origin,wsBaseUrl:'ws://fixture.invalid',reachability:'lan',daemonId:null,daemonPublicKey:null}))});
        const resources = [
            ['http-file','http',{kind:'file',path:'/photo.bin',mtime:1,size:bytes.length,mime:'image/heic'}],
            ['direct-file','direct',{kind:'file',path:'/photo.bin',mtime:1,size:bytes.length,mime:'image/heic'}],
            ['attachment','http',{kind:'attachment',chatId:'chat',attachmentId:'image'}],
            ['icon','http',{kind:'projectIcon',projectId:'project',theme:'light',version:'1'}],
            ['archive','http',{kind:'archive-entry',path:'/photos.zip',entry:'photo.heic',mtime:1,size:bytes.length}],
            ['output','http',{kind:'artifact',artifactId:'art',versionId:'v',file:0}]
        ];
        function Picture({id,machine,resource}) {
            const source = useMachineUrl(resource,machine);
            return source.failure ? <span data-failed={id}>{source.failure}</span> : <DisplayImage id={id} src={source.url ?? undefined} />;
        }
        window.result = (async()=>{
            const png = await imageForDisplay(image);
            const bitmap = await createImageBitmap(png);
            const canvas = document.createElement('canvas'); canvas.width=bitmap.width; canvas.height=bitmap.height;
            const context=canvas.getContext('2d'); context.drawImage(bitmap,0,0);
            const dimensions=[bitmap.width,bitmap.height]; bitmap.close();
            const signature=Array.from(new Uint8Array(await png.slice(0,8).arrayBuffer()));
            const unchanged = await imageForDisplay(png) === png;
            const uploads = await readAttachments([new File([bytes], 'photo.HEIC')]);
            const uploadMime = uploads[0].mime;
            const html = '<img src="data:image/heic;base64,' + ${JSON.stringify(encoded)} + '">';
            const convertedHtml = await imageDocumentForDisplay(html);
            const embedded = convertedHtml.startsWith('<img src="data:image/png;base64,');
            let invalid = false;
            try { await imageForDisplay(new Blob(['broken'],{type:'image/heic'})); } catch { invalid = true; }
            createRoot(document.getElementById('root')).render(<>{resources.map(([id,machine,resource])=><Picture key={id} id={id} machine={machine} resource={resource}/>)}<UploadThumb upload={uploads[0]}/><DisplayImage id="remote" src={location.origin+'/fs/file?path=/remote.heic'}/></>);
            return {type:png.type,dimensions,signature,unchanged,embedded,invalid,uploadMime};
        })();
        `,
        '',
        async (view) => {
            const result = await view.evaluate<{
                type: string;
                dimensions: number[];
                signature: number[];
                unchanged: boolean;
                embedded: boolean;
                invalid: boolean;
                uploadMime: string;
            }>('window.result');
            expect(result.type).toBe('image/png');
            expect(result.signature).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
            expect(result.dimensions).toEqual([64, 48]);
            expect(result.unchanged).toBe(true);
            expect(result.embedded).toBe(true);
            expect(result.invalid).toBe(true);
            expect(result.uploadMime).toBe('image/heic');

            const rendered = await view.evaluate<number>(`new Promise(resolve => {
                const check = () => {
                    const images = [...document.querySelectorAll('img')];
                    if (images.length === 8 && images.every(image => image.complete && image.naturalWidth > 0)) { resolve(images.length); return; }
                    requestAnimationFrame(check);
                };
                check();
            })`);
            expect(rendered).toBe(8);
            expect(await view.evaluate<string[]>('window.errors')).toEqual([]);
        },
        {
            head: "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; worker-src blob:; img-src blob: data: http:; connect-src http: blob:\">"
        }
    );
});
