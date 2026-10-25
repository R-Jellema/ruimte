import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChatInfoSchema, MACHINE_HEALTH_PATH } from '@ruimte/contracts';
import { ProjectStore } from '../../../server/src/projects/project-store';
import { projectLinks } from '../../../server/src/projects/project-file-test-helpers';
import { measureRestore } from './restore';

const count = Number(process.env.BENCH_PROJECTS ?? 20);
const views = Number(process.env.BENCH_VIEWS ?? 100);
const updates = Number(process.env.BENCH_UPDATES ?? 60);
if (![count, views, updates].every((value) => Number.isInteger(value) && value > 0) || views < 2) {
    throw new Error('BENCH_PROJECTS, BENCH_VIEWS and BENCH_UPDATES must be positive integers, with at least two views');
}
const info = ChatInfoSchema.parse({
    chatId: 'view-0-1',
    provider: 'claude',
    cwd: '/project',
    agentSessionId: null,
    model: null,
    selection: { model: 'model', options: {} },
    runtimeMode: 'supervised',
    status: 'idle',
    running: false,
    activeTurnId: null,
    slashCommands: [],
    usage: { turns: 0, contextTokens: 0, contextWindow: null, costUsd: 0 },
    createdAt: 0
});
const root = await mkdtemp(join(tmpdir(), 'ruimte-sidebar-render-'));
const home = join(root, 'home');
const seed = new ProjectStore(home, projectLinks());
let first = '';
let child: Bun.Subprocess<'ignore', 'pipe', 'pipe'> | undefined;
let stdout: Promise<string> | undefined;
let stderr: Promise<string> | undefined;
try {
    for (let project = 0; project < count; project++) {
        const opened = await seed.openProject({ folder: join(root, `project-${project}`), createFolder: true });
        if (project === 0) {
            first = opened.summary.projectId;
        }
        await Bun.write(join(opened.summary.folder, 'fixture.txt'), 'Sidebar benchmark.\n');
        await seed.save(opened.summary.projectId, opened.document.rev, {
            name: `Project ${project}`,
            color: 'blue',
            views: Array.from({ length: views }, (_, index) =>
                index === 0
                    ? { id: `view-${project}-${index}`, name: `File ${index}`, kind: 'file', path: 'fixture.txt' }
                    : { id: `view-${project}-${index}`, name: `Chat ${index}`, kind: 'chat', node: { provider: 'claude' } }
            )
        });
        await seed.saveLocal(opened.summary.projectId, { ...opened.local, activeViewId: `view-${project}-0` });
        seed.release(opened.summary.projectId);
    }
    seed.closeAll();
    const reservation = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() });
    const port = reservation.port!;
    await reservation.stop(true);
    child = Bun.spawn(
        [
            process.execPath,
            '--conditions=source',
            'src/main.ts',
            '--host',
            '127.0.0.1',
            '--port',
            String(port),
            '--no-hooks',
            '--no-broker',
            '--no-lan',
            '--no-stun',
            '--no-model-fetch',
            '--no-price-fetch'
        ],
        { cwd: join(import.meta.dir, '../../../server'), env: { ...process.env, RUIMTE_HOME: home }, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' }
    );
    stdout = new Response(child.stdout).text();
    stderr = new Response(child.stderr).text();
    const base = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let attempt = 0; attempt < 300 && child.exitCode === null; attempt++) {
        if ((await fetch(`${base}${MACHINE_HEALTH_PATH}`, { signal: AbortSignal.timeout(200) }).catch(() => null))?.ok) {
            ready = true;
            break;
        }
        await Bun.sleep(100);
    }
    if (!ready) {
        throw new Error('Isolated sidebar daemon did not start');
    }
    const secret = (await readFile(join(home, 'local.key'), 'utf8')).trim();
    const result = await measureRestore({
        daemonUrl: base,
        secret,
        projectId: first,
        profile: join(root, 'profiles'),
        settings: { sidebarScope: 'all-open' },
        inject: `const MeasuredSocket=window.WebSocket;window.WebSocket=class extends MeasuredSocket{constructor(...args){super(...args);window.benchSocket=this}};`,
        async probe(view) {
            await view.evaluate(`new Promise((resolve,reject)=>{
                const timer=setTimeout(()=>reject(new Error('Sidebar did not load: '+document.querySelectorAll('[data-sidebar-row]').length)),15000);
                const next=()=>{if(document.querySelectorAll('[data-sidebar-row]').length>=${count * views}){clearTimeout(timer);resolve()}else requestAnimationFrame(next)};next();
            })`);
            await view.evaluate('new Promise(resolve=>setTimeout(resolve,500))');
            await view.cdp('Performance.enable');
            const before = (await view.cdp('Performance.getMetrics')) as { metrics: { name: string; value: number }[] };
            const audit = await view.evaluate<{ rows: number; frames: number[]; errors: string[] }>(`(async()=>{
                const frames=[];
                const first=document.querySelector('[data-sidebar-row$="view:view-0-1"]');
                if(!first)throw new Error('Benchmark chat row is missing');
                const initial=first.innerHTML;
                let previous=performance.now();
                for(let index=0;index<${updates};index++){
                    const info={...${JSON.stringify(info)},status:index%2===0?'needs-you':'idle'};
                    window.benchSocket.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({type:'event',event:'chat.status',payload:{chatId:info.chatId,info}})}));
                    await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
                    const now=performance.now();frames.push(now-previous);previous=now;
                    if((first.innerHTML!==initial)!==(index%2===0))throw new Error('Sidebar status did not follow update '+index);
                }
                return {rows:document.querySelectorAll('[data-sidebar-row]').length,frames,errors:window.benchErrors};
            })()`);
            const after = (await view.cdp('Performance.getMetrics')) as typeof before;
            const metric = (result: typeof before, name: string) => result.metrics.find((row) => row.name === name)?.value ?? 0;
            if (audit.errors.length > 0) {
                throw new Error(audit.errors.join('\n'));
            }
            const taskMs = 1000 * (metric(after, 'TaskDuration') - metric(before, 'TaskDuration'));
            if (taskMs > Number(process.env.BENCH_MAX_TASK_MS ?? Infinity)) {
                throw new Error(`Sidebar status updates exceeded their CPU budget: ${taskMs} ms`);
            }
            const navigation = (await view.evaluate(`(async()=>{
                const frame=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
                const results=[];
                for(const project of ${JSON.stringify(count > 1 ? [0, 1] : [0])}){
                    const file=document.querySelector('[data-sidebar-row$="view:view-'+project+'-0"]');
                    const chat=document.querySelector('[data-sidebar-row$="view:view-'+project+'-1"]');
                    file.focus();await frame();
                    file.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));await frame();
                    const down=document.activeElement===chat;
                    chat.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true,cancelable:true}));await frame();
                    const up=document.activeElement===file;
                    results.push({project,down,up,tabStops:document.querySelectorAll('[data-sidebar-row][tabindex="0"]').length});
                }
                return results;
            })()`)) as { project: number; down: boolean; up: boolean; tabStops: number }[];
            if (navigation.some((result) => !result.down || !result.up || result.tabStops !== 1)) {
                throw new Error(`Sidebar keyboard navigation changed: ${JSON.stringify(navigation)}`);
            }
            return { ...audit, taskMs, navigation };
        }
    });
    console.log(JSON.stringify({ benchmark: 'sidebar-render', count, views, updates, result }, null, 2));
} finally {
    seed.closeAll();
    if (child) {
        child.kill('SIGTERM');
        const timeout = setTimeout(() => child!.kill('SIGKILL'), 5000);
        await child.exited;
        clearTimeout(timeout);
        await stdout;
        await stderr;
    }
    await rm(root, { recursive: true, force: true });
}
