/*
 * The USB HID usage (keyboard page 7) of a physical key, by its `KeyboardEvent.code`. The code names
 * the key where it sits on a US layout whatever the layout prints on it, and so does a usage, so the
 * device applies its own layout to what a person presses.
 */
const NAMED: Readonly<Record<string, number>> = {
    Enter: 0x28,
    NumpadEnter: 0x28,
    Escape: 0x29,
    Backspace: 0x2a,
    Tab: 0x2b,
    Space: 0x2c,
    Minus: 0x2d,
    Equal: 0x2e,
    BracketLeft: 0x2f,
    BracketRight: 0x30,
    Backslash: 0x31,
    Semicolon: 0x33,
    Quote: 0x34,
    Backquote: 0x35,
    Comma: 0x36,
    Period: 0x37,
    Slash: 0x38,
    CapsLock: 0x39,
    Insert: 0x49,
    Home: 0x4a,
    PageUp: 0x4b,
    Delete: 0x4c,
    End: 0x4d,
    PageDown: 0x4e,
    ArrowRight: 0x4f,
    ArrowLeft: 0x50,
    ArrowDown: 0x51,
    ArrowUp: 0x52,
    IntlBackslash: 0x64,
    ControlLeft: 0xe0,
    ShiftLeft: 0xe1,
    AltLeft: 0xe2,
    MetaLeft: 0xe3,
    ControlRight: 0xe4,
    ShiftRight: 0xe5,
    AltRight: 0xe6,
    MetaRight: 0xe7
};

export function hidUsageOf(code: string): number | null {
    const named = NAMED[code];
    if (named !== undefined) {
        return named;
    }
    const letter = /^Key([A-Z])$/.exec(code);
    if (letter) {
        return 0x04 + letter[1]!.charCodeAt(0) - 'A'.charCodeAt(0);
    }
    const digit = /^Digit([0-9])$/.exec(code);
    if (digit) {
        // The row runs 1 to 9 and then 0.
        return digit[1] === '0' ? 0x27 : 0x1e + Number(digit[1]) - 1;
    }
    const functionKey = /^F([1-9]|1[0-2])$/.exec(code);
    if (functionKey) {
        return 0x3a + Number(functionKey[1]) - 1;
    }
    return null;
}
