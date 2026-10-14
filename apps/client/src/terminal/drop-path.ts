// Line breaks and escapes in a name are input to the program: xterm's paste keeps ESC, so `ESC[201~` would end a bracketed paste and run what follows.
const CONTROL = /\p{Cc}/u;
const POSIX_SAFE = /^[A-Za-z0-9_@%+=:,./-]+$/;
const WINDOWS_SPECIAL = /[\s&()[\]{}^=;!'+,`~$]/;

function posixQuoted(path: string): string {
    return POSIX_SAFE.test(path) ? path : `'${path.replaceAll("'", `'\\''`)}'`;
}

/* A guess: the shell behind a Windows session is not known here, and cmd, PowerShell and bash all read double quotes around a path with a space. */
function windowsQuoted(path: string): string {
    return WINDOWS_SPECIAL.test(path) ? `"${path}"` : path;
}

/* The paths of a drop as typed after a prompt: each quoted for the shell of the machine, one space between them and one after the last. */
export function shellQuotedPaths(paths: readonly string[], platform: string | null): string {
    const quote = platform === 'win32' ? windowsQuoted : posixQuoted;
    return `${paths.map(quote).join(' ')} `;
}

/* Whether a path holds a control character (C0, DEL or C1), which no quoting makes safe to type. */
export function hasControlCharacter(path: string): boolean {
    return CONTROL.test(path);
}
