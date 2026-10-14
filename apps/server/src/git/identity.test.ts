import { expect, test } from 'bun:test';
import { withoutCredentials } from './identity.ts';

test('a URL loses the user and the password it carried', () => {
    expect(withoutCredentials('https://ada:secret@example.com/owner/repo.git')).toBe('https://example.com/owner/repo.git');
    expect(withoutCredentials('https://token@example.com/owner/repo.git')).toBe('https://example.com/owner/repo.git');
});

test('a query parameter that carries a secret goes, and the others stay', () => {
    expect(withoutCredentials('https://example.com/owner/repo.git?access_token=abc&ref=main')).toBe('https://example.com/owner/repo.git?ref=main');
    expect(withoutCredentials('https://example.com/repo.git?private_token=abc')).toBe('https://example.com/repo.git');
});

test('an address without credentials stays as it was written', () => {
    expect(withoutCredentials('https://example.com/owner/repo.git')).toBe('https://example.com/owner/repo.git');
    expect(withoutCredentials('git@example.com:owner/repo.git')).toBe('git@example.com:owner/repo.git');
    expect(withoutCredentials('/srv/git/repo')).toBe('/srv/git/repo');
});
