# Overnight performance work, 25 October 2026

Twelve further measurement rounds cover daemon startup, client-daemon delivery, chat restoration, older history and scrolling, directory loading, sidebar rendering, model selection and first-use screen loading. Changes are committed locally in Ruimte and ADE CORE. Nothing was pushed. Canvas rendering is excluded.

Each retained performance change has a before/after measurement. The reports below keep raw samples, fixture descriptions, intermediate stages and rejected trials. Timing jobs run separately from tests and builds. Measurements use Bun 1.4.2 and headless Chromium on macOS 27.2 with an Apple M4 Max. These are independent fixtures; their savings cannot be added into a single application-wide speedup.

| Workload | Before | After | Evidence |
| --- | ---: | ---: | --- |
| Daemon through authenticated first project list, controlled 300 ms CLI probe | 390.82 ms | 85.76 ms | [Round 6](2026-10-25-round6.md) |
| Idle terminal echo over local WebSocket, before browser rendering | 18.27 ms | 0.51 ms | [Round 4](2026-10-25-round4.md) |
| Terminal echo over local direct channel while another terminal prints | 45.10 ms | 5.11 ms | [Round 4](2026-10-25-round4.md) |
| Restore 30,000 chat items and apply 200 request updates, Bun | 55.12 ms | 10.21 ms | [Round 7](2026-10-25-round7.md) |
| Reconnect replay, 6,000 cached items and 200 missed events, Chromium | 108.3–109.8 ms | 0.7–0.8 ms | [Round 8](2026-10-25-round8.md) |
| Long-timeline scrolling workload, main-thread CPU | 1,645.57 ms | 744.48 ms | [Round 11](2026-10-25-round11.md) |
| 60 status updates in a 2,000-view sidebar, main-thread CPU | 4,796.25 ms | 1,342.53 ms | [Round 13](2026-10-25-round13.md) |
| Directory listing, 10,000 entries with 2,000 returned | 123.98 ms | 20.14 ms | [Round 9](2026-10-25-round9.md) |
| Git-aware directory fixture, 1,800 entries | 86.74 ms | 14.77 ms | [Round 10](2026-10-25-round10.md) |
| Model sorting, 27 sorts of 700 models in Chromium | 11.40 ms | 0.40 ms | [Round 12](2026-10-25-round12.md) |
| Empty workspace, 20 ms script response delay | 804.9 ms | 538.2 ms | [Round 14](2026-10-25-round14.md) |
| First Settings opening, 20 ms asset delay | 162.9 ms | 125.5 ms | [Round 14](2026-10-25-round14.md) |
| First command palette opening, 20 ms asset delay | 78.3 ms | 49.4 ms | [Round 14](2026-10-25-round14.md) |
| First visible file, local | 411.5 ms | 380.3 ms | [Round 15](2026-10-25-round15.md) |
| First visible file, 20 ms script response delay | 754.2 ms | 565.3 ms | [Round 15](2026-10-25-round15.md) |

## What changed

The daemon no longer makes every client wait for an external Codex capability probe. Authenticated command definitions load on first use. Interactive terminal output sends the first idle bytes immediately while preserving batching and throughput during continuous output. Local request serialization itself measured below a millisecond and was left intact, including validation and identity checks.

Chat request updates use an index of pending requests rather than repeatedly scanning all history. Reconnect replay publishes one ordered store update. Timeline position queries read only the measurements they need, preserving anchors and live offsets. Model sorting reuses collators while retaining the native locale and existing model ordering. These shared fixes live in ADE CORE.

The sidebar avoids serializing unchanged project data, and shares focus and arrow-navigation handlers so status changes do less React row work. Directory listing sorts names naturally and caps work before reading unused metadata. Git ignore handling avoids resolving each relative name through an aliased directory, preserving names, tracked-file freshness and path boundaries.

Production controls and icons share fewer chunks while application features remain lazy. Workspace JavaScript requests fall from 168 to 96 with about 0.7 percent more decoded code. Visible ordinary files prepare their filesystem watch during workspace loading. They still wait for native readiness before reading. New readiness and cancellation checks prevent a quicker load from showing an old snapshot.

## Validation and rejected experiments

The final Ruimte application check, client/desktop build, 10,458 unit tests and 395 DOM tests pass. ADE CORE's latest full run passes 7,310 tests with 286 skipped, plus its check, package build and documentation build. Focused real terminal, direct-peer, packaged-daemon and filesystem integrations pass in the rounds that change those boundaries.

Independent final regressions confirm an 82.48 ms compiled-daemon median with the controlled slow CLI probe, 1,365.22 ms sidebar CPU below its 2,000 ms budget, and a 124.1 ms start screen with eight JavaScript requests. All 24 final file-freshness profiles render a write made during native-watch startup on their first content display. The previous file loader fails the new 650 ms delayed-loading budget; the current file and loose-tab batches pass. Full sample counts and limits are in [round 15](2026-10-25-round15.md).

Alternatives were removed when the measurements did not support keeping them. A generic heap regressed file search, additional lazy boundaries delayed the first file, broad chunk merging regressed the command palette and added too much code, and smaller bytecode variants worsened repeated daemon startup. A native watcher handoff trial lost an event and was rejected. No default unit test depends on real-time performance thresholds.

## Remaining limits

The first execution of a newly created daemon binary can still take roughly a second. Minimal Bun and native C executables reproduce a size-dependent first-use cost before ordinary daemon initialization; warming the same file removes most of it. Pre-reading and signature verification did not fix it. The evidence points to macOS executable loading or execution validation, but the responsible OS service was not traced. No signing or security check was bypassed. [Round 4](2026-10-25-round4.md) records these probes and their limits.

These results do not establish physical display FPS, performance on older devices, Internet latency or notarized-release first-launch behavior. Delayed asset fixtures expose request overhead and do not simulate every deployment. At the final audit, the measured paths have no further clear, low-risk optimization supported by the evidence; additional changes need new profiles on representative devices or a release binary.

Earlier work remains documented separately: [initial client loading and built-client development](2026-10-25.md), [local startup and search](2026-10-25-round2.md), and [bytecode and daemon polling](2026-10-25-round3.md). The built-client development script is `bun run dev:built`; bundled development and production lazy loading remain separate choices.
