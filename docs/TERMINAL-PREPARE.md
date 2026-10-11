# Prepare in terminal

The workspace host registers ADE CORE's `renderShellCodeBlock` callback. A completed top-level sh/bash/zsh fence in a finished main assistant reply can show a **Prepare in terminal** icon beside Copy. Both buttons sit over the top-right corner on hover or keyboard focus, on a background of their own; on a touch device they stay visible. Rendering and streaming make no requests and never write terminal input. The preview shows the full command, the machine that owns it and its cwd. Only an explicit confirmation fills a selected empty editor, and it sends no Enter.

While the preview is open, it follows the existing terminal sessions in the current project, canvas terminals whose bodies unmounted after a view switch included. It shares existing renderer attachments without asking for another snapshot or consuming their buffered output. These attachments never create a session, resize one or write input. Each holder lets go when it closes, and the last one detaches, also while a remount is still pending.

After a confirmed insertion, Ruimte opens the destination view or canvas, selects its terminal node and focuses the editor once the dialog closes. A cancelled, refused, unconfirmed or stale destination gets no focus. Ruimte checks the session identity, machine and project again before it navigates.

## Editor protocol

PTY output is never evidence of editor state. OSC 133, OSC 7, bracketed-paste markers and prompt text cannot authorize preparation or establish the cwd used by its preview and confirmation.

A new plain Ruimte zsh session gets a `.zshenv` shim under its Ruimte home. The shim restores the person's `ZDOTDIR`, sources their original `.zshenv` and installs ZLE hooks at the first `precmd`. It leaves startup files, shell options and prompt strings unchanged. The bootstrap and every integration hook isolate their options and turn off errexit, nounset and errreturn locally. A failing integration returns to the shell as normal. A startup `read` has no editor channel.

The daemon creates a Unix socket per session in a random mode-0700 temporary directory, with a mode-0600 socket and a random credential. The shell removes the credential and socket address from its exported environment. Each primary ZLE entry opens a new connection and authenticates with the credential, the spawned shell's PID and private protocol version 2. An older integration cannot authorize an insertion. Leaving ZLE closes the descriptor, so a new editor cycle cannot inherit a pending request or preview revision. Continuation editors and `vared` are excluded.

A `zle -F -w` widget handles requests on this separate descriptor. It answers inspection with the live `PWD` and whether `BUFFER`, pending terminal bytes, queued keys and the current decoder sequence (`KEYS`) are empty. On a prepare it checks again, inside the widget invocation itself: an active primary ZLE, an unexpired request, the exact approved cwd, an empty buffer and no pending, queued or partly decoded input. It then claims the request's permit with the `zsh/files` builtin rename in the same private socket directory, sets `BUFFER` and `CURSOR` and redraws. Command bytes never pass through the PTY or reach a builtin `read`.

Each prepare creates a mode-0600 permit before dispatch. The pending operation stays subscribed to `ShellPrompt.input()` through its AbortSignal, and input removes that permit synchronously before the existing Session write reaches the PTY. Whichever comes first, that removal or the editor's rename, wins. A request expires after one second; the timeout revokes the permit and closes the channel. Cleanup on reply or close removes the permit and claim files. ZLE checks the deadline before it changes anything, so a request waiting behind a blocking widget cannot apply later. Only the widget's `prepared` acknowledgement confirms an insertion, and only `refused` confirms an editor refusal. A missing, malformed or lost reply is unconfirmed, even if cancellation was requested, and so is a transport failure after dispatch. The server answers with the `terminal-editor-refused` and `terminal-prepare-unconfirmed` error codes, and the dialog has its own English and Dutch text for each. The consumed ticket and the disabled dialog button rule out a retry. The person has to look at the terminal, since the command may already be there.

This boundary protects against terminal output and concurrent state changes. The person's own shell configuration and the processes running under their OS account stay trusted: this is no sandbox against malicious code that rewrites the integration or reads its private memory or files.

## Server validation and races

The person-only action registry sends the preview and the confirmation to the endpoint and machine identity the chat captured, never falling back to the active or local endpoint. The server checks the source against a closed top-level fence in the persisted, finished main reply. It accepts one visible line of at most 1,000 UTF-8 bytes, rejects control characters and incomplete operators or heredocs, and runs syntax-only checks for the source and destination shells without running the command.

A candidate must be the same live plain session, attached to that client, in the chat's project, with no agent, launch or held command. Its foreground state must be verified and its live editor cwd must match the chat's cwd. A preview ticket expires after one minute and binds the client, machine, source, project, cwd, session instance and editor/input revision.

A confirmation consumes its ticket before its first await, then repeats the source, ownership, membership, attachment, expiry, foreground and revision checks. The last server validation and the editor-channel dispatch share one synchronous turn. The widget repeats the buffer, cwd and editor checks at insertion. User input invalidates the preview at once and revokes any unclaimed insertion in flight, also after dispatch. ZLE checks input that is already inside the tty or decoder. The insertion boundary is the widget's successful permit claim: input that arrives after it is ordinary input that follows. The widget runs the claim and the buffer assignment without processing a key in between. A terminal where someone typed and cleared, or that entered a new editor cycle, is eligible again after a fresh inspection, so a used terminal is not disabled for good. Concurrent confirmations cannot insert twice.

## Live cwd observation

Live editor consumers can call `await session.shellPrompt.workingDirectory()` on the owning machine:

- `{ state: 'known', cwd, revision }` is a fresh observation from the primary ZLE editor, after every prompt hook, a late `precmd` that calls `cd` included. A nonempty edit buffer still gives a cwd.
- `{ state: 'unknown' }` means no valid current observation: unsupported shell, startup, command/builtin input, secondary editor, timeout, disconnect, exit, or input/connection replacement while the request was pending.

There is no fallback to the launch directory or to OSC. The cwd is what the shell said at reply time, not a promise about what it runs next. A consumer must ask for it at the moment it uses it and handle unknown explicitly. `snapshot()` is an internal preview observation only: it is no reliable cwd for file links and authorizes no insertion. A prepare always checks the cwd again inside ZLE.

Historical file links use the cwd attached to their output, not this live observation. [File location links and shell cwd](#file-location-links-and-shell-cwd) describes the shared tracker and the snapshot metadata.

## Daemon API

`Session.write()` calls `ShellPrompt.input()` before it touches the PTY. `ShellEditorConnection.prepare(cwd, command, signal)` and `ShellPrompt.prepare()` resolve to a `ShellPrepareOutcome`: `'inserted'`, `'refused'` or `'unconfirmed'`. `ShellPrompt.prepare()` owns the pending AbortController. The hello frame carries protocol version `2` as its fourth field. The environment hands the shell `RUIMTE_EDITOR_PERMITS`, and the bootstrap removes it from the exported variables. The two error codes travel in the existing error envelope, so no request or result schema names them.

The output-cwd hooks share the isolated bootstrap and keep their incoming status. A cwd notification never acknowledges input readiness or bypasses the editor's permit claim.

## File location links and shell cwd

Ruimte's `FileLocation` contract carries a path, an optional one-based line and column, and an optional inclusive end line. A range needs a start line and cannot run backward. The `file.preview` action also accepts the owning `endpointId`, which it checks before opening a tab. It still accepts the legacy nullable line.

The chat adapter uses ADE CORE's complete `FileRef` and the rendering `ChatScope.id` it passes to `fileLinks.target` and `open`. Markdown links and timeline menus keep the source cwd and scope, mentions and subagent threads included. A missing scope is refused: neither rendering nor activation guesses the active machine or project.

Terminal file links resolve a relative path only with cwd metadata attached to their output. The daemon and the browser share `trackTerminalCwd` from the contracts package; the client imports it through `output-cwd.ts`. It reads OSC 7 file URIs and keeps at most 128 context transitions on xterm markers. Scrollback and reflow keep those transitions. Evicted context, malformed metadata, alternate output and ambiguous rewrites stay unknown. A cwd change within a wrapped logical line invalidates that line. Without a known cwd a relative path is not a link; an absolute path still is. This metadata does not authorize terminal input or bypass the file preview sandbox.

The integrated zsh emits its cwd on `preexec`, `precmd` and `chpwd`. It writes the markers synchronously to `/dev/tty`, so they stay in order even when a command redirects stdout and stderr. Without a reachable controlling terminal it emits no metadata and leaves redirected streams and the shell status alone. Subshell hooks emit unknown context and ignore TTOU only for that metadata write, so fully redirected background jobs can finish under `tostop`. The caller's signal handling, shell options and tty flags stay as they were, and ordinary background tty output still stops. After a cwd change in a subshell, relative links stay unavailable until a trusted foreground hook runs. Concurrent process output carries no per-process cwd.

An OSC 777 footer keeps bounded context metadata inside the existing snapshot string and its byte budget. A restored screen replays on its saved grid before reflow. Old snapshots and shells without the integration have no historical cwd to fall back on. The producer cannot see cwd changes inside external processes, or in shell code that suppresses, replaces or bypasses its hooks, such as `cd -q` and output from an earlier custom `chpwd` hook.

Run the cwd performance gate on its own, apart from the browser tests and typechecks:

```sh
bun --conditions=source apps/server/scripts/benchmark-output-cwd.ts \
    --warmup=1 --repetitions=3 --metadata=none,fixed,changing --enforce
```

Each case writes 50,000 rows after filling scrollback, in one burst or in 128-row chunks, and compares paired medians with absent, fixed and changing cwd metadata. The budget is twice the plain parser time plus 150 ms; the fixed allowance keeps timer noise from blowing up small baselines. The script also checks the retained output and that the cwd context is usable. The default unit suite does not run it.

## Limits and verification

Only zsh terminals started with the integration are eligible destinations, so an existing session has to be reopened. An sh, bash or zsh code block works when its single line also passes zsh syntax validation. Bash with readline and other editors need an equivalent editor protocol; they never fall back to a plain PTY paste. Directory aliases are compared as exact paths, so a different spelling can leave no candidate. Quoted, nested and subagent fences, multiline commands, control characters and some conservative literal operator or heredoc cases are excluded.

Real-shell validation covers zsh on macOS. Nobody has tried Linux or a connection between two physical machines yet. A profile that removes or replaces the ZLE hooks can turn the integration off. A used terminal becomes eligible again once its editor is really empty; a redraw alone grants nothing.

A browser test drives a fenced block from ADE CORE's real chat rendering through Ruimte's host and dispatcher into a real zsh editor. Real-shell regressions cover each race above, in `apps/server/src/sessions`.
