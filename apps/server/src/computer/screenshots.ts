import { join } from 'node:path';
import type { Reclaimed } from '../maintenance/maintenance.ts';
import { sweepFolder } from '../maintenance/sweep-folder.ts';
import { helperDirectory } from './helper.ts';

/* The cutoff the helper keeps its window captures by (`WindowCapture.swift`), which itself sweeps only on the next capture. */
const CAPTURE_MAX_AGE_MS = 60 * 60 * 1000;

/* The helper's window captures past their age, judged by when the file was written as the helper does. */
export function sweepComputerScreenshots(home: string, now: number, signal?: AbortSignal): Promise<Reclaimed> {
    const oldest = now - CAPTURE_MAX_AGE_MS;

    return sweepFolder(join(helperDirectory(home), 'screenshots'), {
        expired: (name, modifiedMs) => name.endsWith('.png') && modifiedMs < oldest,
        signal
    });
}
