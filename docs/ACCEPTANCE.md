# Device acceptance

Manual checks that unit tests, simulators and CI cannot settle. Each list stays open until someone ran it on real
hardware and wrote down the result. Remove an item once it passed; record measurements in the table beside it.

## iPhone and iPad

Use a current Ruimte on a MacBook that is already on your Pulsar account. Keep the MacBook awake and its broker and
TURN configuration as they are. The checks below use Connection diagnostics in the app.

- [ ] Sign in. Continue with an available provider, cancel once and check you can retry. Complete the login, close
  the app and reopen it. The account and machine list come back without another login, and the public key stays the
  same. Test Apple too when `/v1/providers` offers it.
- [ ] Wi-Fi. With "Require relay for this test" off, select the MacBook. Record `server.hello`, the machine version,
  "Route" and the milliseconds in "Connection to server.hello". The target is below 5,000 ms. "Not measured" proves
  neither direct nor relay.
- [ ] 5G. Turn Wi-Fi off and keep mobile data on. Wait for the reconnect and record the same fields. Repeat five times
  with Reconnect, and record every failure, the median and the slowest success.
- [ ] TURN. Turn on "Require relay for this test" and reconnect on Wi-Fi and on 5G. Only `server.hello` together with
  "Relayed" proves the selected candidate uses TURN. If it fails, record the error and the network. Turn the switch
  off afterward.
- [ ] Background. While connected, go Home for at least 30 seconds, return and record the new `server.hello` time.
  Repeat five times, one of them with a lock and unlock. The target is below 3,000 ms after foreground; only a new
  hello counts. An unreachable machine shows its error and reconnects when its network returns.
- [ ] Two iPad windows. Select the same machine in both and hide one. The visible connection stays live. Background
  the whole app and return: the windows share one new connection, and disconnecting one leaves the other.
- [ ] Statement origin. On the desktop, open Settings > Account, open the MacBook and look at Apps with access. Find
  "Ruimte on iPhone" or "Ruimte on iPad" and compare its public key with the one Connection diagnostics shows.
  `auth.sessions` must report `origin: "statement"`. A device paired before keeps its origin, so test with a fresh
  key.
- [ ] Path change and cancellation. Disconnect while a connection is still opening, then select it again. No late
  result of the canceled attempt replaces the current one. Switch between Wi-Fi and 5G while connected and check a
  new hello arrives.
- [ ] Local network. On the MacBook's Wi-Fi the route reads "Local network", also when its daemon runs with
  `--no-broker` after a first connection. On 5G it reads "Via broker" or "Relayed", at most a second slower. Turn
  Ruimte off under Privacy & Security > Local Network and reconnect on Wi-Fi: the route reads "Via broker" without an
  error.

| Device / OS | Network | Relay required | Route | Hello ms | Foreground ms | Result / error |
| ----------- | ------- | -------------- | ----- | -------- | ------------- | -------------- |
|             |         |                |       |          |               |                |

Features, in a disposable project where something writes:

- [ ] Open one project in two iPad windows and close one; the other's chat or terminal stays live. Rename a view on
  the phone and the desktop at once to exercise conflict resolution, and move a node on the desktop while renaming it
  on the phone.
- [ ] Stream a long chat with tools, images, an approval and a question. Check scrolling, selection during streaming,
  keyboard access, draft recovery, reconnect and a 300-line code block.
- [ ] Attach to `vim` and `htop`, reconnect, resync and paste several lines. The desktop's rows and columns stay
  unchanged. Note memory and responsiveness under large output.
- [ ] Pan a 30-node canvas with 20 edges, rotate, return to the saved camera and use the list view. Compare drawing
  paths and text against the desktop.
- [ ] File watching, image and video previews, Git stage, unstage and commit, and confirmed process signals.
- [ ] Edit a file on the phone while the desktop changes it: the save refuses and keeps the edit. Delete a file and
  find it in the machine's Trash. Mention a file in a chat that is open and in one that is not. Bind a group to a
  worktree and start a chat in it on the desktop. Stop a rebase halfway and finish it from the Changes segment.
- [ ] VoiceOver and larger text on the main pages, the chat and the composer.
- [ ] Intelligent UI blocks in a chat, on a device. Timeline: VoiceOver reads time, title and tone per
  event. Gallery: three device shots attached with `ruimte-context chat attach` show as a grid. Compare:
  the handle drags and VoiceOver adjusts it. TextField and Select take input, refuse text over the
  limit and lock after an answer. Map: the Utrecht example shows four markers and the list, airplane
  mode keeps the list, the "Map tiles" switch in Settings off shows no map, and VoiceOver reads each
  place.
- [ ] Remove a view on the desktop while the phone has it open: the phone says it was removed instead of
  opening it forever. Also connect to a machine that names no `features`, if one is at hand: the
  session shows the older-Ruimte line.
- [ ] iPad multitasking: split view and Slide Over with a chat and a terminal open.
- [ ] Visual timing of streaming text and the composer's prompt transitions, with and without Reduce Motion.
- [ ] Long background runs and network switches during a turn.
- [ ] Startup time and memory on a device, recorded with the device and build.

## Work on another machine

Two machines of one account, such as the Linux workstation (the machine you work on) and the MacBook (the machine
that takes the task). The checks in the desktop app are in [NEXT.md](NEXT.md), package 18.

- [ ] The Docker bench on a host with Docker: `bun run --cwd apps/server docker:test` sets `RUIMTE_DOCKER=1` and
  runs `src/docker/remote-daemon.integration.test.ts` against a container of its own. All cases pass, those of
  "another machine of the account as a peer" included. Record the Docker version.
- [ ] Over a real network and not loopback: a task from the workstation's agent runs on the MacBook, the
  MacBook sleeps halfway and wakes, and the result arrives once. Note the route (broker or relay) and how long the
  link took to come back.
- [ ] A fifth task while four are open on the MacBook waits instead of failing, and starts once one settles.

## Intelligent UI evaluation

- [ ] The evaluation set of `docs/NEXT.md` (package 12, item 6) with the new questions: an incident timeline,
  a gallery of device shots, a coffee map and a search form. Three runs per CLI and model, with versions,
  language, fresh start or resume, compiles without diagnostics, empty renders and prompt cost. A map is
  accepted at 18 compiles out of 20.

## Push notifications

Production delivery has never been tested. A sandbox test does not establish it; it needs a production-signed build
and its device token. `apps/pulsar-worker/APNS.md` has the environments and secrets.

- [ ] On a signed device, turn on notifications, background the app and check turn completion and both approval
  choices. Also check an expired request, a desktop answer arriving first, revocation, key loss and the generic
  fallback.
- [ ] A notification handled on the Mac clears on the phone.
- [ ] Live Activities: follow a turn and check phase changes, completion, expiry and push-to-start on the Lock Screen
  and in the Dynamic Island. Use the same node ID on two machines and check each activity stays with its machine.
- [ ] The same on a distribution-signed build from TestFlight, against the production environment.

## Speech to Text

- [ ] Recognition quality and latency with a real microphone, in English and Dutch.
- [ ] CPU-only performance on the oldest supported Apple silicon.
- [ ] Native undo after dictating into a prompt answer.
- [ ] A signed, packaged build downloads the model, dictates and removes the model again.

## Apple Foundation Models

`apps/foundation-models/verification.json` holds the recorded runs.

- [ ] The complete workday evaluation (`workflow-smoke.ts --evaluate-workday`) passes.
- [ ] The long native smoke passes, including the memory answer it last failed on.
- [ ] The helper runs on macOS 26.4, the deployment target.
