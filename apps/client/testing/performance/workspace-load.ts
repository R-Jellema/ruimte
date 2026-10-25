import { withProjectFixture } from './project-fixture';
import { measureRestore } from './restore';

const content = process.env.BENCH_CONTENT ?? 'empty';
const assetDelayMs = Number(process.env.BENCH_ASSET_DELAY ?? 0);
if (!['empty', 'file'].includes(content) || !Number.isFinite(assetDelayMs) || assetDelayMs < 0) {
    throw new Error('BENCH_CONTENT must be empty or file, and BENCH_ASSET_DELAY must be nonnegative');
}
await withProjectFixture({ projects: 1, views: content === 'file' ? 2 : 0 }, async (fixture) => {
    const result = await measureRestore({
        ...fixture,
        assetDelayMs,
        settings: { sidebarScope: 'all-open' },
        inject:
            content === 'file'
                ? `window.benchContent=new Promise((resolve,reject)=>{
            const timer=setTimeout(()=>reject(new Error('File did not open: '+document.body.innerText.slice(0,300))),15000);
            const observer=new MutationObserver(()=>{
                if(document.querySelector('.file-code')?.textContent.includes('Sidebar benchmark.')){
                    observer.disconnect();clearTimeout(timer);requestAnimationFrame(()=>resolve(performance.now()));
                }
            });observer.observe(document.documentElement,{childList:true,subtree:true,characterData:true});
        });`
                : undefined,
        async probe(view) {
            const contentMs = content === 'file' ? await view.evaluate<number>('window.benchContent') : null;
            await view.evaluate('new Promise(resolve=>setTimeout(resolve,500))');
            const inventory = await view.evaluate<{ resources: { name: string; bytes: number }[]; errors: string[] }>(`({
                resources:performance.getEntriesByType('resource').filter(row=>row.name.endsWith('.js')).map(row=>({name:row.name.split('/').at(-1),bytes:row.decodedBodySize})),
                errors:window.benchErrors,requests:window.benchRequests.filter(row=>row.type.startsWith('fs.'))
            })`);
            if (inventory.errors.length > 0) {
                throw new Error(inventory.errors.join('\n'));
            }
            return { contentMs, ...inventory };
        }
    });
    console.log(JSON.stringify({ benchmark: 'workspace-load', content, assetDelayMs, result }, null, 2));
    const measured = result.samples
        .map((sample) => (content === 'file' ? (sample.probe as { contentMs: number }).contentMs : sample.readyMs))
        .toSorted((left, right) => left - right);
    if (measured[Math.floor(measured.length / 2)]! > Number(process.env.BENCH_MAX_LOAD_MS ?? Infinity)) {
        throw new Error('Workspace loading exceeded its timing budget');
    }
});
