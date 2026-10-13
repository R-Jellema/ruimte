import { join } from 'node:path';
import type { OpenAiCredentialStatus } from '@ruimte/desktop-bridge';
import { databaseSecretFile, parseSecret, parseSecretKey } from '../database-bridge';
import { createOpenAiLiveSession, parseOpenAiLivePreferences } from '../openai-live';
import { fileSecretStore, type SecretStore } from '../secret-store';
import { electron } from './electron';
import type { AppIpc } from './ipc';

const { app, net, safeStorage } = electron;

/* The OpenAI API key and the database passwords, which stay in the shell, encrypted with the OS keychain. */
export function installSecrets(ipc: AppIpc): void {
    let openAiKeyStore: SecretStore | null = null;

    const openAiKeys = (): SecretStore => {
        openAiKeyStore ??= fileSecretStore(join(app.getPath('userData'), 'openai-api-key.bin'), safeStorage);
        return openAiKeyStore;
    };

    const openAiCredentialStatus = async (): Promise<OpenAiCredentialStatus> => {
        const store = openAiKeys();
        if ((await store.read()) !== null) {
            return { configured: true, persistent: store.persistent() };
        }
        return { configured: false, persistent: false };
    };

    // One file per key. Kept so a store without encryption still holds its secrets in memory until the app quits.
    const databaseSecretStores = new Map<string, SecretStore>();

    const databaseSecrets = (key: string): SecretStore => {
        const path = databaseSecretFile(join(app.getPath('userData'), 'database-secrets'), key);
        let store = databaseSecretStores.get(path);
        if (store === undefined) {
            // A password the keychain no longer opens is said, or a person only sees the server turn the login down.
            store = fileSecretStore(path, safeStorage, { reportUnreadable: true });
            databaseSecretStores.set(path, store);
        }
        return store;
    };

    ipc.handle('openai:credential-status', () => openAiCredentialStatus());

    ipc.handle('database:secret-read', (_event, key: unknown) => databaseSecrets(parseSecretKey(key)).read());

    ipc.handle('database:secret-write', (_event, key: unknown, secret: unknown) => databaseSecrets(parseSecretKey(key)).write(parseSecret(secret)));

    ipc.handle('database:secret-persistent', () => safeStorage.isEncryptionAvailable());

    ipc.handle('openai:save-api-key', async (_event, apiKey: unknown) => {
        if (typeof apiKey !== 'string' || apiKey.trim() === '') {
            throw new Error('Enter an API key');
        }
        await openAiKeys().write(apiKey.trim());
        return openAiCredentialStatus();
    });

    ipc.handle('openai:clear-api-key', async () => {
        await openAiKeys().write(null);
        return openAiCredentialStatus();
    });

    ipc.handle('openai:create-live-session', async (_event, sdp: unknown, preferences: unknown) => {
        if (typeof sdp !== 'string') {
            throw new Error('The microphone session offer is invalid');
        }
        const requested = parseOpenAiLivePreferences(preferences);
        if (!requested) {
            throw new Error('The GPT-Live voice settings are invalid');
        }
        const apiKey = await openAiKeys().read();
        if (apiKey === null) {
            throw new Error('Add an OpenAI API key in Settings first');
        }
        return createOpenAiLiveSession((input, init) => net.fetch(input, init), apiKey, sdp, requested);
    });
}
