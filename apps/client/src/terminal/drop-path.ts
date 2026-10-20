// Line breaks and escapes in a name are input to the program: xterm's paste keeps ESC, so `ESC[201~` would end a bracketed paste and run what follows.
const CONTROL = /\p{Cc}/u;
const POSIX_SAFE = /^[A-Za-z0-9_@%+=:,./-]+$/;

function posixQuoted(path: string): string {
    return POSIX_SAFE.test(path) ? path : `'${path.replaceAll("'", `'\\''`)}'`;
}

/* `C:\x\y` as Git Bash writes it, `/c/x/y`; a UNC path keeps its two leading slashes. */
function msysPath(path: string): string {
    const slashed = path.replaceAll('\\', '/');
    const drive = /^([A-Za-z]):(\/|$)/.exec(slashed);
    return drive === null ? slashed : `/${drive[1]!.toLowerCase()}${slashed.slice(2) || '/'}`;
}

/* The client does not know a session's shell. On Windows it assumes Git Bash, the default terminal and the shell of every line the daemon types. */
function windowsQuoted(path: string): string {
    return posixQuoted(msysPath(path));
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
