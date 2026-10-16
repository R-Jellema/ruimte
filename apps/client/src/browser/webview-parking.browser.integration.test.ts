import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { withBrowserFixture } from '../../testing/browser-fixture';

const frame = 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))';

test('parked browser pages leave the node border visible at every canvas zoom', async () => {
    const styles = await readFile(join(import.meta.dir, '../styles.css'), 'utf8');
    const hostStyles = styles.match(/\.browser-host(?:\[data-square\])?\s*\{[^}]+\}/g)!.join('\n');
    await withBrowserFixture(
        `
        import { WebviewParking } from ${JSON.stringify(join(import.meta.dir, 'WebviewParking.tsx'))};
        import { browserRegistry, useBrowser } from ${JSON.stringify(join(import.meta.dir, 'registry.ts'))};
        import { defaultCanvases } from ${JSON.stringify(join(import.meta.dir, '../state/canvas.ts'))};
        import { useDocument } from ${JSON.stringify(join(import.meta.dir, '../state/document.ts'))};
        import { registerCell } from ${JSON.stringify(join(import.meta.dir, '../shell/cell-rects.ts'))};
        window.ruimteDesktop={platform:'linux'};
        const guest=document.createElement('div');
        guest.dataset.guest='';
        guest.send=()=>{};
        browserRegistry.get=()=>guest;
        useBrowser.getState().patch('local:browser',{url:'https://example.com'});
        useDocument.setState({layout:{columns:[{size:1,cells:[{size:1,viewId:'main'}]}],focus:{column:0,cell:0}}});
        const canvas=defaultCanvases.of('main');
        canvas.setState({viewId:'main',nodes:{browser:{id:'browser',kind:'browser',title:'Browser',x:40,y:40,w:400,h:400}},order:['browser'],camera:{x:12,y:16,zoom:1}});
        window.fixture={canvas,guest,document:useDocument,registerCell};
        createRoot(document.getElementById('root')).render(<UIProvider i18n={i18next}>
            <div ref={element=>registerCell('main',element)} style={{position:'absolute',inset:0}}/>
            <WebviewParking/>
        </UIProvider>);
        `,
        `${hostStyles}:root{--radius-xl:12px}*{box-sizing:border-box}.absolute{position:absolute}.inset-0{inset:0}.top-0{top:0}.left-0{left:0}.origin-top-left{transform-origin:top left}.overflow-hidden{overflow:hidden}.pointer-events-none{pointer-events:none}`,
        async (view) => {
            for (const zoom of [1, 0.5, 1.5]) {
                await view.evaluate(`fixture.canvas.setState({camera:{x:12,y:16,zoom:${zoom}}})`);
                await view.evaluate(frame);
                const page = await view.evaluate<{ x: number; y: number; width: number; height: number }>(
                    'document.querySelector(".browser-host").getBoundingClientRect().toJSON()'
                );
                expect(page.x).toBe(12 + 41 * zoom);
                expect(page.y).toBe(16 + 117 * zoom);
                expect(page.width).toBe(398 * zoom);
                expect(page.height).toBe(322 * zoom);
            }
            expect(await view.evaluate<string>('getComputedStyle(document.querySelector(".browser-host")).borderBottomLeftRadius')).toBe('11px');
            await view.evaluate(`fixture.canvas.setState({camera:{x:12,y:16,zoom:1},bodyFocusId:'browser',nodes:{
                ...fixture.canvas.getState().nodes,
                cover:{id:'cover',kind:'note',title:'Cover',x:140,y:180,w:80,h:80}
            },order:['browser','cover']})`);
            await view.evaluate(frame);
            expect(await view.evaluate<boolean>('document.elementFromPoint(152.5,236)?.closest(".browser-host") === null')).toBe(true);
            expect(await view.evaluate<boolean>('!!document.elementFromPoint(151.5,236)?.closest(".browser-host")')).toBe(true);

            await view.evaluate('fixture.canvas.setState({maximizedId:"browser"})');
            await view.evaluate(frame);
            expect(
                await view.evaluate<number[]>(
                    '(() => {const rect=document.querySelector(".browser-host").getBoundingClientRect(); return [rect.x,rect.y,rect.width,rect.height];})()'
                )
            ).toEqual([0, 76, 800, 524]);
            expect(await view.evaluate<string>('getComputedStyle(document.querySelector(".browser-host")).borderBottomLeftRadius')).toBe('0px');

            await view.evaluate('fixture.canvas.setState({maximizedId:null})');
            await view.evaluate(frame);
            expect(await view.evaluate<string>('getComputedStyle(document.querySelector(".browser-host")).borderBottomLeftRadius')).toBe('11px');

            await view.evaluate('fixture.document.setState({layout:{columns:[{size:1,cells:[{size:1,viewId:"browser"}]}],focus:{column:0,cell:0}}})');
            await view.evaluate('(() => {const cell=document.querySelector("#root > div"); fixture.cell=cell;})()');
            await view.evaluate('fixture.registerCell("browser",fixture.cell)');
            await view.evaluate(frame);
            expect(
                await view.evaluate<number[]>(
                    '(() => {const rect=document.querySelector(".browser-host").getBoundingClientRect(); return [rect.x,rect.y,rect.width,rect.height];})()'
                )
            ).toEqual([0, 0, 800, 600]);
            expect(await view.evaluate<string>('getComputedStyle(document.querySelector(".browser-host")).borderBottomLeftRadius')).toBe('0px');
            expect(await view.evaluate<boolean>('fixture.guest.parentElement === document.querySelector(".browser-host")')).toBe(true);
            expect(await view.evaluate<string[]>('window.errors')).toEqual([]);
        }
    );
}, 15000);
