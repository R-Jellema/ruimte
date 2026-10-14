import type { Plugin } from 'vite';

const INLINE_SCRIPT = 'data:text/javascript';

type BundleFile = { type: 'chunk'; code: string } | { type: 'asset' };

/* The chunks that load a script from a `data:` URL, which the page's policy refuses (`script-src 'self'` in `packages/csp`). */
export function chunksWithInlineScripts(bundle: Record<string, BundleFile>): string[] {
    return Object.entries(bundle)
        .filter(([, file]) => file.type === 'chunk' && file.code.includes(INLINE_SCRIPT))
        .map(([name]) => name);
}

/*
 * Keeps a script loaded by URL a file of its own. Vite inlines a small asset as a `data:` URL, and a
 * worklet (`audio/capture.ts`) inlined that way loads in dev and fails in every build.
 */
export function scriptFilesGuard(): Plugin {
    return {
        name: 'ruimte-script-files',
        apply: 'build',
        config: () => ({
            build: {
                assetsInlineLimit: (file: string) => (file.endsWith('.js') ? false : undefined)
            }
        }),
        generateBundle(_options, bundle) {
            const found = chunksWithInlineScripts(bundle as Record<string, BundleFile>);
            if (found.length > 0) {
                this.error(`These chunks load a script from a data: URL, which the page's policy refuses:\n${found.join('\n')}`);
            }
        }
    };
}
