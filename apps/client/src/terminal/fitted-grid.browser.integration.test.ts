import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { withBrowserFixture } from '../../testing/browser-fixture';

/*
 * A terminal in a split grid mounts before the grid has measured itself, in a host with no width.
 * FitAddon makes two columns of that host, and a shell told so wipes its screen on the real grid
 * after it, so a node opens with no grid until its host has room.
 */
test('a terminal mounted in a split grid has no grid until its host is laid out', async () => {
    await withBrowserFixture(
        `
        import { SplitView } from ${JSON.stringify(Bun.resolveSync('@adecore/ui', join(import.meta.dir, '../..')))};
        import { TerminalView } from ${JSON.stringify(Bun.resolveSync('@adecore/terminal', join(import.meta.dir, '../..')))};
        import { fittedGrid } from ${JSON.stringify(join(import.meta.dir, 'xterm.ts'))};
        window.grids = { mount: {}, fitted: {} };
        window.views = {};
        window.fittedGrid = fittedGrid;
        function Probe({ id }) {
            const ref = React.useRef(null);
            React.useEffect(() => {
                window.views[id] = ref.current;
                window.grids.mount[id] = fittedGrid(ref.current);
            }, []);
            return <TerminalView ref={ref} className="absolute inset-0" onResize={(cols, rows) => (window.grids.fitted[id] = { cols, rows })} />;
        }
        const value = {root:{type:'split',id:'s',axis:'horizontal',sizes:[0.5,0.5],children:[{type:'pane',id:'p1',views:['a'],active:'a'},{type:'pane',id:'p2',views:['b'],active:'b'}]},focused:'p1',maximized:null};
        createRoot(document.getElementById('root')).render(<UIProvider i18n={i18next}><SplitView value={value} onValueChange={() => {}} showTabs={false} minimumSize={{width:0,height:0}} renderView={(viewId) => <Probe id={viewId} />} /></UIProvider>);
        `,
        `html,body,#root{margin:0;width:100%;height:100%}.absolute{position:absolute}.inset-0{inset:0}`,
        async (view) => {
            // The terminal refits on its own debounce once the grid has measured itself.
            await view.evaluate<unknown>(
                'new Promise(resolve => { const check = () => (Object.keys(window.grids.fitted).length === 2 ? resolve() : requestAnimationFrame(check)); check(); })'
            );
            const grids = await view.evaluate<{ mount: Record<string, unknown>; fitted: Record<string, { cols: number; rows: number }> }>('window.grids');
            expect(grids.mount).toEqual({ a: null, b: null });
            for (const id of ['a', 'b']) {
                expect(grids.fitted[id]!.cols).toBeGreaterThan(2);
                expect(await view.evaluate<unknown>(`fittedGrid(window.views.${id})`)).toEqual(grids.fitted[id]);
            }
        }
    );
});
