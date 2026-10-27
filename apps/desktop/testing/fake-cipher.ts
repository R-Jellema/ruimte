import type { StringCipher } from '../src/secret-store';

/* A stand-in for the keychain: reversible, and nothing like the plain text. */
export function fakeCipher(available = true): StringCipher {
    return {
        isEncryptionAvailable: () => available,
        encryptString: (plain) => Buffer.from(Buffer.from(plain, 'utf8').map((byte) => byte ^ 0x5a)),
        decryptString: (encrypted) => Buffer.from(encrypted.map((byte) => byte ^ 0x5a)).toString('utf8')
    };
}

/* A keychain that will not open what is on disk, as after a declined prompt. */
export function refusingCipher(): StringCipher {
    return {
        ...fakeCipher(),
        decryptString: () => {
            throw new Error('Keychain rejected the file');
        }
    };
}
