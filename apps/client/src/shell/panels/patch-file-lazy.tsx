import { Suspense } from 'react';
import type { FsReadText } from '@ruimte/contracts';
import { lazyNamed } from '@adecore/ui';
import { CodeFile } from '@/shell/panels/CodeFile';

const LazyPatchFile = lazyNamed(() => import('@/shell/panels/PatchFile'), 'PatchFile');

/* The patch mode loads on its own; until it is there the file is the plain editor, which the patch mode then takes over. */
export function PatchFileSlot({ path, read }: { path: string; read: FsReadText }) {
    return (
        <Suspense fallback={<CodeFile path={path} read={read} />}>
            <LazyPatchFile path={path} read={read} />
        </Suspense>
    );
}
