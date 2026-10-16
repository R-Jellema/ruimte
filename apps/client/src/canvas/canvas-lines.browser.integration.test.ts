import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { withBrowserFixture } from '../../testing/browser-fixture';

const frame = 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))';

test('the canvas context menu draws, styles, moves and resizes an arrow without adding dock tools', async () => {
    await withBrowserFixture(
        `
        import { Canvas } from ${JSON.stringify(join(import.meta.dir, 'Canvas.tsx'))};
        import { defaultCanvasStore } from ${JSON.stringify(join(import.meta.dir, '../state/canvas.ts'))};
        import { useProject } from ${JSON.stringify(join(import.meta.dir, '../state/project.ts'))};
        import { ChatScopeProvider } from ${JSON.stringify(join(import.meta.dir, '../transport/ChatScopeProvider.tsx'))};
        import canvasWords from ${JSON.stringify(join(import.meta.dir, '../i18n/locales/en/canvas.json'))};
        import drawingWords from ${JSON.stringify(join(import.meta.dir, '../i18n/locales/en/drawing.json'))};
        import commonWords from ${JSON.stringify(join(import.meta.dir, '../i18n/locales/en/common.json'))};
        import agentWords from ${JSON.stringify(join(import.meta.dir, '../i18n/locales/en/agents.json'))};
        i18next.addResourceBundle('en','canvas',canvasWords,true,true);
        i18next.addResourceBundle('en','drawing',drawingWords,true,true);
        i18next.addResourceBundle('en','common',commonWords,true,true);
        i18next.addResourceBundle('en','agents',agentWords,true,true);
        defaultCanvasStore.setState({viewId:'main',camera:{x:0,y:0,zoom:1},viewport:{w:800,h:600}});
        useProject.setState({current:{id:'project',name:'Project',folder:'/project'}});
        window.canvas=defaultCanvasStore;
        window.item = text => [...document.querySelectorAll('[role^="menuitem"]')].find(item=>item.textContent.trim()===text);
        window.arrow = () => Object.values(window.canvas.getState().lines)[0];
        createRoot(document.getElementById('root')).render(<UIProvider i18n={i18next}><ChatScopeProvider><Canvas/></ChatScopeProvider></UIProvider>);
        `,
        '.absolute{position:absolute}.relative{position:relative}.inset-0{inset:0}.top-0{top:0}.left-0{left:0}.h-full{height:100%}.w-full{width:100%}.overflow-visible{overflow:visible}.overflow-hidden{overflow:hidden}.pointer-events-none{pointer-events:none}.pointer-events-auto{pointer-events:auto}.z-10{z-index:10}[data-line-tool]{position:absolute;inset:0;z-index:10}:root{--draw-ink:#18181b;--draw-red:#e7000b;--canvas-bg:#eeeef1}',
        async (view) => {
            await view.evaluate(
                `document.querySelector('[data-canvas-surface]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:40,clientY:40,button:2}))`
            );
            await view.evaluate(frame);
            expect(await view.evaluate<boolean>('!!window.item("Line") && !window.item("Arrow")')).toBe(true);
            expect(
                await view.evaluate<string[]>(
                    '[...document.querySelector("[role=menu] [role=group]").querySelectorAll("[role=menuitem]")].map(item=>{ const clone=item.cloneNode(true); clone.querySelectorAll("kbd").forEach(key=>key.remove()); return clone.textContent.trim(); })'
                )
            ).toEqual(['Agent (Chat)', 'Agent (Terminal)', 'Terminal', 'Chat', 'Browser', 'Group', 'File…']);
            expect(
                await view.evaluate<boolean>(
                    'window.item("Line").closest("[role=group]") === [...document.querySelectorAll("[role=menuitem]")].find(item=>item.textContent.trim().startsWith("Text")).closest("[role=group]")'
                )
            ).toBe(true);
            expect(
                await view.evaluate<boolean>(
                    'window.item("Line").closest("[role=group]") !== [...document.querySelectorAll("[role=menuitem]")].find(item=>item.textContent.trim().startsWith("Terminal")).closest("[role=group]")'
                )
            ).toBe(true);
            await view.evaluate('window.item("Line").click()');
            await view.evaluate(frame);
            expect(await view.evaluate<string>('document.querySelector("[data-line-tool]").dataset.lineTool')).toBe('line');
            const drag = async (from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> => {
                await view.cdp('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', buttons: 1, clickCount: 1, ...from });
                await view.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', button: 'left', buttons: 1, ...to });
                await view.cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', buttons: 0, clickCount: 1, ...to });
                await view.evaluate(frame);
            };
            await drag({ x: 101, y: 99 }, { x: 301, y: 199 });
            expect(await view.evaluate('window.arrow()')).toMatchObject({ x: 100, y: 100, endX: 300, endY: 200 });
            expect(await view.evaluate<boolean>('window.arrow().arrowEnd === true')).toBe(false);
            expect(await view.evaluate<boolean>('document.querySelector("[data-line-tool]") === null')).toBe(true);
            expect(await view.evaluate<number>('document.querySelector("[role=toolbar]").querySelectorAll("button").length')).toBe(2);
            expect(
                await view.evaluate<boolean>('document.querySelector("[role=toolbar] button[aria-label=Delete] svg")?.classList.contains("text-status-error")')
            ).toBe(true);
            await view.evaluate(
                `document.querySelector('[data-canvas-line]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:200,clientY:150,button:2}))`
            );
            await view.evaluate(frame);
            await view.evaluate('window.item("Dotted").click()');
            await view.evaluate(frame);
            await view.evaluate('window.item("Bold").click()');
            await view.evaluate(frame);
            await view.evaluate('window.item("Arrow at start").click()');
            await view.evaluate(frame);
            await view.evaluate('window.item("Arrow at end").click()');
            await view.evaluate(frame);
            await view.evaluate('document.querySelector("[role=menuitem][aria-label=Teal]").click()');
            await view.evaluate(frame);
            expect(await view.evaluate('window.arrow()')).toMatchObject({
                strokeStyle: 'dotted',
                strokeWidth: 4,
                stroke: 'teal',
                arrowStart: true,
                arrowEnd: true
            });
            expect(await view.evaluate<string>('document.querySelector("[data-canvas-line] path[stroke-dasharray]").getAttribute("stroke")')).toBe('#009689');
            // A focused color's tooltip owns Escape before the menu underneath it.
            for (let layer = 0; layer < 2; layer++) {
                await view.cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
                await view.cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
                await view.evaluate(
                    'Promise.allSettled(document.getAnimations().filter(animation=>animation.effect.getComputedTiming().endTime<600).map(animation=>animation.finished))'
                );
                if (await view.evaluate<boolean>('document.querySelector("[role=menu]") === null')) {
                    break;
                }
            }
            expect(await view.evaluate<number>('document.querySelectorAll("[role=menu]").length')).toBe(0);
            await drag({ x: 300, y: 200 }, { x: 361, y: 239 });
            expect(await view.evaluate('window.arrow()')).toMatchObject({ x: 100, y: 100, endX: 360, endY: 240 });
            await drag({ x: 230, y: 170 }, { x: 250, y: 200 });
            expect(await view.evaluate('window.arrow()')).toMatchObject({ x: 120, y: 132, endX: 380, endY: 272 });
            await view.evaluate('window.canvas.getState().undo()');
            expect(await view.evaluate('window.arrow()')).toMatchObject({ x: 100, y: 100, endX: 360, endY: 240 });
            expect(await view.evaluate<string[]>('window.errors')).toEqual([]);
        }
    );
}, 15000);

test('lines show live alignment and gap guides and share editable gaps on the 4px grid', async () => {
    await withBrowserFixture(
        `
        import { Canvas } from ${JSON.stringify(join(import.meta.dir, 'Canvas.tsx'))};
        import { defaultCanvasStore } from ${JSON.stringify(join(import.meta.dir, '../state/canvas.ts'))};
        import { setGapModifierDown } from ${JSON.stringify(join(import.meta.dir, 'gap-modifier.ts'))};
        import { ChatScopeProvider } from ${JSON.stringify(join(import.meta.dir, '../transport/ChatScopeProvider.tsx'))};
        const style={stroke:'ink',strokeWidth:2,strokeStyle:'solid'};
        const lines={
            a:{...style,id:'a',x:20,y:300,endX:120,endY:300},
            b:{...style,id:'b',x:252,y:300,endX:152,endY:300},
            c:{...style,id:'c',x:284,y:300,endX:384,endY:300}
        };
        defaultCanvasStore.setState({viewId:'main',lines,selection:['b'],camera:{x:0,y:0,zoom:1},viewport:{w:800,h:600}});
        window.canvas=defaultCanvasStore;
        window.gap=setGapModifierDown;
        window.positions=()=>Object.values(window.canvas.getState().lines).map(({x,endX})=>[x,endX]);
        createRoot(document.getElementById('root')).render(<UIProvider i18n={i18next}><ChatScopeProvider><Canvas/></ChatScopeProvider></UIProvider>);
        `,
        '.absolute{position:absolute}.relative{position:relative}.inset-0{inset:0}.top-0{top:0}.left-0{left:0}.h-full{height:100%}.w-full{width:100%}.overflow-visible{overflow:visible}.overflow-hidden{overflow:hidden}.pointer-events-none{pointer-events:none}.pointer-events-auto{pointer-events:auto}.z-10{z-index:10}[data-gap-id]{transform:translate(-50%,-50%)}',
        async (view) => {
            const pointer = async (type: string, x: number, y: number, modifiers = 0): Promise<void> => {
                await view.cdp('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, modifiers });
                await view.evaluate(frame);
            };
            await pointer('mousePressed', 202, 300);
            await pointer('mouseMoved', 207, 301);
            expect(await view.evaluate('window.canvas.getState().lines.b')).toMatchObject({ x: 256, y: 300, endX: 156, endY: 300 });
            expect(await view.evaluate<number>('document.querySelectorAll("[data-alignment-guides] line").length')).toBeGreaterThan(0);
            expect(
                await view.evaluate<string[]>('[...document.querySelectorAll("[data-alignment-guides] span")].map(label=>label.textContent).sort()')
            ).toEqual(['28', '36']);
            await pointer('mouseReleased', 207, 301);
            expect(await view.evaluate<boolean>('document.querySelector("[data-alignment-guides]") === null')).toBe(true);
            await view.evaluate('(() => { window.canvas.getState().undo(); window.canvas.getState().select(["b"]); })()');
            await view.evaluate(frame);

            await pointer('mousePressed', 252, 300);
            await pointer('mouseMoved', 261, 301);
            expect(await view.evaluate('window.canvas.getState().lines.b')).toMatchObject({ x: 260, y: 300, endX: 152, endY: 300 });
            expect(await view.evaluate<number>('document.querySelectorAll("[data-alignment-guides] line").length')).toBeGreaterThan(0);
            await pointer('mouseReleased', 261, 301);
            await view.evaluate('window.canvas.getState().undo()');

            await view.evaluate('window.canvas.getState().setLineTool("line")');
            await view.evaluate(frame);
            await pointer('mousePressed', 21, 201);
            await pointer('mouseMoved', 121, 201);
            expect(await view.evaluate<number>(`document.querySelectorAll('[data-alignment-guides] line[x1="20"][x2="20"]').length`)).toBe(1);
            await pointer('mouseReleased', 121, 201);
            expect(await view.evaluate('Object.values(window.canvas.getState().lines).at(-1)')).toMatchObject({ x: 20, y: 200, endX: 120, endY: 200 });
            await view.evaluate('(() => { window.canvas.getState().undo(); window.canvas.getState().clearSelection(); window.gap(true); })()');
            await view.evaluate(frame);

            expect(await view.evaluate<number>('document.querySelectorAll("[data-gap-id]").length')).toBe(2);
            await pointer('mousePressed', 136, 300, 1);
            expect(await view.evaluate<boolean>('window.canvas.getState().gapMove !== null')).toBe(true);
            await pointer('mouseMoved', 141, 300, 9);
            await pointer('mouseReleased', 141, 300, 9);
            expect(await view.evaluate<number[][]>('window.positions()')).toEqual([
                [20, 120],
                [256, 156],
                [292, 392]
            ]);
            expect(await view.evaluate<string[]>('[...document.querySelectorAll("[data-gap-id] span")].map(label=>label.textContent)')).toEqual(['36', '36']);
            await view.evaluate('(() => { window.canvas.getState().undo(); window.gap(false); })()');
            expect(await view.evaluate<number[][]>('window.positions()')).toEqual([
                [20, 120],
                [252, 152],
                [284, 384]
            ]);
            expect(await view.evaluate<string[]>('window.errors')).toEqual([]);
        }
    );
}, 15000);
