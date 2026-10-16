import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { withBrowserFixture } from '../../testing/browser-fixture';

const frame = 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))';

test('image project colors persist and only black SVG artwork turns white in light mode', async () => {
    await withBrowserFixture(
        `
        import { projectIconAppearance } from ${JSON.stringify(join(import.meta.dir, 'icon-appearance.ts'))};
        import { uploadProjectIcon, setProjectFolderIcon } from ${JSON.stringify(join(import.meta.dir, 'settings.ts'))};
        import { ProjectGlyph } from ${JSON.stringify(join(import.meta.dir, 'ProjectGlyph.tsx'))};
        import { useEndpoints } from ${JSON.stringify(join(import.meta.dir, '../state/endpoints.ts'))};
        import { useTheme } from ${JSON.stringify(join(import.meta.dir, '../state/theme.ts'))};
        import { pool } from ${JSON.stringify(join(import.meta.dir, '../transport/index.ts'))};
        const svg = fill => new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><path fill="' + fill + '" d="M0 0h32v32H0z"/></svg>'], {type:'image/svg+xml'});
        const canvas = document.createElement('canvas'); canvas.width=32; canvas.height=32;
        const context = canvas.getContext('2d'); context.fillStyle='#009689'; context.fillRect(0,0,32,32);
        const png = await new Promise(resolve => canvas.toBlob(resolve));
        const resources = {black:svg('#000'),red:svg('#e7000b'),raster:png};
        const projects = Object.fromEntries(Object.keys(resources).map(id => [id, {
            projectId:id,name:id,color:'#7c74ff',folder:'/repo/'+id,lastOpenedAt:0,closedAt:null,available:true,nameSource:'chosen',
            icon:{kind:'image',value:id === 'raster' ? 'icon.png' : 'icon.svg',version:'1'}
        }]));
        window.calls=[];
        const transport = {
            status:'open',
            subscribeStatus: () => () => {},
            subscribe: () => () => {},
            readBytes: async payload => {
                const blob = resources[payload.resource.projectId];
                return {mime:blob.type,size:blob.size,version:'1',offset:payload.offset,bytes:new Uint8Array(await blob.slice(payload.offset,payload.offset+payload.length).arrayBuffer())};
            },
            request: async (type,payload) => {
                window.calls.push({type,payload});
                if (type === 'project.setIdentity' && payload.color) projects[payload.projectId].color=payload.color;
                return {summary:{...projects[payload.projectId]}};
            }
        };
        const open = {status:'open',attempts:0,retryAt:null};
        pool.peek=() => transport; pool.statusOf=() => open;
        useEndpoints.setState({activeId:'fixture',endpoints:[{id:'fixture',label:'Fixture',direct:true,httpBaseUrl:'http://127.0.0.1',wsBaseUrl:'ws://127.0.0.1',reachability:'lan',daemonId:null,daemonPublicKey:null}]});
        useTheme.getState().setTheme('light');
        window.theme=theme => useTheme.getState().setTheme(theme);
        window.appearances=await Promise.all(Object.values(projects).map(project => projectIconAppearance(transport,project)));
        window.upload=() => uploadProjectIcon('fixture','red','image/svg+xml','unused');
        window.folder=() => setProjectFolderIcon('fixture','raster');
        createRoot(document.getElementById('root')).render(<>{Object.values(projects).map(project => <div key={project.projectId} id={project.projectId}><ProjectGlyph projectId={project.projectId} endpointId="fixture" icon={project.icon} color={project.color} size={32}/></div>)}</>);
        `,
        '',
        async (view) => {
            expect(await view.evaluate<Array<{ color: string | null; black: boolean }>>('window.appearances')).toEqual([
                { color: null, black: true },
                { color: '#e7000b', black: false },
                { color: '#009689', black: false }
            ]);
            await view.evaluate(frame);
            expect(await view.evaluate<string>('document.querySelector("#black img").style.filter')).toBe('brightness(0) invert(1)');
            expect(await view.evaluate<string>('document.querySelector("#red img").style.filter')).toBe('');
            expect(await view.evaluate<string>('document.querySelector("#raster img").style.filter')).toBe('');
            await view.evaluate('window.theme("dark")');
            await view.evaluate(frame);
            expect(await view.evaluate<string>('document.querySelector("#black img").style.filter')).toBe('');
            expect(await view.evaluate<{ summary: { color: string } }>('window.upload()')).toMatchObject({ summary: { color: '#e7000b' } });
            expect(await view.evaluate<{ summary: { color: string } }>('window.folder()')).toMatchObject({ summary: { color: '#009689' } });
            expect(await view.evaluate<string[]>('window.calls.filter(call=>call.payload.color).map(call=>call.payload.color)')).toEqual([
                '#e7000b',
                '#009689'
            ]);
            expect(await view.evaluate<string[]>('window.errors')).toEqual([]);
        }
    );
}, 15000);
