import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FakeWatch } from '@adecore/agents/testing';
import type { CommandApprovals } from '../sessions/command-approvals.ts';
import { type AfterSettleChoices, LaunchStore } from './store.ts';

/** The store over project `p1` in `folder`, with its watch faked. */
export function launchStoreFor(folder: string, approvals: CommandApprovals, fake: FakeWatch, afterSettle?: AfterSettleChoices): LaunchStore {
    return new LaunchStore({
        projects: { folderOf: (projectId) => (projectId === 'p1' ? folder : null), worktreePaths: () => Promise.resolve([]) },
        approvals,
        seams: fake,
        afterSettle
    });
}

/** Edits the first launch in `launches.json` behind the store's back and delivers the watch event for it. */
export async function editLaunchOnDisk(
    fake: FakeWatch,
    folder: string,
    where: 'shared' | 'private',
    edit: (launch: Record<string, unknown>) => void
): Promise<void> {
    const directory = where === 'shared' ? join(folder, '.ruimte') : join(folder, '.ruimte', 'private');
    const path = join(directory, 'launches.json');
    const file = JSON.parse(await readFile(path, 'utf8'));
    edit(file.launches[0]);
    await writeFile(path, JSON.stringify(file));
    fake.on(directory).emit('launches.json');
    await fake.settle();
}
