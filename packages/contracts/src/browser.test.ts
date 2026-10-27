import { describe, expect, test } from 'bun:test';
import { BrowserInputPayloadSchema, REQUEST_SCHEMAS } from './index.ts';

describe('browser contracts', () => {
    test('keeps browser traffic on explicit additive requests', () => {
        expect(
            REQUEST_SCHEMAS['browser.open'].payload.safeParse({
                browserId: 'node-1',
                url: 'https://example.com',
                width: 1280,
                height: 720,
                deviceScaleFactor: 2
            }).success
        ).toBe(true);
        expect(REQUEST_SCHEMAS['browser.open'].payload.safeParse({ browserId: 'node-1', url: 'https://example.com', width: 0, height: 720 }).success).toBe(
            false
        );
        expect(REQUEST_SCHEMAS['browser.resize'].payload.safeParse({ browserId: 'node-1', width: 1280, height: 720, deviceScaleFactor: 3 }).success).toBe(
            false
        );
    });

    test('accepts bounded input and rejects unbounded pasted text', () => {
        expect(BrowserInputPayloadSchema.safeParse({ browserId: 'node-1', input: { kind: 'pointer', phase: 'down', x: 20, y: 30 } }).success).toBe(true);
        expect(BrowserInputPayloadSchema.safeParse({ browserId: 'node-1', input: { kind: 'text', text: 'x'.repeat(65537) } }).success).toBe(false);
    });
});
