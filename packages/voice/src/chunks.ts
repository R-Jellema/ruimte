// Live appends allow 500 tokens. A UTF-8 byte bound stays below it without a tokenizer.
export const MAX_APPEND_BYTES = 480;

/* Cut on character boundaries, so a chunk never splits a character between two appends. */
export function contextChunks(text: string): string[] {
    const chunks: string[] = [];
    let chunk = '';
    let bytes = 0;

    for (const character of text) {
        const size = utf8Length(character.codePointAt(0)!);

        if (bytes + size > MAX_APPEND_BYTES) {
            chunks.push(chunk);
            chunk = '';
            bytes = 0;
        }
        chunk += character;
        bytes += size;
    }
    if (chunk) {
        chunks.push(chunk);
    }

    return chunks;
}

function utf8Length(codePoint: number): number {
    if (codePoint < 0x80) {
        return 1;
    }

    if (codePoint < 0x800) {
        return 2;
    }

    return codePoint < 0x10000 ? 3 : 4;
}
