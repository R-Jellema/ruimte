# Next

This plan holds only open implementation, decisions and verification. Each numbered package
is a reviewable change; split a larger package into issues when implementation starts. The order
is a recommended priority. Run measurements or a design spike before estimating larger work.

Reviewed against `10098374c` on October 14, 2026. Implementation, acceptance and product decisions
are separate tasks below. The ADE CORE extraction, initial language-server implementation and
multiwindow implementation are complete; their remaining acceptance does not require rebuilding them.
The decisions of October 14 are written into the packages. Everything built from this plan ships in 0.19.0.

## Implementation order

| Package                               | Priority                                      | Depends on                                                  |
| ------------------------------------- | --------------------------------------------- | ----------------------------------------------------------- |
| 1. Chat lifecycle and native requests | When a natural capture occurs                 | Nothing                                                     |
| 2. Status routing and housekeeping    | Next                                          | Nothing                                                     |
| 3. Test floor and measurements        | Early                                         | Nothing for a baseline                                      |
| 4. Keyboard and settings              | Next                                          | Nothing                                                     |
| 5. File entry points                  | Next                                          | Nothing                                                     |
| 6. Terminal basics                    | First                                         | 4 for new bindings                                          |
| 7. Canvas ergonomics                  | Next                                          | 4 for bindings; baseline from 3                             |
| 8. Chat depth                         | First for 8.1, 8.3, 8.4 and 8.6               | 1 for lifecycle; 5 for shared file locations                |
| 9. Accounts                           | Next                                          | 1 for continuation/recovery                                 |
| 10. Remote access and media           | First for 10.6, the rest Next                 | Measurements from 3                                         |
| 11. iOS, devices and worktrees        | Next                                          | 1 for task status; 5 for locations                          |
| 12. Intelligent UI                    | Next                                          | Nothing; step 1 waits on an appearance review               |
| 13. Multiple windows                  | Acceptance                                    | Existing implementation; baseline from 3                    |
| 14. Copilot and Gemini chat           | Later                                         | 1 and 9; compatibility checks below                         |
| 15. Editor and language servers       | Acceptance and remaining features             | Existing implementation; server policy per addition         |
| 16. Plugins                           | After 1.0                                     | Registry inventory and a compatibility release              |
| 17. Linux and Windows                 | Linux integration first, Windows per its plan | Platform spikes and CI; ADE CORE API cleanup before Windows |

Measurements must finish before changing the WebGL budget, splitting the composer chunk or
choosing media buffer sizes.

## 1. Chat lifecycle and native requests

Sources: `@adecore/agents/chat`, task coordination and the host's resume handlers.

The fixes for Queue, Stop, recovery, durable task delivery and native-request ownership are in.
Only the live evidence below is left; do not rerun historical implementation prompts.

Capture a natural provider-limit/reset sequence when one occurs, with a new bounded probe against
the current packages. A quota read alone is not a refusal/reset replay, and nobody spends budget
to force a limit. Keep a natural capture of early-before-tool metadata or a mid-run child model
change too, if one occurs; deterministic regressions already cover those orderings. Neither capture
gates other work.

The remaining full-client memory verification belongs to package 3.

## 2. Status routing and housekeeping

9. Reproduce the status-routing problem when someone types `codex` manually in a shell. Use
   `apps/server/src/providers/launch.ts` as the baseline. Do not replace shell configuration or
   infer status from terminal output.
11. Prune hidden agent chats when the daemon starts, never on a clock. A chat goes when its task
    settled more than 30 days ago, it sits in no view and it has no living child. Hidden agent
    chats are the main growth of `chats/`.
12. Add `ruimte notify`, so a local script raises a notification through the local secret. No
    notification token goes to anything outside the machine.

Done when handwritten launches have a verified route or limitation, a test covers each pruning
condition and that it runs at start only, and `ruimte notify` refuses without the local secret.

## 3. Test floor and measurements

2. Add the dev-only palette command that creates a reproducible 30-node scene. Measure input
   latency, frame time, heap and mount/read counts for terminals, chats and files, then nine grid
   cells. Measure ten file nodes with representative large files, including zoom below/above the
   editor gate and repeated view switching.
3. Measure the fixed ten-context WebGL budget on representative hardware and under context loss.
   Base any cap or adaptation change on those results. That does not by itself call for a user setting.
4. Finish the collected Electron heap and frame/latency measurement for a 100-idle-chat
   full-client fixture. Recreate the fixture against the current ADE CORE packages; get app access
   for any computer-use round. Do not infer collected Electron heap from RSS or change cache/GC
   policy before measuring this workload.
5. Run the latency harness and record the result. Binary frames have their own lane and a channel
   above the backpressure limit closes, so what is left is whether one busy session can still
   dominate the socket.
   `bun run --cwd apps/server measure:latency --channel both --seconds 60 --out ~/latency.json > ~/latency.md`
   runs the daemon and a measuring client in two processes, with one terminal printing as fast as it
   can. It records reply time (`server.ping`), the echo of a key in a quiet terminal and the first
   event of a chat, idle and under that load, plus the daemon's event-loop lag, the busy terminal's
   MB/s, resyncs and gate pauses. Run it on the power adapter with other apps closed, three times,
   and keep the median run. The direct channel is werift on both ends over loopback: it measures
   the daemon's side (the gate, framing, SCTP buffering) and not Chromium's WebRTC stack or a real
   network path, and werift may be the bottleneck itself. A network number needs the Electron app
   on a second machine through the LAN door. The report ends with the per-session quota decision:
   a quota is worth it when p95 of the reply or quiet-session time under load is above 100 ms, or
   above 3x the idle p95. If it is, add fair per-session limits that preserve replies/chat events
   and repair dropped terminal output through `session.resync`.
6. Measure workspace startup and composer chunk cost before splitting CodeMirror. Exporters and
   palette commands already load on use. Split the chunk only when the measurement shows a startup
   improvement, then repeat that same measurement.
7. Record desktop, visual and screen-reader acceptance of the ADE CORE cutover: file navigation
   and selection, staged/mixed Git checkboxes, menus and drags, editor typing/undo/search, language
   popups and AI actions. For the implemented tabs, canvas and model comparison, check browser/
   terminal state while switching tabs, unsaved database work and shared views, gap undo/cancel at
   50% and 200% zoom, trackpad selection, browser/device pan ownership and model-chart keyboard,
   touch and narrow-window use. Shared source already lives in ADE CORE; do not repeat the extraction.
8. Recheck the remaining October 2 audit scenarios against current code. These are historical
   follow-ups, not newly confirmed bugs: person-check steps completed through agent substeps
   (ACT-04); pause/takeover during long device typing (NAT-05); detach during DeviceClient attach
   (CLI-04); git.unwatch during watch setup (SRV-05); explicit-send queue state after restart
   (AGT-03); one empty line versus an empty conflict result (ACT-02); plan-Markdown whitespace
   roundtrips (ACT-08); and unsaved edits during competing project opens (CLI-03). Check automated workflow-pin updates and the iOS
   fixtures in UnifiedProjectsTests, WorkspaceVisualTests, SessionVisualTests, AttentionStoreTests
   and PhaseZeroTests rather than carrying forward the old failure count.
   Remaining manual cases include approval focus, sleep/reconnect, quit with no open window,
   preview script redirects, dictation/Voice across windows, resolve-with-agent via stdin, first
   service start on a fresh Mac, AppImage quit and daemon-crash recovery, cancellation during
   long computer/device input, wireless device streaming, closing iPhone media, brief
   notification-page disconnects, and terminal file links and session port chips on a remote
   machine. Check existing results before repeating these cases. The device runbooks per app
   (iPhone and iPad, push, Speech to Text, Apple Foundation Models) are in [ACCEPTANCE.md](ACCEPTANCE.md).

Done when the baseline, hardware/build, fixture sizes and results are recorded with units, and
any measured regression has a bounded follow-up. Choose performance acceptance budgets from the
baseline before optimizing; the node counts alone are not a latency target.

## 4. Keyboard and settings

Sources: the app/canvas/terminal shortcut handlers, `shell/settings/shortcuts.ts`,
`shell/settings/search.ts` and `state/settings.ts`.

1. The command table (`shell/command-table.ts`) already feeds the menu, the palette and the window
   and workspace shortcuts. Make the Keyboard panel (`shell/settings/shortcuts.ts`) read it too
   instead of its own lists, and add `when` contexts for keys; today's `when` is a menu context.
   Preserve terminal/browser ownership and the existing drawing/prompt-widget exceptions.
2. Add persisted overrides, press-to-record, context-aware conflict labels, per-binding reset and
   Restore defaults. An invalid override cannot make the app's essential controls unreachable.
4. Add a separate canvas font size for chat and text elements, preserving the current interface
   and terminal font sizes. Only text without its own size follows it.

Done when changing a binding changes both behavior and the displayed key, overlapping contexts
are tested and reset restores defaults.

## 5. File entry points

1. Let a file node keep a location. `FileLocation` (`packages/contracts/src/file-location.ts`)
   and opening a tab at a line, column or range (`state/files.ts`, `shell/panels/reveal-location.ts`)
   exist; a file node still stores only its path. Older clients must keep the stored node, but
   `ProjectNodeSchema` is a plain object that drops a field it does not know. Ship a release that
   keeps unknown node fields in the client and the daemon first, as for a new kind, and write the
   location only in the release after it.
2. Probe installed external editors, add an editor preference and implement `fs.open` with a
   structured path/line location. The preference belongs to the machine that holds the file. Route
   file menus, diff rows and terminal file links through it, on that machine. Handle an
   unavailable editor and paths containing spaces.

Done when a location opens the correct line from every entry point and reloads/older clients
preserve the stored node.

## 6. Terminal basics

1. Register xterm as a host of the shared find bar, with next/previous, result state and disposal.
2. Type a shell-quoted path when a local file is dropped on a terminal. Use the existing Finder
   bridge and remote-machine refusal rules; dragging a local path to a remote shell is not a valid path.
3. Enable matching Unicode 11 widths on client and headless xterms. Compare attach/resync snapshots
   with the client after resize, wide characters and emoji.
4. Add Clear to the node context menu (`canvas/NodeMenu.tsx`) and the terminal's own context menu
   through the existing `terminal.clear` action. The app menu already has it.
5. Add Send to linked chat for a terminal selection. Append a fenced block to the chosen linked
   chat's draft without sending; offer a chooser when several chats qualify.

Done when search, drop and Clear work in both a terminal view and node.

## 7. Canvas ergonomics

Directional selection, input focus, direct node zoom, gap dragging, selection during scrolling,
connector label layering, explicit pan ownership and local camera history are implemented. Current behavior is in
[the client README](../apps/client/README.md#canvas-interaction); manual checks belong to package 3.

2. Add align and tidy as pure geometry functions. Arranging the direct members of a group and
   `arrangeRects` (`packages/contracts`) exist. Expose them in palette/menu and undo each operation
   as one change.
3. Rank palette results by exact match, prefix and substring; add `>` for actions. A setting that
   names the query already ranks above loose file hits. Track recently visited nodes independently
   of recent commands, and use them on an empty query.
4. Save pasted images under `<folder>/.ruimte/images` and create file nodes pointing at them. A
   project without a folder saves them under `$RUIMTE_HOME/images/<project>`. A failed write shows
   a toast and creates no node. Nothing removes images by itself; add the action "Clean up unused
   images".
5. Add optional color/arrowhead styling to plain lines, preserving the meaning and permissions
   of context/target/origin edges. Give notes a first body heading derived from their title without
   duplicating or overwriting an existing heading. Renaming a note updates that heading only while
   it still equals the old title.

Done when geometry changes undo cleanly, focus never takes over another surface's keys,
and image/line/note data survives save and reload. Confirm the measurements from package 3 still hold.

## 8. Chat depth

1. Preserve attached chats in `StashedPrompt`, parsing older entries as an empty list. Restore only
   references still readable in the destination project.
2. Keep a settled question outside its turn fold; today it still folds with the turn. A running
   workflow already stays outside the fold and the activity chip shows progress and who waits.
   Include workflow members in the activity list above the composer.
3. Offer Continue in an empty composer after a person stopped a turn. Reuse the normal continuation
   path and keep its queue/limit behavior consistent with package 1.
4. Add Clear to a chat node's menu through the existing action, after package 1 defines child cleanup.
6. Expose fork to agents through the action registry and context CLI. An agent forks only a chat
   it opened itself, within its permission ceiling, and a fork counts toward depth. Check lineage,
   project, account and ceiling. `chat.fork` currently admits only person/voice actors.
7. Add Restore files to this turn as a separate action. It touches only the files the turn
   changed. A file someone else changed afterwards is a conflict and is restored only when ticked
   in the diff, which the person reviews before the restore runs. Keep the existing fork into a
   new worktree behavior; that does not restore the original folder.

Done when draft references survive stashing, folds do not hide needed context or active work,
and fork and restore actions enforce their actor and file boundaries.

## 9. Accounts

Source: `@adecore/agents/providers/accounts`. Nobody has used a second real account yet.

1. Verify two real Claude account folders retain separate logins after daemon/app restart, each
   showing its own email after a restart of the Mac, and a real Codex conversation continues on
   another account in the same thread through its shadow home ("Continue on account"). Record
   versions and outcomes without reading vendor credentials.
2. Verify login started from iPhone and station. Codex's device-auth route is a candidate; establish
   what Claude's browser callback requires when the browser and CLI are on different machines.
   Implement only the missing flow, preserving the distinction from Ruimte's own account login.
3. Share `CLAUDE.md`, skills, agents and commands between an additional Claude account and
   `~/.claude` through symlinks. Give the account `settings.json` once, as a copy. Never share
   authentication, history or `projects/`, and never overwrite an explicit account configuration.
4. Drop the background behind the machine tiles in the Account pane, as the other settings icons did.

Known limits, accepted for now: a Claude chat cannot move to an account with another folder after
its first turn (fork instead); Gemini and Copilot only have their default account until it is known
which variable points at their folder; a non-default account is read for limits on the clock only
when used in the last 24 hours, a time the daemon keeps in memory only; "Show folder" copies the
path, since the desktop bridge cannot reveal a folder.

Done when the real-account checks pass and mobile/web login either succeeds or has a precise
remaining provider limitation. Folder-isolation tests alone cannot establish login isolation.

## 10. Remote access and media

1. Reproduce the iPhone's direct connection dropping during the 56 Mbit/s video. Correlate ICE,
   channel, broker and media request events to distinguish a connection failure from a decoder or
   buffer stall. Fix the cause before increasing buffering.
2. Verify audio in Electron dev over a socket and a direct connection, including seek, reconnect
   and repeated playback. Add desktop spool/read-ahead only if measurements show a benefit;
   define its disk/memory bounds and invalidation on file version changes.
3. Measure TURN on real carrier-grade NAT networks, record which route was selected and compare
   throughput/latency. TURN configuration alone is insufficient evidence.
4. Move the broker to its production server: inventory the current deploy configuration, prepare
   health checks and rollback, validate the replacement, migrate, then remove the test droplet.
   The infrastructure cutover/deletion is a separate operational step when implementation reaches it.
5. Check an expired station login at cold start and during reconnect. The start screen must show
   the reason and a usable sign-in action instead of an indefinitely waiting project.
6. Remove the branches for machines without `features` (issue #60). The first release that sends
   `features` is the minimum, and from the release after it clients check `features` only. After
   this, nothing outside the transport layer catches `unknown-request` (11 catches in the client,
   21 in the iPhone app). A machine whose `endpoint.info` has no `features` makes the client ask
   to update the machine; cover that with a DOM test.
7. Verify the implemented LAN door on real devices: iPhone and iPad on the same Wi-Fi as
   the MacBook show Local network, also with `--no-broker` after a first connection; on 4G the
   connection opens through the broker with at most a second more. Check whether the macOS firewall
   asks about the npm binary listening on the LAN, and what the iPhone does when Local Network access
   is denied. (Electron 44 lets the `app://ruimte` page open `ws://` and `fetch` to loopback and to a
   LAN address; checked with a probe on 2026-10-04.) Check the same login and connection flow on
   a fresh Linux machine. The LAN door, account-only access, route race and `ruimte status` exist;
   pairing has been removed.
9. Verify the deployed broker, worker, station, desktop and iOS versions against their current
   account/statement and upgrade rules. The old audit's unverified deployment items included
   worker migration 0014, broker envelope preservation and TURN allocation limits. Inspect actual
   deployments and run a bounded TURN allocation test; an old source commit or deploy recipe
   does not establish what is running.

Done when connection drops have an explained, tested outcome, real-network media/terminal
measurements meet the agreed budgets, broker migration has verified rollback and nothing outside
the transport layer catches `unknown-request`. Preserve the existing binary reply path, range
streaming and explicit direct-connection failure behavior.

## 11. iOS, devices and worktrees

1. Add typing to physical iOS devices behind the existing backend input capability. Verify Unicode,
   multiline text and the taken-over/stopped state on an actual device. Android emulators and
   phones paste any text through the device clipboard since issue #56.
3. Verify the implemented visual replies on a real iPhone in both themes, with links opening in
   Safari. Check desktop/station rendering and the machine's off switch too. The daemon verb,
   preview renderer, sandbox host and native iOS presentation are already built; the current
   behavior is documented in the server and iOS READMEs.

Done when phone acceptance checks are recorded. A merge into a branch checked out nowhere stays
refused (`target-not-checked-out`) until someone asks for it. Installing apps and device logs
remain out of scope.

## 12. Intelligent UI

Blocks render and take input on the desktop and the iPhone, and choices reach the chat. What is
left is native presentation, the size of the agent's note and acceptance measurements. The
catalog additions decided on October 14 (timeline, gallery, map, text fields, diff and schema
views, host components) are planned in the Generative UI report; this package keeps the items
below.

1. Collect the appearance review per element in the real desktop and iPhone apps, including light,
   dark, narrow windows and accessibility, and work it through. No concrete list exists yet.
2. Turn a `[1]` reference in a native block's prose into a source chip that jumps to its Source row,
   as the desktop does. Today `UiInlineRun` draws prose as attributed text and `UiSourceView` gets
   no number. VoiceOver names the source, and an unclear reference stays text.
3. Show a failed live read natively as the previous value, dimmed, with the error in the footer.
   Fade a changed value from the accent to normal once over 800 ms, keep digit widths, and skip the
   fade under reduced motion (`UiDataViews.swift`). `Stat.previous` is a comparison the agent
   writes, not the history of a query.
4. Fade in newly written words of prose that grows in a native block, without changing the
   identity or focus of an input. Expressions, code and labels stay literal; reduced motion shows
   the text at once.
5. Shorten the UI note an agent gets. The plan's goal was under 600 tokens, and the catalog
   additions of October 10 brought the UI and visual notes to about 3,700 characters. Keep the
   example, which stops agents from writing components as function calls, and the rules for
   bindings and choices. The example must still compile after the visual note joins it and on resume.
6. Run the evaluation set: twenty real work questions per CLI and model, three times each, with no
   syntax hint in the prompt. Record CLI and model versions, language, fresh start or resume,
   compiles without diagnostics, empty renders, the choice between a block and prose, and prompt
   cost. A recurring failure gets a catalog rule and a regression test.
7. Measure cold replay, several concurrent chats and recorded real Claude and Codex answers. Agree
   on the acceptance limit first; record input size, hardware, runtime, samples, medians and tails.
8. Run the iOS app test target, beyond the Swift package tests that already pass, and check the
   other consumers of `@adecore/intelligent-ui` against the published release.

Done when the native views match the desktop for sources, live values and growing prose, the note
meets an agreed size with a compiling example, and the evaluation and measurements are recorded
with their limits.

## 13. Multiple windows

Acceptance only. `createWindows`, project claims, sender-bound IPC, restored window targets and
shared-storage synchronization already exist.

1. Use two local/remote projects side by side. Check menus, dialogs, browser guests, notifications,
   shared settings and project claims from both windows.
2. Reload and reopen the app; verify project URLs and window bounds, including a removed display.
3. Close a window and confirm its client detaches while daemon sessions survive. Explicit project
   closure still follows the last-client rule. Exercise unsaved edits during a window move.

Done when these cases have recorded desktop evidence. Fix any reproduced gap in the existing
implementation; do not introduce another window registry.

## 14. Copilot and Gemini chat

Source: [the provider research](reports/2026-09-25-provider-research.html).

1. Correct the existing Copilot terminal first-prompt behavior separately: it still uses `-p` in
   `apps/server/src/providers/terminal-providers.ts`. Verify the installed CLI's interactive flag
   (the report proposes `-i`) and ensure the session remains open after its first answer.
2. Recheck supported versions and run bounded Copilot SDK versus ACP and Gemini ACP spikes.
   Choose Copilot's transport from actual permission/question/resume and packaged-Bun behavior.
   Keep any shared ACP parsing independent of a provider's unstable model-selection extension.
3. Implement one backend and protocol mapper per provider in `@adecore/agents`, with capability
   discovery, accounts/login probing, model selection, streaming, Stop, approvals, questions and resume.
   Add terminal hook normalization only for documented status/context events; leave TUI answers there.
4. Test desktop and iOS against these existing provider words. Separately design unknown-provider
   handling in `@adecore/agent-contracts/agent.ts` so an older desktop does not reject a whole
   answer. Confirm the iOS open-enum build has shipped before introducing any new enum word;
   regenerating schemas is not proof that the installed app has that change.

Done per provider when two turns, denied writes, an open approval stopped by the person, restart
and account/login failures work in the packaged app. Do not promise an SDK/API choice before the spike.

## 15. Editor and language servers

Current integration: [the client README](../apps/client/README.md#code-editor) and
[the daemon README](../apps/server/README.md#language-servers). The ADE CORE editor/LSP host,
server installation, multiple servers, custom commands, TypeScript sidecar and native PHP
integration are built. Monaco is removed. Formatting follows the language server's style, with
tab size and indent style from `.editorconfig`; no external formatter runner is planned.

1. Finish manual editor, AI and accessibility acceptance with the shared packages, including
   zoomed file nodes, navigation to unopened files, typing/undo, search, language popups,
   multi-file create/rename edits, stale results, crash/restart and local/remote clients.
2. Check install, update, rebuild and previous-version actions with actual server binaries.
   Keep installation and custom-command approval with the person on the machine.
4. Add remaining native/toolchain servers only after specifying installation and execution rules,
   especially project code, build scripts and proc macros in agent worktrees. Rust, Go, Swift,
   TOML, Lua, Zig and Markdown remain candidates, not completed catalog entries.
5. Address remaining limits as separate features in the owning shared package or host:
   file views retaining their old path after a move; project-wide diagnostics beyond open
   documents; column-precise file navigation; match highlighting and more than thirty files in
   peek; and review rows hiding unchanged ranges. Server progress percentages depend on servers
   reporting them. On-device help currently omits explanations for non-function symbols, Explain in
   the context menu and automatic suggestions while typing.

Done per accepted feature when the required runtime/device evidence exists. Fake-server tests
remain deterministic tests; real language servers belong in integration tests.

## 16. Plugins

Source: [the plugin report](reports/2026-09-14-plugins.html). Plugins come after 1.0, and the first
model is declarative: context, commands and panels, with no executable code.

2. Ship the required compatibility changes before writing plugin kinds or ids. Preserve unknown
   plugin data in project and client-local state, including when a plugin is absent. Inventory the
   existing action/verb registries and only deepen the missing ones.
3. Implement a manifest and install/disable/error lifecycle under `$RUIMTE_HOME/plugins` for the
   declarative model. Opening a repository must not execute its suggested plugins.
4. Executable code stays out of scope until the declarative model proves insufficient. Then
   introduce isolated code and test compiled-binary loading in the signed app. Do not repeat the
   ad-hoc compiled-binary experiment that was killed or hung; it proved nothing about `import()`.

Done when one representative plugin can be installed, used, disabled and reopened on a client
without it, with bounded capabilities and intact stored data.

## 17. Linux and Windows

1. Unit shards, DOM tests and verify already run on Linux. Run the integration tests on
   `ubuntu-latest` as well as `macos-latest` and keep three runs in a row green, then rewrite
   "Open 1" in [LINUX.md](LINUX.md). Record package smoke checks for deb on Debian trixie/Ubuntu
   noble, arm64, AppImage on Ubuntu and GNOME/KDE/X11/Wayland.
2. Address Linux font fallbacks in drawing text and request the generic UI font change in
   `@adecore/ui`. XWayland stays the default until the fractional-scaling measurement settles
   native Wayland.
3. Windows follows [WINDOWS.md](WINDOWS.md), tracked in
   [issue #15](https://github.com/basmilius/ruimte/issues/15). The ADE CORE public API cleanup
   (ADE CORE 0.25.0, with the rebased `feat/chat-file-source-and-shell-slot` branch) comes before
   the Windows work in ADE CORE.

Done when each supported platform has CI and recorded packaged-app checks for its claimed
architectures/formats.

## Decisions and completion rules

One step still waits on a decision: the execution rules for later language servers (15.4). Decide
it before the implementation that depends on it, and keep going with the other steps meanwhile.
Measurements settle the buffer, cap and chunk choices, and the fractional-scaling measurement
settles native Wayland. Automatic redelivery after an accepted parent turn fails remains disabled
by the existing product decision; it is not an unanswered implementation question.

For each code change, run focused deterministic regressions and the repository's required checks.
Use integration tests for real shells, watchers, sockets and provider/server processes. Verify UI
changes in the Electron dev app and capture real-device/network evidence where the package calls
for it. New actions go through the registry, menu and palette; new text has English and Dutch.
Keep new wire fields optional and regenerate Swift schemas with contract changes. A new kind or
enum word needs the compatibility checks above.

Remove each step once its implementation and required verification are complete. Keep completion
history and evidence in reports, outside this list. A passing fake or a generated schema does not
complete a real-account, device, deployment or release check.
