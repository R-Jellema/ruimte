import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface StringCipher {
    isEncryptionAvailable(): boolean;
    encryptString(plain: string): Buffer;
    decryptString(encrypted: Buffer): string;
}

export interface SecretStore {
    persistent(): boolean;
    read(): Promise<string | null>;
    write(secret: string | null): Promise<void>;
}

export interface SecretStoreOptions {
    /* Throw for a secret that is on disk but cannot be read, rather than take it for unset. */
    reportUnreadable?: boolean;
}

function isMissing(error: unknown): boolean {
    return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT';
}

// One queue per path, shared by every store on it: the desktop does not depend on `@adecore/agents` for its KeyedSerializer.
const chains = new Map<string, Promise<unknown>>();
let temporaryCounter = 0;

function inOrder<T>(path: string, work: () => Promise<T>): Promise<T> {
    const previous = chains.get(path) ?? Promise.resolve();
    const next = previous.then(work, work);
    const settled = next.catch(() => undefined);
    chains.set(path, settled);
    void settled.then(() => {
        if (chains.get(path) === settled) {
            chains.delete(path);
        }
    });
    return next;
}

/* Makes the removal itself survive a restart. */
async function syncFolder(path: string): Promise<void> {
    if (process.platform === 'win32') {
        return;
    }
    const folder = await open(dirname(path), 'r');
    try {
        await folder.sync();
    } finally {
        await folder.close();
    }
}

/* A secret is only persisted when Electron can encrypt it through the operating system's keychain. */
export function fileSecretStore(path: string, cipher: StringCipher, { reportUnreadable = false }: SecretStoreOptions = {}): SecretStore {
    let memory: string | null = null;

    return {
        persistent: () => cipher.isEncryptionAvailable(),
        read() {
            return inOrder(path, async () => {
                if (!cipher.isEncryptionAvailable()) {
                    return memory;
                }
                try {
                    return cipher.decryptString(await readFile(path));
                } catch (error: unknown) {
                    if (reportUnreadable && !isMissing(error)) {
                        throw error;
                    }
                    return null;
                }
            });
        },
        write(secret) {
            return inOrder(path, async () => {
                memory = secret;
                if (!cipher.isEncryptionAvailable()) {
                    return;
                }
                if (secret === null) {
                    await rm(path, { force: true });
                    await syncFolder(path).catch((error: unknown) => {
                        if (!isMissing(error)) {
                            throw error;
                        }
                    });
                    return;
                }
                await mkdir(dirname(path), { recursive: true });
                const temporary = `${path}.${process.pid}-${temporaryCounter++}.tmp`;
                try {
                    await writeFile(temporary, cipher.encryptString(secret), { mode: 0o600 });
                    await rename(temporary, path);
                } catch (error: unknown) {
                    await rm(temporary, { force: true });
                    throw error;
                }
            });
        }
    };
}
