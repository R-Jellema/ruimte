import { migrateSharedFile } from './project-migrate.ts';

/** The shared file a value migrates to, or null when it is refused. */
export function migratedFile(value: unknown) {
    return migrateSharedFile(value)?.file ?? null;
}
