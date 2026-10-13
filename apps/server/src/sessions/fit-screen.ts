/*
 * The most a screen may weigh in its frame, as JSON in UTF-8 bytes. Past 16 MB the socket closes and
 * a direct channel turns the frame away, and the reconnect that follows meets the same screen again.
 */
export const SCREEN_MAX_BYTES = 4 * 1024 * 1024;

// JSON writes a control character as `\u001b`, six bytes for one unit, and nothing costs more than that.
const MAX_BYTES_PER_UNIT = 6;

function isShortEscape(code: number): boolean {
    return code === 0x08 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d || code === 0x22 || code === 0x5c;
}

/*
 * Whether `JSON.stringify(text)` would weigh more than `maxBytes` in UTF-8, without building that copy
 * of a screen of megabytes. What JSON adds to the UTF-8 of the text: two quotes, a backslash before a
 * quote, a backslash and the short escapes, five bytes on every other control character, and three on a
 * lone surrogate, which UTF-8 writes as the three bytes of U+FFFD and JSON as `\udxxx`.
 */
export function jsonExceeds(text: string, maxBytes: number): boolean {
    let bytes = Buffer.byteLength(text) + 2;
    for (let i = 0; i < text.length && bytes <= maxBytes; i++) {
        const code = text.charCodeAt(i);
        if (code < 0x20 || code === 0x22 || code === 0x5c) {
            bytes += isShortEscape(code) ? 1 : 5;
        } else if ((code & 0xf800) === 0xd800) {
            if (code <= 0xdbff && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
                i++;
            } else {
                bytes += 3;
            }
        }
    }
    return bytes > maxBytes;
}

/*
 * The screen with as much scrollback as fits in one frame. The oldest lines go first, half of them
 * at a time; what is on screen always stays.
 */
export function fitScreen(serialize: (scrollback: number) => string, scrollback: number, maxBytes: number = SCREEN_MAX_BYTES): string {
    let lines = scrollback;
    let screen = serialize(lines);
    while (lines > 0 && screen.length * MAX_BYTES_PER_UNIT > maxBytes && jsonExceeds(screen, maxBytes)) {
        lines = Math.floor(lines / 2);
        screen = serialize(lines);
    }
    return screen;
}
