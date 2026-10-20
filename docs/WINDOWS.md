# Windows

Windows 11 x64 runs, but is not supported yet. The base is Rick's work from
[#64](https://github.com/basmilius/ruimte/pull/64): the daemon and the desktop app build, install and start
there, a terminal runs in Git Bash and ends cleanly, and `ruimte-context` reaches the daemon from inside it.
What is left is below. The npm launcher refuses Windows on purpose until this list is done
(`packages/npm/src/launcher.ts`).

## Decisions

Do not reverse one without asking Bas.

- **Git for Windows is required.** Ruimte needs `git` for its panels, worktrees and checkpoints anyway, and
  Git Bash gives the daemon one shell dialect on every platform. The daemon finds `bash.exe` beside the
  `git` on the PATH, then under Program Files and LocalAppData (`apps/server/src/pty/pty.ts`). Without it
  the app says so and names where to get it, instead of falling back without a word. Taken on 2026-10-20,
  replacing the earlier choice of PowerShell as the default shell.
- **Every line the daemon types runs in bash.** An agent's start, a resume with `||`, a long line through
  `eval`, a launch and an `exec` session are POSIX and go to Git Bash, so the daemon never quotes for a
  second dialect. A person's own shell (`pwsh`, cmd) is fine for a plain terminal that starts nothing.
- **Status hooks keep the sh line.** Claude Code runs its hooks in Git Bash on Windows, so the line
  `agents/install.ts` writes works unchanged. The `ruimte hook` subcommand from the earlier plan is dropped
  until a CLI turns out to run hooks outside a POSIX shell.
- **Stopping.** An interrupt is Ctrl+C on the console (`\x03` through ConPTY). Every other stop takes the
  whole tree with `taskkill /PID <pid> /T /F` (`apps/server/src/pty/bun-pty.ts`), since SIGHUP, SIGTERM and
  `kill(-pid)` do not exist there. Chats already stop that way in `@adecore/agents` (`killProcessTree`).
- **Background service.** A scheduled task per user that starts at logon and restarts after a crash,
  created without admin. It runs in the person's session, so their files, Credential Manager and CLI logins
  are there. Running while nobody is logged on is a later opt-in, the counterpart of `loginctl
  enable-linger` on Linux. A Windows service was weighed and rejected: as LocalSystem it would run every
  agent as SYSTEM, and as the user it needs their password. Until the task exists, the desktop app runs the
  daemon as its child.

## Done

- PATH with `;` and under the name the variable already has (`apps/server/src/env-path.ts`), in terminals
  and chats.
- `ruimte-context` finds `ruimte.exe`, and `ruimte-context.cmd` ships beside it for cmd and PowerShell.
- Terminals start in Git Bash with `-l`; `shellName` drops `.exe`, so `plainShell` applies.
- Ending a session, as in the stopping decision.
- Deleting to the Recycle Bin (`apps/server/src/fs/trash.ts`).
- `bun run dev` through `apps/server/scripts/dev.ts`, since Bun's shell on Windows has no `${VAR:-default}`
  and no `HOME`.
- `win:` and `nsis:` in `apps/desktop/electron-builder.yml`: an installer and a zip, unsigned.
- `bun run check:types`, `lint` and `format:check` pass on Windows.

## Open, in the order they block

### 1. Repository and checks

- `.gitattributes` holds every text file at LF, `.cmd` and `.bat` at CRLF. With `core.autocrlf` on, a
  checked-out fixture reads CRLF and tests fail.
- Many unit and integration tests assume `/bin/sh` or POSIX paths. A Windows job in CI follows once they
  pass.

### 2. The daemon starts and stops

- The shell requires Git for Windows, as decided: a check at start and a clear message, where `pty.ts` now
  falls back to `pwsh`, `powershell` and cmd.
- `apps/server/src/daemon.ts:327` waits for SIGINT or SIGTERM. Windows never sends SIGTERM, and
  `apps/desktop/src/main/service.ts:227` `kill('SIGTERM')` is a hard stop, so nothing is flushed. The shell
  needs another way to ask for a shutdown (a request over the loopback API, then a hard stop after a
  timeout).
- The desktop app spawns the daemon without `windowsHide`. Unverified whether a console window appears.
- Secrets (`auth/local-secret.ts`, `auth/auth-store.ts`, `secrets/secret-store.ts`, `endpoint-id.ts`,
  `agents/integrations.ts`) rely on mode bits that Windows ignores. The profile ACL covers them for now; an
  explicit ACL is a hardening step, not a blocker.

### 3. Terminals

- **Git Bash paths.** Git Bash writes `/c/Users/...`. `packages/contracts/src/terminal-cwd.ts` and
  `sessions/shell-prompt.ts` take only paths that start with `/` and have no drive letter, so the cwd of a
  terminal stays `null`. A bash integration (OSC 7 through `PROMPT_COMMAND`, the counterpart of the zsh
  one) and a conversion from `/c/` to `C:\` fix both.
- **Path conversion.** MSYS rewrites an argument that looks like a POSIX path when bash calls a native
  `.exe`. Where that breaks a line the daemon types, set `MSYS_NO_PATHCONV=1` for it.
- **Dropped paths.** `apps/client/src/terminal/drop-path.ts` wraps a path in double quotes on Windows. With
  Git Bash behind every agent and launch, POSIX single quotes on the converted path are right.
- `launches/sessions.ts` and `processes/foreground.ts` read the foreground group through `ps`, and
  `prepare-terminal.ts` refuses whenever that answer is null, so preparing a command line never works on
  Windows.

### 4. Agents

- **Spawning CLIs.** `@adecore/agents` `chat/chat-process.ts` and `providers/launch.ts` spawn `claude` and
  `codex` by bare name. The native `claude.exe` resolves; npm's `codex.cmd` needs a shell, so a Codex chat
  cannot start. In a terminal it works.
- `agents/integrations.ts` expands `~` with `env.HOME ?? ''`, which is relative on Windows.

### 5. Paths from git and in the client

- `git/status-watcher.ts` compares git's `C:/x/y` with the watcher's `C:\x\y`, so every event looks outside
  the checkout and triggers a status run.
- `git/run.ts`, `git/repos.ts`, `git/status.ts`, `git/worktrees.ts`, `git/checkpoints.ts` and
  `provenance/file-versions.ts` mix git's forward slashes with `resolve()` in keys and comparisons.
  Normalize where git output enters the daemon.
- `database/sql-analysis.ts` and the client's `database/console-file.ts` build prefixes with `/`.
- `language/host.ts` appends `/` in `holdsUnder`.
- Client spots that take a daemon path to be absolute only with `/` or split on `/`:
  `launches/model.ts`, `launches/editing.ts`, `language/project-files.ts`, `state/file-moves.ts`,
  `editor-ai/inline-edit-session.ts`, `launches/LaunchesPanel.tsx`, and the `${cwd}/${path}` joins in
  `GitFileList.tsx`, `GitPanel.tsx`, `file-rename.ts` and `ImageSaveHost.tsx`. `files-tree.ts` already
  handles both.
- `projects/project-files.ts` and `fs/rename.ts` rename without the retry Windows needs for a file another
  process holds open.

### 6. Packaging and the service

- The release pipeline builds Windows behind the repository variable `WINDOWS_RELEASE`: the installer,
  `latest.yml` and the zip in `release.yml`, `@ruimte/win32-x64` in `npm.yml`, `/download/windows` on the
  site (`docs/RELEASE.md`, "Windows"). Open: code signing, publishing the npm placeholder, and turning
  the variable on.
- The site detects Windows and offers the installer once a release has one.
- `@adecore/service` has no Windows manager (`platform.ts`). The scheduled task goes there, as a change in
  ADE CORE; the callers already ask for it by `'windows'`.
- The npm launcher's refusal comes off last.

## Not on Windows

iOS devices and simulators, computer use, the Apple model and Speech to Text stay macOS only. Android
devices are not enabled yet.

## Testing

Development stays on the Mac. A Windows 11 x64 PC is reached over SSH (`Host winpc`, key `~/.ssh/winpc`)
with PowerShell 7 as its shell, and an agent runs `bun install`, `bun run check` and the tests there per
step. A process started over SSH has no desktop, so the desktop app and anything with a window are tested
by a person at the PC.

Open questions for the next test at the PC:

- Does `bash -l` start in the folder the session asked for, or does Git Bash's profile move it to `$HOME`?
- Does a console window appear beside the desktop app when it starts the daemon?
- Does deleting a file that another program holds open show a Windows error dialog?
- Does an agent started from a terminal report its status through the hooks?
