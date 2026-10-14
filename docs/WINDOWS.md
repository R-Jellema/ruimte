# Windows

Windows 11 x64 is not supported yet. The daemon cross-compiles from a Mac
(`bun apps/server/scripts/compile.ts --os win --arch x64` writes `ruimte.exe` with the database
helper beside it), the desktop shell already has a handful of `win32` branches, and
`packages/contracts/src/stored-path.ts`, `fs/browse.ts` and `fs/reveal.ts` already speak drive
letters. Everything else below is open. The npm launcher refuses Windows on purpose until this
list is done (`packages/npm/src/launcher.ts`).

## Decisions

Taken on 2026-10-13. Do not reverse one without asking Bas.

- **Default shell.** `pwsh` when it is on the PATH, otherwise `powershell.exe`. A person's own
  choice still wins. The zsh integration (OSC 7, the editor socket) stays zsh only; a PowerShell
  integration is a later step.
- **Status hooks.** A `ruimte hook <kind>` subcommand of the daemon binary, written into the CLI
  settings by absolute path. It exits 0 without a word when `RUIMTE_HOOK_URL` is absent, the way
  the sh line drains stdin today. macOS and Linux keep the sh line until there is a reason to move
  them; `isOurs` keeps recognizing both by `HOOK_MARKER`.
- **Stopping.** First Ctrl+C (`\x03` through ConPTY, which reaches console apps as
  `CTRL_C_EVENT`), then `taskkill /PID <pid> /T /F` for the whole tree. Force stop goes straight
  to `taskkill`. This replaces both SIGTERM and `kill(-pid)`, which do not exist on Windows.
- **Background service.** A scheduled task per user that starts at logon and restarts after a
  crash, created without admin. It runs in the person's session, so their files, Credential
  Manager and CLI logins are there. Running while nobody is logged on is a later opt-in (a task
  that runs whether the user is logged on or not, under their own account), the counterpart of
  `loginctl enable-linger` on Linux. A Windows service was weighed and rejected: as LocalSystem it
  would run every agent as SYSTEM, and as the user it needs their password.

## Open, in the order they block

### 1. Repository and checks

- `.gitattributes` holds every text file at LF, `.cmd` and `.bat` at CRLF.
- `apps/server/package.json` `dev`: `${RUIMTE_DEV_HOME:-$HOME/.ruimte-dev}` assumes a POSIX shell
  and `$HOME`. Unverified whether Bun's shell on Windows expands `:-`.
- `bun run check` and the unit tests have never run on Windows.

### 2. The daemon starts and stops

- `apps/server/src/daemon.ts:1585` waits for SIGINT or SIGTERM. Windows never sends SIGTERM, and
  `apps/desktop/src/main.ts:314` `kill('SIGTERM')` is a hard stop, so nothing is flushed. The shell
  needs another way to ask for a shutdown (a request over the loopback API, then a hard stop after
  a timeout).
- `apps/desktop/src/main.ts:200` spawns the daemon without `windowsHide`, so a console window
  likely appears.
- `apps/desktop/scripts/launch.ts:16` and `main.ts:519` pass a pipe on fd 3 and listen for SIGHUP
  in dev. Unverified on Windows.
- Secrets (`auth/local-secret.ts:40`, `auth/auth-store.ts:319`, `secrets/secret-store.ts:147`,
  `endpoint-id.ts:365`, `agents/integrations.ts:350`) rely on mode bits that Windows ignores. The
  profile ACL covers them for now; an explicit ACL is a hardening step, not a blocker.

### 3. Terminals

- **PTY.** `apps/server/src/pty/bun-pty.ts:17` uses `Bun.spawn({ terminal })`. Bun's reference
  says POSIX only, its child process guide says ConPTY on Windows. This is the first thing to test
  on a real machine; if it fails, the PTY seam (`PtyAdapter`) takes a Windows adapter.
- `pty/pty.ts:28` falls back to `/bin/bash` without `$SHELL`.
- `sessions/manager.ts:299` runs launches and `exec` sessions as `<shell> -l -i -c`. PowerShell
  needs `-NoLogo -Command`, cmd needs `/c`.
- `sessions/session.ts:170` types the start line with `\n` and spills long lines into
  `eval "$RUIMTE_..."`. Unverified whether PSReadLine submits on LF.
- `sessions/session.ts:114` `plainShell` knows only sh, bash and zsh.
- **Dropped paths.** `apps/client/src/terminal/drop-path.ts` wraps a path with a space or a shell
  character in double quotes on Windows. That is right for neither shell: in cmd `%VAR%` still
  expands inside double quotes, and in PowerShell `$` and the backtick expand inside double quotes
  while single quotes are literal. The shell behind a session is not known on the client, so the
  quoting needs the session's shell (`pwsh` by default, see the decisions) once terminals run.
- `bun-pty.ts:48` and `session.ts:356` send SIGHUP and then SIGKILL; on Windows that stops the
  shell and leaves its children. Follows the stopping decision.
- `launches/sessions.ts:28` and `processes/foreground.ts:6` read the foreground group through
  `ps`, and `prepare-terminal.ts:75` refuses whenever that answer is null, so preparing a command
  line never works on Windows.
- `packages/contracts/src/terminal-cwd.ts:8` and `sessions/shell-prompt.ts:68` take only paths
  that start with `/`.

### 4. Agents

- **PATH.** `sessions/manager.ts:740` and `chat/chat-manager.ts:114` join with `:` instead of
  `path.delimiter` and write `PATH` where Windows has `Path`. `ruimte-context` is out of reach and
  the first entry of the PATH breaks, in every terminal and chat.
- **The shim.** `apps/server/bin/ruimte-context` is `#!/bin/sh` and tests for `ruimte`, not
  `ruimte.exe`. It needs a `ruimte-context.cmd` beside it, also in `compile.ts:153`.
- **Hooks.** `agents/install.ts:29` writes the sh line. Follows the hook decision.
- **Quoting.** `providers/launch.ts:61` and `launches/detect.ts:109` (used up to `detect.ts:418`
  and in `launches/vscode.ts:131`) quote for POSIX shells only.
- **Spawning CLIs.** `@adecore/agents` `chat/chat-process.ts:40` and `providers/launch.ts:73`
  spawn `claude` and `codex` by bare name. The native `claude.exe` resolves; npm's `codex.cmd`
  needs a shell. Unverified how Bun resolves `PATHEXT`.
- **Stopping a chat.** `@adecore/agents` `chat/chat-process.ts:45,79` spawns detached and stops
  with `kill(-pid)` in a try, so on Windows a chat is never stopped and outlives the daemon. A fix
  in ADE CORE.
- `agents/integrations.ts:62` expands `~` with `env.HOME ?? ''`, which is relative on Windows.

### 5. Paths from git and in the client

- `git/status-watcher.ts:70,97,171` compares git's `C:/x/y` with the watcher's `C:\x\y`, so every
  event looks outside the checkout and triggers a status run.
- `git/run.ts:98`, `git/repos.ts:134`, `git/status.ts:204`, `git/worktrees.ts:79`,
  `git/checkpoints.ts:115` and `provenance/file-versions.ts:12` mix git's forward slashes with
  `resolve()` in keys and comparisons. Normalize where git output enters the daemon.
- `database/sql-analysis.ts:35` and the client's `database/console-file.ts:30` build prefixes
  with `/`.
- `language/host.ts:1145` appends `/` in `holdsUnder`.
- Client spots that take a daemon path to be absolute only with `/` or split on `/`:
  `launches/model.ts:157`, `launches/editing.ts:135,149,239,279`, `language/project-files.ts:13`,
  `state/file-moves.ts:54`, `editor-ai/inline-edit-session.ts:557`, `launches/LaunchesPanel.tsx:37`,
  and the `${cwd}/${path}` joins in `GitFileList.tsx`, `GitPanel.tsx`, `file-rename.ts` and
  `ImageSaveHost.tsx`. `files-tree.ts:46` already handles both.
- `projects/project-files.ts:112` and `fs/rename.ts` rename without the retry Windows needs for a
  file another process holds open.
- `fs/trash.ts:89` refuses on Windows. Deleting to the Recycle Bin is a later step.

### 6. Packaging and the service

- `apps/desktop/electron-builder.yml` has no `win:` or `nsis:` section: no icon, no signing, no
  `artifactName`, and no `latest.yml` for `electron-updater` (`main.ts:1283`).
- `@adecore/service` has no Windows manager (`platform.ts:9`). The scheduled task goes there, as a
  change in ADE CORE; the callers already ask for it by `'windows'`.
- The npm launcher's refusal comes off last.

## Testing

Development stays on the Mac. A Windows 11 x64 PC is reached over SSH (`Host winpc`, key
`~/.ssh/winpc`) with PowerShell 7 as its shell, and an agent runs `bun install`, `bun run check`
and the tests there per step. A process started over SSH has no desktop, so the desktop app and
anything with a window are tested by a person at the PC.
