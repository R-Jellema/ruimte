# @ruimte/server

The daemon. It owns terminal sessions, chats and everything a project keeps on this machine, and serves them to clients over one WebSocket. Closing a client never ends a session. A session ends on `session.kill`, when the last client holding its project sends `project.close`, or when the daemon goes down.

This file is for running and operating the daemon: flags, the CLI, what it writes on disk, and where its security lines sit. The architecture, the wire protocol, the invariants and the product rules are in the root `CLAUDE.md`, and per-area invariants sit in a `CLAUDE.md` beside the code. Neither is repeated here.

## Run

```sh
bun run --cwd apps/server start            # ws://127.0.0.1:4210/ws
bun run --cwd apps/server start -- --host 0.0.0.0 --port 4300
bun run --cwd apps/server dev              # ws://127.0.0.1:4211/ws, home ~/.ruimte-dev, restarts on file changes
```

The `dev` script runs on port `4211` with `RUIMTE_HOME` set from `RUIMTE_DEV_HOME`, defaulting to `~/.ruimte-dev`. A checkout then runs beside an installed Ruimte (`4210`, `~/.ruimte`) without sharing its id, its projects or its sessions. Its door on the local network listens on `4221`, and `bun src/main.ts status --port 4211` says how clients reach it.

| Flag | Default | Meaning |
| --- | --- | --- |
| `--host` | `127.0.0.1` | Interface the API listens on. Go beyond loopback only for a container that publishes the port; only the local secret or a ticket from a direct channel gets in. |
| `--port` | `4210` | Port for `/ws`, `/health`, `/hooks` and the other HTTP routes. |
| `--no-hooks` | off | Write nothing into the CLIs' settings and remove nothing from them: no status hooks, no Codex rule for `ruimte-context`, and the app cannot change that choice. |
| `--label <name>` | hostname | What the machine calls itself until someone names it from a client (`RUIMTE_LABEL` works too). |
| `--no-price-fetch` | off | Never fetch the LiteLLM price table or the exchange rate; the bundled snapshot prices everything. |
| `--no-model-fetch` | off | Never ask the address book for newer model catalogs. |
| `--stun <url>` | `stun:turn.ruimte.app:3478` | A STUN server for direct connections. Repeatable; given once, it replaces the default. |
| `--no-stun` | off | Use no STUN server, so a direct connection announces the interfaces only. |
| `--direct-ports <first-last>` | any | The UDP ports a direct connection binds (`43100-43109`, or one port). |
| `--direct-host-address <ip>` | none | An extra address to announce as a candidate, such as the one a container is published on. Repeatable. |
| `--broker <url>` | the machine's setting | Announce the machine to this Pulsar broker (`RUIMTE_BROKER_URL`; `off` turns it off). `wss://`, or `ws://` for a broker on this machine or the local network. Without it the daemon uses the broker set under Settings, Machines, which defaults to `wss://broker.ruimte.app`. |
| `--no-broker` | off | Announce the machine to no broker, whatever else says otherwise. |
| `--broker-advertise <url>` | the broker | The broker URL clients are told in `endpoint.info`, when they reach it under another name (`RUIMTE_BROKER_ADVERTISE_URL`). |
| `--lan-port <port>` | `--port` plus 10 | The port of the door on the local network; `0` lets the system pick one. |
| `--no-lan` | off | Keep the door on the local network closed, whatever the machine's setting says. |

`GET /health` answers `{ ok: true, version, build, service }`, where `service` says whether the daemon runs as the background service. `POST /hooks/<claude|codex>` takes a hook payload from an agent CLI; other kinds answer 404. Everything else goes over `/ws` in the frames of `packages/contracts`.

Other environment variables:

| Variable | Meaning |
| --- | --- |
| `RUIMTE_HOME` | Where the daemon keeps its state (below). |
| `RUIMTE_DEBUG=1` | Print the whole stack of an error instead of its message. |
| `RUIMTE_PULSAR_URL` | Another address book for `ruimte login`. |
| `RUIMTE_DATABASE_HELPER` | The database helper binary (see "Databases"). |
| `RUIMTE_PHP_LANGUAGE_SERVER_SOURCE`, `RUIMTE_SQL_LANGUAGE_SERVER_SOURCE` | A checkout of a native language server for a development daemon. |
| `BUN_CHROME_PATH` | The Chrome a render child of a visual runs. |

## Compile

`bun run compile` (`scripts/compile.ts`) builds one executable with `bun build --compile` into `dist/<os>-<arch>/ruimte`, with `ruimte-context` and `ruimte.build` next to it. It builds for this machine, or for another with `--os mac|linux --arch arm64|x64`. `--target darwin-arm64` names the target the way the npm packages do, and `--outdir` picks the folder. A macOS binary only compiles on macOS, since `codesign` has to repair the signature Bun leaves. `RUIMTE_VERSION` stamps a version in. The desktop app packages that folder as its `bin` resource.

## The `ruimte` CLI

A machine without the desktop app runs the same binary from npm (`packages/npm`), with Node or Bun:

```sh
npx ruimte                                # the daemon, with every flag above
npx ruimte login                          # onto an account with a code
npx ruimte status                         # how clients reach it
npx ruimte logout                         # off its account again
npx ruimte service install [flags]        # the background service for this user
npx ruimte service status
npx ruimte service uninstall
npx ruimte closed-lid install             # let keep awake hold a closed lid on a Mac (asks for sudo)
npx ruimte closed-lid remove
npx ruimte --version
```

A bare `ruimte` at a terminal prints the address it listens on and names the commands above. Under the service or the desktop app it logs one `listening on` line. The port is tried before the daemon reads its home, so a second start leaves no trace. When the port is taken it says so and exits 1, naming the Ruimte that holds it when that program answers `/health`.

`ruimte login` puts the machine on a Pulsar account. Run it as the user and with the `RUIMTE_HOME` of the daemon (and `--port` when it is not `4210`). It prints `https://station.ruimte.app/link?code=BCDF-GHJK`, the code and the machine's key fingerprint. A person opens that page anywhere, signs in, checks the name and the fingerprint, and presses "Add to my account". The command then has the daemon sign a registration for that account and exits 0. A denial, an expired code or a withdrawn code exits 1, and Ctrl+C withdraws the code and exits 130. A machine already on another account refuses (see "One account per machine"). Without a daemon answering, it says how to start one.

`ruimte logout` takes the machine off its account. `ruimte status` asks the daemon on the local secret (`GET /machine/status`). It prints the version, whether it runs as the background service, its name, its account, its broker and whether that broker took its signature, the addresses of its door on the local network, and the keep awake state. It warns when neither the broker nor the door can bring a client in. It exits 0 when the daemon answers and 1 when it does not.

`ruimte service install` copies `ruimte`, `ruimte-context` and `ruimte.build` to `$RUIMTE_HOME/bin`. It writes the LaunchAgent or systemd user unit the desktop app writes, pointing at that copy and never at the npx cache. The unit carries the flags after `install`, the PATH of the shell it ran in (without npx's own folders) and `RUIMTE_SERVICE=1`. Running it again with a newer version replaces the copy, and the daemon under the service moves to it once idle; different flags restart the service. It refuses to touch a service that runs another program, such as the desktop app's. On Linux it prints `loginctl enable-linger <user>` when lingering is off and leaves turning it on to you. `uninstall` stops the service and removes the definition and the copy, and leaves the rest of `$RUIMTE_HOME` alone. `status` exits 0 only when the service is installed and answers on `--port`.

`ruimte context` is the agent-side CLI behind the `ruimte-context` script (see "Context links").

## Machine settings

What a person sets for the machine lives in `endpoint.json`, next to the id and the key pair, and reaches clients through `endpoint.info` and `endpoint.changed`. Any client the machine let in may change them through `endpoint.setIdentity`, unless noted.

| Setting | What it does |
| --- | --- |
| `name`, `icon` | The machine's name and Lucide icon. A null name falls back to `--label`, `RUIMTE_LABEL`, else the hostname; a typed name wins over both. |
| `agentsDeleteAnyView` | Lets an agent's `view delete`, `node delete` and `link delete` remove what it did not make. Off by default. |
| `resumeAtReset` | Resumes a chat that stopped on a limit, on a clock. Off by default; a chat's own switch can say no. |
| `visualReplies` | Lets an agent in a chat show a page above its reply. On by default; written only as `false`. |
| `streamingAllowed` | Browser pages and device screens stream to clients. On by default. |
| `appleFoundationEnabled` | Offers the Apple on-device model as a chat provider. |
| `keepAwake`, `keepAwakeOnBattery`, `keepAwakeDisplay` | Hold a block on sleep: `off`, `working` (while an agent works) or `always`; on the adapter only unless battery is allowed; the display only under `always`. |
| `keepAwakeLidClosed` | Also hold with the lid closed (below). |
| `broker` | The broker this machine announces itself to, or off. |
| `lanDoor` | Whether the door on the local network is open. |
| `worktreeRoot` | The folder new worktrees are made in; absent is `worktrees` in the data folder. Only the local secret sets it. |
| `nodeSizes` | The size a new node of a kind starts at, by kind, for a person's nodes and an agent's (`node new`, `agent`, `team`, a fork) alike. Only the kinds a person changed are written; a missing kind takes its built-in size (`NODE_SIZE` in `packages/contracts`). Set and reset one kind at a time through `endpoint.setNodeSize`; no verb changes it. |

Keep awake is the daemon's own (`src/power/keep-awake.ts`), so it holds with no window open and when a phone set it. On macOS it is a `caffeinate -w <daemon pid>` child, so a daemon that dies never leaves the Mac awake. Elsewhere `keepAwakeAvailable` is false and nothing is held.

`endpoint.json` stays at `version: 1`. A newer field is added as optional, because a version bump would make an older daemon mint a new id and greet every client as a stranger. A field that will not read is dropped on its own, and the id and key pair survive it. A file that will not read at all is renamed to `endpoint.json.corrupt-<time>` before a new id is minted, so the old key pair can be put back by hand.

### With the lid closed

macOS sleeps on a closed lid whatever assertion is held, so `keepAwakeLidClosed` runs `pmset -a disablesleep 1` while the block holds (`src/power/closed-lid.ts`). The daemon never holds root. A person installs a sudoers rule once, `/etc/sudoers.d/ruimte-closed-lid-<uid>`, that lets this user run exactly `/usr/bin/pmset -a disablesleep 1` and `/usr/bin/pmset -a disablesleep 0`. The file name has no dot because sudo skips such files. `ruimte closed-lid install|remove` does this from a terminal and prints the rule word for word; the app does it through `endpoint.closedLidRule`, which only the local secret may call. Before sleep goes off the daemon writes `power/closed-lid-held` and starts a detached watchdog shell that turns sleep back on once the daemon is gone, however it went. A start that finds `SleepDisabled` with that marker turns sleep back on. Without the marker someone else turned it off, and the daemon leaves it alone. Root `CLAUDE.md` has the rule for when it holds.

### Updates of the desktop app

`endpoint.info` carries `update`, where the desktop app on this machine stands with its next version. The app holds the updater and reports each step with `endpoint.reportUpdate` (local secret only). Any client may call `endpoint.installUpdate`: with `confirm` false it lists the terminals and agents a restart would end, and with `confirm` true it hands the install to the app. Without an app connected it answers `update-no-app`.

## `RUIMTE_HOME`

Where the daemon keeps its state. Defaults to `~/.ruimte` (`~/.ruimte-dev` under the `dev` script and in an unpackaged desktop app). Directories marked 0700 are created with that mode.

```
$RUIMTE_HOME/
  endpoint.json                    the machine's id, key pair and settings (above)
  agent-integrations.json          0600, which CLIs Ruimte may write status hooks into, and what it wrote
  local.key                        the local secret (0600), written on the first start
  auth.json                        the clients this machine let in by public key, their push subscriptions, and the account the machine is on
  projects.json                    every project the machine knows: id, name, color, folder, and when it was last closed
  providers.json                   the accounts of each agent CLI: kind, label, color, config folder; never a credential
  accounts/<id>/                   0700, the config folder of an account the daemon made (a shadow home for Codex)
  snoozes.json                     the nodes a person put aside, with when each snooze ends
  launch-after-settle.json         per project, the task a person chose to run after a worktree chat settles, and the last turn each chat ran it for
  push-attention.json              the alerts pushed in the last 30 days, which clients mark nodes from
  apple-mcp.json                   optional, written by a person: the MCP servers the Apple chat provider may use
  bin/                             the copy of the binaries `ruimte service install` runs
  projects/<projectId>.local.json  camera, focus, grid and panels, where a client that never saw the project starts
  scratch/                         the Chats project (see "Projects")
  worktrees/
    <repo>-<hash>/<branch>/        a worktree the daemon made, unless `worktreeRoot` in `endpoint.json` sends new ones elsewhere; nothing removes it on its own
    worktrees.json                 what git cannot say about them: branch, from, project, node, who made it (stays here either way)
  bundles/<id>.bundle              0700, a git bundle written for another machine to read with `bytes.read`; cleared at daemon start, and each file goes once its last piece was read (a client holds at most 4, the machine 16)
    incoming/<id>.bundle           0700, a bundle another machine is sending with `git.bundlePut`; removed after `git.fetchBundle`, taken in or refused
  hidden-agents/<id>.json          agents a chat view started outside the canvas, with their placement
  sessions/                        0700
    <sessionId>.txt                serialized screen plus scrollback of one session
    <sessionId>.agent.json         the agent CLI last seen in that session, for a cold resume
  shell-integration/zsh/.zshenv    the shim a zsh session loads first; it keeps a person's own startup files
  prompts/<nodeId>.json            0700, the first prompt of an agent node until its session or chat exists
  outbox/<id>.json                 0700, work the daemon still owes (src/outbox/CLAUDE.md)
  tasks/<taskId>.json              0700, a task a chat gave a node it opened
  lineage/<nodeId>.json            0700, who opened a node, its depth, its mode ceiling and when it was ended
  peers/<machineId>.json           0700, a machine that works in a project here: its label and, per project, the ceiling of its agents (see "Linked machines")
  remote/<projectId>.json          0700, which node of the project runs on another machine, as node id to machine id
  command-approvals/<hash>.json    0700, a command or launch a person approved for a node, or a task for the project's worktrees
  mode-approvals/<hash>.json       0700, the permission mode a person's save gave a terminal agent
  notices/<nodeId>.json            0700, messages left for a node until its agent picks them up
  database-access/<projectId>.json 0700, what agents may do with each connection (see "Databases")
  secrets/<hash>.json              0700 folder, 0600 files: the secrets of a project's launches (see "Launch secrets")
  database-snapshots/<projectId>/<connectionId>/<database>.json
                                   schema snapshots the SQL language servers read
  chats/                           0700
    <chatId>.json                  the thread and info of one chat, with the seq it holds
    <chatId>.log                   every event since that snapshot, one `{ seq, at, event }` per line
    <chatId>.bookmarks.json        bookmarked messages
    <chatId>.plans.json            the chat's plans (src/chat/CLAUDE.md)
    <chatId>.visuals.json          the pages agents showed in that chat
    <chatId>.visuals/              editable HTML sources and preview pngs of those pages
  attachments/<chatId>/            0700, files attached to messages, generated images and visual pages
  checkpoints/<repo>-<hash>.index  0700, the private git index a turn's checkpoint is written through
  provenance/<projectId>/<hash>.json
                                   0700, which chat wrote which lines of a file
  computer-use/                    0700, shared with the computer use helper
    settings.json                  whether computer use is on, and the language it speaks
    grants.json                    apps let in for always, and apps seen running shells
    overlay.json                   the words of the helper's cursor, session bar and menu
    agent.sock, screenshots/       the helper's own (apps/computer-use/README.md)
  browser/                         the profile of the pages the daemon runs for clients without a browser
  screenshots/                     pngs `browser shot` and `device shot` wrote, swept after a day
  language-servers/
    choices.json                   which PHP server this machine uses
    custom.json                    a person's own language servers
    <kind>/                        one folder per installed kind (see "Language servers")
  usage/                           0700
    index.json                     every transcript the scanner read, with where it stopped
    prices.json                    the last LiteLLM price table
    exchange-rate.json             the last euro rate for a dollar
  models/catalogs.json             0700, the last model catalogs from the address book
  power/closed-lid-held            0700 folder, present while sleep is off for a closed lid
```

The desktop shell and helpers write a few entries of their own in the same home: `speech.json` and the speech models under `models/`, and `apple-foundation/` for the Apple helper's sessions.

File names are the id passed through `encodeURIComponent`, so an id can never name a path outside its directory.

One home belongs to one daemon. The id in `endpoint.json` is what clients call this machine, and the stores write as if nothing else touches them. Two daemons sharing a `RUIMTE_HOME` are two daemons a client cannot tell apart.

## Projects

Root `CLAUDE.md` and `src/projects/CLAUDE.md` cover the two project files, sharing, revs, holds and closing. What remains for an operator:

- Both project files put every node, text, line and arrangement on a line of its own, so two people who each add a node do not collide in a diff. Node folders inside the project are stored relative to it.
- A project file that does not parse is moved aside as `project.json.corrupt-<timestamp>` and a fresh canvas takes its place. Every write is a temp file plus rename.
- `project.open` refuses a folder whose canvas uses node ids that another open project uses too (`project-ids-taken`). Two checkouts of one repository carry the same canvas, and sessions and chats are keyed on node ids. Close the other project first.
- `project.delete` forgets the project and, when asked, removes the canvas file. Other files in the folder are never touched.
- The Chats project lives in `$RUIMTE_HOME/scratch` and holds one folder per chat, which nothing removes. A home inside a git checkout answers `scratch-unavailable`, since every chat folder would land in someone's repository.
- Without a chosen icon the daemon looks for one in the folder (`.ruimte/icon.*`, IDE icons, favicons), jailed to the folder, sniffed by magic bytes and capped at 256 KB. `GET /projects/<projectId>/icon` serves it behind the same access rules as `/ws`, with `nosniff` and, for an SVG, a policy that runs nothing.
- An inline edit in the editor runs in a hidden chat view in the private project file (`src/projects/inline-chat.ts`). No sidebar lists it. The client asks for old ones to be removed after seven days.

## Drawings

A drawing or diagram lives in `.ruimte/drawings/<viewId>.json` while its view is shared and in `.ruimte/private/drawings/<viewId>.json` while it is not. Both folders are watched. A drawing nobody touched leaves no file. Broken JSON is set aside as `<viewId>.json.corrupt-<timestamp>`; a file that parses but is not a drawing stays and answers `drawing-invalid`. A view that disappears through an outside edit of `project.json` never takes its file along, because a pull can drop a view whose file is still on its way.

## Databases

A project's connections live in `.ruimte/databases.json` (shared) and `.ruimte/private/databases.json` (this person's, with the `rev` and the order), managed by `src/database/connection-store.ts`. A connection is private until a person's save shares it. A SQLite file outside the project folder cannot be shared. No password lands in either file; a save drops `config.password` whatever the client sent, because the desktop app keeps passwords in its own secret store.

`database.request` carries one message of `@adecore/database`'s protocol to a native helper. The helper is `native/adecore-database` beside a compiled daemon, `RUIMTE_DATABASE_HELPER` when set, or else what `helperPath()` of `@adecore/database` finds: `ADECORE_DATABASE_HELPER`, the binary of the platform package in `node_modules`, or the release build of a linked checkout. Without one every request answers `helper-unavailable`. It runs with the daemon's `PATH`, so `ssh` and `docker` resolve, and its stderr goes to the daemon's log as `[database] <line>`. Requests are never logged, since `open` and `test` carry the password. A SQLite file under `$RUIMTE_HOME` never opens. Export and import are for the local secret only.

Passwords reach the daemon only through `database.passwords`, from a client of the project, for its agents and its schema snapshots (`src/database/agent-passwords.ts`). The daemon keeps them in memory only. They are never on disk or in a log, and they are gone when the last client lets the project go or the daemon stops. Each is bound to where its connection pointed when it was handed over, so a connection repointed afterwards opens without it.

What agents may do with each connection is a person's choice kept outside the project, in `$RUIMTE_HOME/database-access/<projectId>.json` (`src/database/agent-access.ts`). It lists `off` or `write` per connection, and a connection not listed is `read`. Any client of the project may set `off` or `read`; only the local secret may set `write`. No verb reads or writes that file.

The SQL language servers read a database through a schema snapshot the daemon takes (`src/database/schema-snapshots.ts`) into `database-snapshots/`. A snapshot holds no credential and no row, and is taken on a read-only session of its own. Which connection a `.sql` file or the SQL in a PHP file reads is one person's choice in the private project file (`src/database/sql-analysis.ts`).

## Launch secrets

An agent in an AI chat asks for a secret a launch needs with `ruimte-context secret request` (`src/canvas/secret-verb.ts`, `src/actions/secret-actions.ts`). The daemon raises a card in that chat (`secret.requests`, `src/secrets/secret-requests.ts`) and holds the chat at `needs-you` while it stands, so its status, the stack and push treat it like a question. One card stands per chat, launch and variable; a turn that ends, a chat that stops and 15 minutes without a new ask take it down. The verb answers only `saved`, `declined`, `cancelled`, `timed-out` or `waiting`, never the value.

A person answers with `secret.save` or `secret.decline`. The value goes into `$RUIMTE_HOME/secrets/<hash>.json` (`src/secrets/secret-store.ts`), one file per project named after a hash of its id, written whole with mode 0600. The launch gets `ruimte:secret` as the value of that variable (`LAUNCH_SECRET_REFERENCE`), in this machine's own launch file: the overlay of a shared launch, or the launch itself when it is private. That marker, not the value, is what the launch's approval covers. A Save keeps a launch approved that was approved before, and approves nothing else; a new value for the same variable changes nothing an approval covers, and a marker added or removed outside a person's save asks again. The daemon swaps the marker for the value only in the environment of the process it starts (`resolveEnv` in `src/launches/runner.ts`); a marker without a secret leaves the variable unset. A person's save of the launches drops the secrets no variable refers to any more.

The value is never in a project file, the chat log, an event, a reply to an agent or a log line, and no verb reads it. `secrets/` is the machine's state, so no file request of a client reaches it (`src/fs/machine-home.ts`). What the launched process does with it, printing it included, is that process's.

## Sessions

- A session is keyed by the id the client chooses. `session.create` on a running id answers `session-exists`. On an id whose shell ended it starts a fresh shell and shows the old screen above a `[session restored, previous shell ended]` line.
- The shell is `$SHELL` (fallback `/bin/zsh` on macOS, `/bin/bash` elsewhere), started as a login shell, with `TERM=xterm-256color`, `COLORTERM=truecolor` and `RUIMTE_SESSION_ID` set.
- Every session runs a headless xterm with 10000 lines of scrollback. A screen that would weigh more than 4 MB as JSON loses its oldest scrollback until it fits (`src/sessions/fit-screen.ts`), because a frame past 16 MB closes the socket and the reconnect would meet the same screen.
- Several clients may attach to one session; the last attacher's size wins.
- A slow client does not grow a queue in the daemon. Past 1 MB buffered on a socket (`src/backpressure.ts`) its output stops, and on drain each session that lost bytes sends a fresh screen as `session.resync`.
- A shell that exits stays in `session.list` as `exited` with its `exitCode`. `session.kill` removes it.
- `session.create` takes either `command` or `agent`, never both. With `agent` the daemon builds the launch line itself (`src/providers/launch.ts`), so no flag travels over the wire. A line longer than 1000 bytes goes into the shell's environment as `RUIMTE_START_LINE`, and `eval "$RUIMTE_START_LINE"` is typed instead (`src/sessions/session.ts`). macOS cuts the tty's input queue at 1024 bytes, so a longer typed line would arrive cut off.
- `session.login` opens a shell that types a CLI's own login command for an account. It ends with the socket of the client that asked and never writes a snapshot.

## Session listener discovery

`session.ports` lists the TCP listeners a session's process tree holds, for opening a dev server from its terminal. macOS reads ownership with libproc and listeners with `/usr/sbin/lsof`; other platforms answer `unavailable`. Only loopback and wildcard bindings are offered. A port another process could also own makes the answer `unknown`. Scans are shared, cached for five seconds and bounded in sessions, processes, time and output. `session.verifyPort` checks one port again before it opens; only the local secret may call it.

## Snapshots

The daemon writes each session's screen to `sessions/<sessionId>.txt` (temp file, then rename) once it has gone quiet: a pass every 10 seconds takes a screen that did not change since the previous pass, and one that keeps changing every 3rd pass at the latest, so a crash loses at most 30 seconds of a busy screen. On `SIGINT`/`SIGTERM` it writes every screen that changed. After a restart, the first attach to a session with a snapshot shows the snapshot, the restored marker and then the fresh shell. `session.kill` deletes the snapshot, so a killed session does not come back. On shutdown the chats are written first and synchronously (`ChatManager.persistAllSync`), because a `bun --watch` reload restarts the module during the first await.

## Agent status via hooks

Claude Code and Codex report status through hooks. Gemini and GitHub Copilot have none, so their terminals show only the session's own status.

The daemon writes into a CLI's global settings only for a provider a person on this machine allowed. The choice is per provider (`claude`, `codex`), kept in `$RUIMTE_HOME/agent-integrations.json` (`0600`) and changed only with the local secret, through `endpoint.setAgentIntegration`; any other client gets `forbidden`. A fresh home writes nothing until then. A home whose CLI already holds Ruimte's hooks counts as allowed and asks once (`reviewed: false`).

For an allowed provider the daemon merges one command hook per lifecycle event into `~/.claude/settings.json` or `~/.codex/hooks.json` (honoring `CLAUDE_CONFIG_DIR` and `CODEX_HOME`) at startup, and into the config folder of every other account of that provider when it launches. For Codex it also writes `~/.codex/rules/ruimte.rules`, which lets Codex run `ruimte-context` outside its sandbox, because the sandbox blocks the daemon's loopback port and the daemon checks every verb itself. Without that rule Codex in a sandboxed mode cannot reach Ruimte. The merge is idempotent and leaves other tools' hooks alone, and a settings file whose top level or `hooks` is not an object is left untouched. Codex asks you to trust new hooks once (`/hooks`).

Turning a provider off removes only the hooks that are exactly what Ruimte writes, and the Codex rules file while it is unchanged, and answers per file what happened (`removed`, `deleted`, `kept-edited`, `missing`, `refused`, `failed`). A file Ruimte created goes away when nothing else is in it. The paths written are kept in the same file as a ledger, so a provider turned off later knows what to look for.

Homes share the global files. Two daemons with different `$RUIMTE_HOME`s write into the same `~/.claude` and `~/.codex`, so turning a provider off in one removes the entries the other relies on until its next start; there is no lock between processes. `--no-hooks` skips all of this: nothing is written or removed, and the choice cannot be changed while it is set (`integrations-fixed`).

Every shell gets `RUIMTE_HOOK_URL` (`http://127.0.0.1:<port>/hooks`) and a per-session `RUIMTE_HOOK_TOKEN`. The hook POSTs its stdin to `$RUIMTE_HOOK_URL/<kind>` with the token as bearer and does nothing outside Ruimte. On `SessionStart` and `UserPromptSubmit` the reply carries `additionalContext`, which is how a terminal agent hears about `ruimte-context`, its links and messages left for it. A chat never reaches these hooks.

A Codex a node launches gets `--no-daemon` when `codex --help` names the flag. Codex's shared background server would otherwise run hooks with the environment of whichever terminal started it.

The daemon folds the events into one status per session (`running`, `needs-you`, `idle`, `error`) and sends it as `session.status`.

## Permission requests

A terminal agent's permission request is answered in its CLI's own prompt; the hook only turns the status to `needs-you`. An AI chat's approvals are answered with `chat.approve`.

The agent record is also written to `sessions/<id>.agent.json`. After a restart the restored session's agent comes back with `live: false`, and the client answers with `agent.resume`, which types the CLI's resume line into the shell. When the transcript the hooks reported is gone, the session's own launch line is typed instead, so the node ends up with a working CLI. A second `agent.resume` is refused with `agent-resuming` for 15 seconds.

## Computer use

An agent operates the apps of this Mac through `ruimte-context computer`, which the daemon carries out through the helper app in `apps/computer-use` (`src/computer`). See `apps/computer-use/README.md` for the helper, and `src/computer/CLAUDE.md` for what the daemon enforces.

The helper is `Contents/Helpers/Ruimte Computer Use.app` in Ruimte.app and `apps/computer-use/dist/Ruimte Computer Use Dev.app` in a checkout. The daemon starts it with `open -g <app> --args --home $RUIMTE_HOME` the first time it needs it and quits it when the feature is turned off or the daemon stops. A daemon from npm and one on Linux have no helper and refuse with `unavailable`. `computer.restart` relaunches the helper, since macOS applies a Screen Recording grant only to a fresh launch.

## Devices

A device node shows a simulator, an emulator or a phone that runs on this machine (`src/devices`). `DeviceManager` has a backend per kind and keeps one capture session per device, shared by every client that shows it and every agent that holds it. A person starts and stops a simulator or an emulator from its node, and drives it with the pointer, its buttons and the tools panel (appearance, text size, color filters, permissions, location, opening a link or an app). An agent with a line to the node goes through `DeviceDriver` (`src/devices/agent-driver.ts`, `ruimte-context device`): it reads the elements, takes shots, taps, swipes, presses buttons, types and opens apps, with no approval card, and never starts or stops a device. An agent also lists the devices of the machine (`device list`) and puts one on its canvas itself (`node new device --device <id>`), with the line from it that lets it operate the device. A chat view puts one on the canvas it names with `--view`, with no line, and operates it by naming that canvas again. Only an agent types: a client sends no keys.

| | iOS simulator | Android emulator |
| --- | --- | --- |
| Needs | macOS with Xcode (`xcrun simctl`) | the Android SDK on macOS or Linux: `adb` from `ANDROID_HOME`, `ANDROID_SDK_ROOT`, the `adb` on PATH or the default folder, the `emulator` package to start one, and the AVDs in `ANDROID_AVD_HOME` or `~/.android/avd` |
| Start and stop | `simctl boot` and `shutdown` | `emulator -avd <name> -no-window` on a free console port, its output in `$TMPDIR/ruimte-emulator-<avd>.log`, so a start that fails says why; `adb emu kill` |
| Screen and touch | the native helper the daemon starts as `device-helper`, JPEG or HEVC | the pinned scrcpy server (`src/devices/scrcpy-server.ts`), H.264, pushed to `/data/local/tmp` for each session and gone after it |
| Shot | `simctl io screenshot` | `adb exec-out screencap -p` |
| Elements | the device bridge (`apps/ios-device-bridge`) | `uiautomator dump`, which needs nothing installed |
| Typing | each run pasted through the simulator pasteboard and Cmd+V | each run pasted through the device clipboard over the scrcpy control socket, which presses paste |
| Settings | `simctl ui` and the accessibility helper of `serve-sim` | `settings`, `cmd uimode`, `setprop` and `pm` in the device shell |

Typing on either replaces the device's clipboard. A newline is Return and a tab is Tab, so what a Return does is the app's: a chat sends, a note adds a line. Nothing is installed on an Android device, no app and no keyboard.

An Android phone on USB or Wi-Fi debugging is listed by its serial and takes the same shots, touch, typing, elements and tools; it cannot be started, stopped or given a location. An iPhone streams through the device bridge and takes touch and shots, but no text and no elements.

What an Android emulator cannot do that a simulator can, and stays out of scope:

- Clear a simulated location: the emulator console only sets one.
- Send a push: Android has no local push without the app's own Firebase sender.
- Liquid Glass, Reduce Transparency, and the Reminders and Face ID permissions, which have no Android counterpart.
- Rotate to a chosen side: the screen server turns between portrait and landscape whichever direction is asked.
- Show borders on a screen already drawn: Android draws them from the next screen on.
- Read elements on a screen that never stands still, such as one with an endless animation: `uiautomator` gives up, the agent gets `tree none`, and a shot still works.

TalkBack shows up as a tool only on an image that has it, and typing needs Android 7 or later, the first with a paste key. A development checkout downloads the scrcpy server on first use into `.native`, checked against its pinned checksum; a build carries it in `native/`, and without it a device is listed with its shots, elements and tools but without a screen, touch or typing.

## Providers and models

Each agent CLI is one `ChatProvider` value (`@adecore/agents/providers/provider.ts`). The daemon's list is `src/providers/registry.ts`, with `terminal-providers.ts` and `apple-provider.ts` beside it: Claude Code, Codex, Gemini, GitHub Copilot and the Apple on-device model (`src/chat/apple-backend.ts`, when the machine turned it on). Gemini and Copilot are terminal only. `provider.list` answers per CLI whether it is installed, its version, its models, its resume template and its capabilities.

The model catalogs are `claude-models.json` and `codex-models.json` in `@adecore/agents/providers`. Adding a model there is a JSON edit. The address book hands out the same files on `GET /v1/models/catalog`, so a model added there reaches every machine without a release. The daemon asks at start and on `provider.list` once the last answer is six hours old, and keeps the answer in `models/catalogs.json`. A catalog older than the one the app shipped with is never taken. `--no-model-fetch` turns the fetch off.

The runtime mode (`supervised`, `auto-accept-edits`, `auto`, `full-access`) is one vocabulary for every provider. Each provider maps it to its own flags: `--permission-mode` for Claude Code, an approval policy plus a sandbox for Codex.

## Chats

The chat lifecycle, the backends per CLI and the projector that builds the thread live in `@adecore/agents/chat`. `src/chat/chat-manager.ts` binds them to Ruimte, and `src/chat/CLAUDE.md` has the invariants of forks, plans, bookmarks and visuals. What the daemon owns on disk:

- Every event goes to `chats/<id>.log` as it is broadcast, so a daemon that goes down mid-turn keeps everything a client saw. Reading a chat plays the log over the snapshot `chats/<id>.json` and skips a torn last line. The log is folded into the snapshot when it passes 1 MB, on a clear and on shutdown.
- A turn that was running when the daemon went down is resumed at start through a `resume-run` outbox entry, with a note in the thread. One that cannot be resumed ends `aborted` with a note saying why.
- Attachments are any file type, at most 25 MB each and 8 per message, written to `attachments/<chatId>/<id>.<ext>`. The thread keeps only their metadata and path. `GET /attachments/<chatId>/<id>` serves them behind the same access rules as `/ws`, `inline` only for what a browser paints, with `nosniff` and an immutable cache. A chat's own thread says which id belongs to which file, so nothing else is reachable through the route. A visual's page goes through the same route and is always a download, never inline.
- A turn takes a checkpoint when it starts (`src/git/checkpoints.ts`). The chat's folder is written as a git tree through a private index under `checkpoints/`, so the person's own index, stashes and commits are untouched. When the turn settles, the daemon diffs the working tree against it for the turn's diff.
- `chat.handoff { chatId, turnId, remote }` writes the text a chat on another machine reads first: the last whole turns of the chat up to that turn as a transcript, within 12 KiB, under a header that names this machine and the checkout there. Nothing is made here; the client creates the chat on the other machine and seeds the text as its first message.

### Images an agent attaches

`ruimte-context chat attach --file <path>` reads a PNG, JPEG, GIF or WebP file in the agent's own process and sends the bytes, so the daemon never opens a path an agent names. The daemon reads the type off the bytes again and stores the image as `attachments/<chatId>/agent-<uuid>~<name>.<ext>`, at most 10 MiB each and 64 per chat. The id it prints is what `Image`, `Gallery` and `Compare` take as `attachment`, served by the same route as any other attachment. The folder goes with a clear or a deletion of the chat, and a fork copies the images under the same ids.

### Generated images

When a CLI generates an image, the daemon saves it as an attachment before the tool call settles. The thread keeps its metadata, dimensions and revised prompt; the bytes never enter the event log. A fork copies its attachments, so deleting the original leaves the fork's images.

`chat.imageTarget` and `chat.saveImage` copy an image into the project. Both require the client to hold the chat's project. A copy lands inside the project folder, never in `.git`, `.ruimte` or machine state, and a symlink at the destination is refused. Without `replace` an existing name is never overwritten. A replace names the revision `chat.imageTarget` read and is refused when the file changed since, and it publishes a new file, so it never writes through a hard link. The daemon finds the source in the thread's metadata and takes no path or bytes from the request, and the desktop bridge that opens an image never sees a source path.

`chat.search` looks for a word in the messages of every listed chat of a project, one chat after the other, newest sessions first, and `chat.searchCancel` stops it between two chats. `chat.external` lists the Claude and Codex sessions that were started in the project's folder outside Ruimte, from the transcript folders of every account and nowhere else. Both require the client to hold the project. A session the project's own chats, terminals or nodes already run is left out.

## Maps

A `Place` that names an address has its point looked up once, when the reply settles, and frozen beside the block (`uiQueries.blocks[id].places`), so every client and every later reader sees the same point. The daemon does it as this machine (`src/maps/geocoder.ts`): it asks the address book for a map ticket, signed with the machine's key and kept until five minutes before it ends, and sends the address to the map service (`apps/maps-worker`). It holds no account token, and a machine on no account looks nothing up. It asks in English and stores the label the service returns; a client words the place from the agent's own text.

A lookup that comes back without a point is frozen as `missing` with a `code` and is never tried again for that place: `no-account`, `not-found`, `unreachable`, `rate-limited`, `maps-unconfigured` or `unavailable` (the map provider refused, such as a key without the Search right). A refusal that will not pass in a moment also holds the next lookups off for a while, so a reply of fifty places asks once. A machine that signs in later does not retry the places it froze.

## Language servers

Merged completion answers apply each server's supported list defaults to its own items before concatenation, preserving individual item overrides and resolve ownership. A malformed default edit range is ignored and logged once for that answer; the remaining defaults and the other servers' suggestions survive. Malformed items are dropped.

Completion negotiation advertises snippets, both insertion modes (as-is and adjusted indentation), and the list defaults the client applies: `commitCharacters`, `editRange`, `insertTextFormat` and `insertTextMode`. The shared `applyCompletionDefaults` helper validates edit ranges and uses `textEditText`, then the item label, for a default range. Mode 1 (as-is) is the explicit completion default.

`src/language` runs the language servers of the editor. The daemon is their LSP client (`@adecore/lsp`) and the one owner of every document's text and version, so all clients of a project share what a server sees. The wire is `packages/contracts/src/language.ts`, and `src/language/CLAUDE.md` has the invariants.

| Kind | Package | Serves |
| --- | --- | --- |
| `typescript` | `typescript` 7 (native server), with a TypeScript 6 sidecar for code actions | TypeScript, JavaScript, JSX and TSX |
| `vue` | `@vue/language-server` with a TypeScript 6 tsserver that loads `@vue/typescript-plugin` | Vue, and the scripts of a project that uses it |
| `php-native` | the native server from `basmilius/language-server-php`, shown as PHP | PHP, `.phtml`, Blade, Twig |
| `php` | intelephense, shown as Intelephense | PHP |
| `css`, `html`, `json` | `vscode-langservers-extracted`, one install each | CSS, SCSS and Less; HTML; JSON and JSONC |
| `yaml` | yaml-language-server | YAML |
| `python` | pyright | Python |
| `bash` | bash-language-server | shell scripts (with shellcheck when it is on PATH) |
| `docker` | dockerfile-language-server-nodejs | Dockerfile |
| `eslint` | `vscode-langservers-extracted` | JavaScript, TypeScript and Vue, in a project with an ESLint config |
| `tailwind` | `@tailwindcss/language-server` | HTML, CSS, scripts, Vue and PHP, in a project that uses Tailwind |
| `sql-native` | the native server from `basmilius/language-server-sql`, shown as SQL | `.sql` files, against the project's schema snapshots |

The pinned npm versions are in `src/language/versions.ts`. A kind is installed only when a person presses Install (`language.install`); no verb, agent or daemon start installs anything.

Each install has its own folder, `$RUIMTE_HOME/language-servers/<kind>/versions/<id>`, and `<kind>/current.json` names the one in use and the one before it. An npm kind gets a `package.json` with exact versions and `bun install --ignore-scripts`, run by the daemon's own executable acting as bun (`BUN_BE_BUN=1` in a compiled daemon). JavaScript servers run the same way, so a person needs no Node. When a pin moves with an update of Ruimte, the kind keeps running what it has and offers Update. `language.rollback` switches back to the previous install. A kind keeps at most two installs.

The native servers install differently (`src/language/native.ts`, `installer.ts`):

- A development daemon builds a checkout with `cargo build --release --locked`. It uses `RUIMTE_PHP_LANGUAGE_SERVER_SOURCE` or `RUIMTE_SQL_LANGUAGE_SERVER_SOURCE` when set, else `../language-servers/php` or `../language-servers/sql` beside Ruimte's source checkout (or beside the primary checkout of a worktree). Discovery reads files only and never touches git. Cargo is found on `PATH` or in `~/.cargo/bin`.
- Without a valid checkout, and always in a compiled daemon, Install downloads the release pinned in `src/language/php-native-release.json` or `src/language/sql-native-release.json`. A pin names the URL, SHA-256, archive format and executable path per platform. The checksum must match before extraction, entries that escape the install folder are refused, and `--version` must answer the pinned version.
- PHP's standard library stubs are downloaded at Install for the commit the server was built against. The server starts with `storagePath` and `stubsPath`, so it never goes to the network.

`$RUIMTE_HOME/language-servers/choices.json` holds which PHP kind the machine uses (`php-native` by default), set with `language.prefer`.

A person can add servers of their own in `$RUIMTE_HOME/language-servers/custom.json` (`src/language/custom.ts`): a command over stdio, its arguments, environment, initialization options, languages, file patterns and project folders. A project file can never name a server and no verb adds one. `language.custom.save`, `remove` and `check` answer the local secret only, since a save approves that exact command, arguments and environment. An entry edited by hand so it no longer matches its saved hash is held and never started until a person saves it again.

One server runs per project per kind. It starts with the first document that needs it and ends when the project closes on the machine or the daemon stops. A server that ends by itself after a minute of being ready is started again once. Any other end leaves it `crashed` until `language.restart`. `language.log` returns the last 500 lines of the install and of the server.

## On-device help for the editor

`src/ondevice` runs one-shot generations on the machine's own model (Apple Foundation Models) for the editor's explanations, rename suggestions and ghost text. The wire is `packages/contracts/src/ondevice.ts`. It starts the same helper the Apple chat provider uses with `--oneshot` and keeps it until the daemon stops. The instructions per purpose live in `src/ondevice/instructions.ts`, so a client sends only the text to read. The helper opens no connection and has no tools, so code stays on the machine. More than four requests at once answer `busy`. A machine that is not an Apple silicon Mac reports itself unavailable without starting anything.

## Files

The file requests (`fs.read`, `fs.write`, `fs.create`, `fs.rename`, `fs.delete`, `fs.grep`, `fs.list`, `fs.browse`, `bytes.read`) live in `src/fs`.

- No file request reaches under `$RUIMTE_HOME`, by name or by where a link leads, except the Chats project, the worktrees, the screenshots and the attachments (`src/fs/machine-home.ts`). A client the machine let in is not the owner, and the local secret, the key pair and the approvals there are what tell the two apart. Such a path answers `machine-state`.
- `fs.write`, `fs.create`, `fs.rename` and `fs.delete` work only inside a project folder the calling client holds, or a worktree of its repository that the daemon made (under `$RUIMTE_HOME/worktrees`, or where the register says), compared on real paths (`outside-project`). `.ruimte` at the root of such a folder is closed (`ruimte-state`), except `.ruimte/private/consoles`, and `.git` is closed at any level.
- `fs.rename` refuses a move to another volume (`other-volume`) before it touches anything. With `overwrite` the replaced file goes to the trash; on Linux its `.trashinfo` records the path it had, so a restore puts it back there. On macOS the item lands in `~/.Trash` under its own file name; Put Back needs a record only Finder writes, so it is not offered there.
- `fs.read` and `fs.write` treat a file over 2 MB as too large for the socket. `fs.write` checks the mtime it read (`stale`) and never writes over a file that is not text. Agents have no verb for writing; they write with their own CLI.
- `GET /fs/file?path=<absolute>&v=<mtime>-<size>` (`src/fs/file-route.ts`) serves images, video, sound, PDFs and large text files behind the same access rules as the socket. Text always goes out as `text/plain`, so an HTML file never runs in the page's origin. Responses carry `nosniff`, an immutable cache, `Range` support for video and, for an SVG, a policy that allows nothing but its own styles.
- `fs.grep` uses ripgrep when it is on PATH, and a JavaScript search over the cached file list otherwise.

## Remote clients

Where a request comes from never grants anything. Behind a tunnel or reverse proxy every visitor is loopback. A process on this machine presents the local secret from `$RUIMTE_HOME/local.key` (`?token=` or `Authorization: Bearer`, compared in constant time), and is the owner of the machine (`isOwner` in `src/auth/access.ts`). The desktop app hands it to its page over the bridge, and `ruimte login`, `logout`, `status` and scripts such as `bun run smoke` read it from `RUIMTE_HOME`.

Every other client comes in through the account, on a statement from the address book carried in the offer of a direct connection. A direct connection is a WebRTC DataChannel (`src/pulsar/peers.ts`). Its signals arrive over the broker (`src/pulsar/broker-relay.ts`) or through the door on the local network, both through one `SignalGate` (`src/pulsar/signal-gate.ts`). The channel's handshake (`src/pulsar/channel-auth.ts`) binds the client's key to the DTLS fingerprints, so a broker that swaps a fingerprint breaks it. The daemon then hands out a ticket for the HTTP routes. It is good for twelve hours from its last use and lives in memory only. The clients' public keys sit in `auth.json`; `auth.sessions` lists them and `auth.revoke` cuts one off and closes its channels.

A browser upgrade is accepted from the daemon's own origin, the desktop app's (`app://ruimte`) and any loopback origin, and refused from the rest. Credentials ride as a bearer or in the query, never as a cookie. The daemon serves no page of its own.

### The door on the local network

`src/pulsar/lan-door.ts` listens on every IPv4 interface at the daemon's port plus 10 (`--lan-port`). It answers one WebSocket at `/signal` and a 404 for everything else, so the API itself stays on loopback while a client on the same network or tailnet signals without the broker. The machine proves its key before the client says anything about itself. One address opens at most 30 sockets a minute and holds at most 8. `endpoint.info` carries `lan: { port, addresses }` while the door is open, read from the interfaces at the moment they are asked (private ranges first, then a tailnet's `100.64.0.0/10`, never a container or VM bridge). The door is open unless a person closed it (`lanDoor`) or `--no-lan` is set. A port that is not free leaves the door closed with one line in the log.

### Push notifications

A client with a key (the iPhone app) hands the daemon its push subscription with `push.subscribe`, kept with that client in `auth.json` so a revoke takes it along. The daemon decides every push itself (`src/push/service.ts`) and posts it signed and encrypted to the address book, which only relays it to APNs (`apps/pulsar-worker/APNS.md`). Nothing goes to a client while it holds a socket to the machine, and a snoozed node raises nothing until its snooze ends. Each device picks the kinds it hears about (`needs-you`, `turn`, `process`), per project if it likes; without a choice it hears `needs-you` only. A finished turn and a process warning each have a collapse id of their own per node, so they never replace an attention or approval alert.

Read state lives in `push-attention.json`: per node when it last notified and how far it was read. A client acknowledges what a focused window actually shows with `push.read`, and a new turn reads the previous result. The daemon then sends a signed, encrypted read receipt, only to a client that advertises `readSync`, and a late acknowledgment never removes a newer alert. A snoozed node reads its alert, and when the snooze runs out while the node still needs you, a new alert goes out. Apple delivers background pushes when it likes, so connecting to the machine reconciles what was missed.

Each machine has one Live Activity per device, combining its terminals and chats into one signed overview with the active agents, attention first, and the totals. A work round has a generation (its `startedAt`), so a new round starts a new activity instead of reusing the previous token. A finished turn always updates the activity, whatever the device chose.

### One account per machine

A machine is on at most one address book account and is shared only with its owner. It goes on an account only when it signs a registration: `endpoint.signRegistration` (owner only, `forbidden` otherwise) or `POST /machine/registration` for `ruimte login`. The account is written to `auth.json` before the signature leaves the daemon, since anyone holding the signature can post it. The same account signs again as before. Another account is refused with `machine-has-account` until a person on the machine takes it off, with `endpoint.leaveAccount` or `ruimte logout`, both local secret only. `endpoint.info` names the account only to a client on the local secret.

A client the machine does not know gets in on a statement from the address book (`src/pulsar/statement.ts`). A v2 statement signs the key the account lists the machine under and the account. It must name this machine's own key and carry a v2 signature that holds, so an account that lists a known machine id under a key of its own gets nobody in. `AuthStore.admitStatement` decides which account a statement may name:

- On an account, only a v2 statement of that account lets a client in.
- Taken off its account by a person, no statement lets anyone in until the machine signs for an account again.
- On no account yet, a v2 statement of any account lets a client in, since its machine key proves the machine signed a registration for that account. A statement without v2 fields is refused (`account-required`). A statement never puts the machine on an account.

Each client keeps the account it came through. Going on an account cuts off clients another account let in, and leaving the account cuts off every client a statement let in and closes their channels.

## Provenance

Which chat wrote which lines of a file, for the editor's gutter (`src/provenance/`; its `CLAUDE.md` has the invariants). Each file has a record in `$RUIMTE_HOME/provenance/<projectId>/<hash of the path>.json`: the file's line hashes as last read, and per run the chat, the turn, the provider, when, the first 400 characters of the prompt, the lines (`start` and `end`, one-based and inclusive), the lines it replaced (`before`), a review state (`pending`, `kept`, `undone`) and `via`.

`provenance.read { projectId, path }` answers `{ mtime, lines, runs }`, mapped onto the text on disk now. `provenance.review { projectId, path, runIds, state }` sets a review state on every piece of those runs. Both refuse a path outside the project or under `$RUIMTE_HOME`. `provenance.changed` goes to every client that holds the project when a tool call writes a file, when a review changes, and when the turn ends. No verb reaches it and no setting turns it off.

## Git

`src/git` answers the git panel: status, diffs, blame, staging, branches, the log, worktrees and conflicts. A few operational facts:

- Commands run without a shell, with arguments as lists, so a branch name or commit message is one argument however it is spelled. `GIT_TERMINAL_PROMPT=0` keeps a credential prompt from stalling, and a step that talks to a remote gives up after two minutes.
- `git.watch` gives up on a repository with more than 5,000 tracked files, or one whose status takes longer than a second. The status then says `live: false` and the client refreshes on focus instead.
- `git.identity { paths }` answers per folder its root commits, the `origin` URL without credentials, the branch and the tips of the local branches, which is how two machines tell they hold the same repository. A folder counts only when it is the top level of its repository, and one that takes more than five seconds answers `timed-out`. Like a file request it refuses a path under `$RUIMTE_HOME` that is the machine's own state.
- `git.bundle { path, from, branch?, haves, name }` writes a checkout as a git bundle under `bundles/` and answers its id, size, sha256, tip and base. `files` is the working tree as it is (uncommitted and untracked files included), `head` is HEAD's tree and `branch` is a branch as it stands; the first two become a commit on HEAD made through the checkpoint index, so the checkout's own index, stashes, branches and files stay as they were. The commits in `haves` that this checkout has are left out of the bundle. The bundle is read with `bytes.read` (`{ kind: 'bundle', bundleId }`), up to 256 MiB; a larger checkout goes through its remote (`bundle-too-large`).
- `git.bundlePut { bundleId, offset, data }` appends a piece (up to 256 KiB, base64) of a bundle that is coming in; the pieces arrive in order, a piece at offset 0 starts over, `total` is the size of the whole bundle, and at most 16 uploads that have not reached it are open at once. `git.fetchBundle { projectId, bundleId, sha256, branch, into, machine? }` then checks the sha256, runs `git bundle verify`, fetches the one handoff ref of the bundle with hooks off into `refs/ruimte/received/<id>` and makes a worktree on a new branch `ruimte/<branch>` at its tip. With `into: 'remote-ref'` the tip is also kept as `refs/remotes/ruimte-<machine>/<branch>`, which is how the work of another machine comes back to be merged.
- `git.discard` stashes the paths as `ruimte-discard-<timestamp>` before it resets them, so `git stash pop` brings them back.
- `create-pr` needs `gh` on the PATH. A suggested commit message runs the agent CLI in its one-shot print mode, with no chat or session.

## Linked machines

Another machine of the account works in a project here only after a person links it: `peer.bind { machineId, label, projectId, ceiling? }` from any client, which is `supervised` unless a ceiling is given. `peer.list` answers every link with the name of its project, `peer.setCeiling` changes the widest mode an agent from that machine may start in, and `peer.unbind` ends the nodes that machine has here, removes the hidden canvas `peer-<machineId>` and the link. `peer.placeNodes { machineId, projectId, nodes, edges }` replaces the hidden canvas `peer-<machineId>` with the nodes that machine draws for this one (ids kept, a folder beyond the project and its worktrees refused as `cwd-outside`, a line with an end off the machine as `edge-off-machine`), and the client that asks holds the project from then on. `peer.changed` goes to every client when the list changes. The design and its rules are in `src/peering/CLAUDE.md`.

The other half sits on the machine whose person works elsewhere: `remote.link { projectId, machineId, remoteProjectId, label, rootCommit }` remembers which project on that machine this one is linked to (under `remote/<projectId>.json`), `remote.list { projectId }` answers them, and `remote.unlink` removes one, refused with `machine-in-use` while a node still runs there.

## Worktrees

A worktree the daemon makes lives under `$RUIMTE_HOME/worktrees/<repo>-<hash>/<branch>`, where `<repo>` is the repository's main checkout. The person on the machine can pick another folder for new ones (`worktreeRoot`, set with `endpoint.setIdentity` by the local secret only, refused for the root of the disk, the home folder and the data folder); worktrees already made stay where they are, and the register keeps knowing them. `worktrees.json` beside those folders (`src/git/worktree-register.ts`) records what git cannot say: the branch, where it was made from, the project, the node, who made it, and whether the daemon made the branch. Git stays the truth about which worktrees exist.

`git.worktree-remove` refuses a worktree with uncommitted, untracked or unmerged work, or a locked one, unless forced. It deletes the branch only when the daemon made it and the worktree is still on it, and answers the tip it had, since no reflog keeps it after removal. Merges run through `src/git/worktree-merge.ts`; root `CLAUDE.md` has their rules.

## Context links

A line on the canvas into a terminal or chat lets that agent read the source. Every shell and chat gets:

- `RUIMTE_CONTEXT_URL` (`http://127.0.0.1:<port>/context`)
- a bearer token: `RUIMTE_HOOK_TOKEN` in a shell, `RUIMTE_CONTEXT_TOKEN` in a chat
- the folder of `ruimte-context` in front of its PATH (`apps/server/bin` in a checkout, the app's `bin` resource when packaged)

`ruimte-context` lists the linked sources and `ruimte-context read <id>` prints one; `--tail N` prints only the last N lines. What each kind reads as is in `ruimte-context help read`. The daemon derives what a node may read from the project documents (`src/projects/project-index.ts`).

No line can run to a chat that is a view of its own. Such a chat names a canvas with `--view` instead, and then reads every node and text on it (`read <id> --view <canvas>`) and drives its browser and device nodes the same way; without `--view` a node of a canvas refuses with `view-required` (`src/canvas/chat-view.ts`).

Exit codes of `ruimte-context`:

| Code | Meaning |
| --- | --- |
| 0 | Success; the answer is on stdout. |
| 1 | The daemon cannot be reached or failed. |
| 2 | Not in a live session: no token, or a token the daemon does not know. |
| 3 | A refusal, on stderr. |

## Agent commands

Agents work with the project through `ruimte-context <verb>` and `ruimte-context <noun> <action>`. The CLI posts `{ argv }` to `POST /canvas/<verb or noun>`, and the daemon parses the words, so a CLI from an older build never disagrees with the daemon.

The registry in `src/canvas/verbs.ts` is the one source. Each verb, noun and action holds its synopsis, help lines and handler. The parser dispatches from it and `ruimte-context help` renders from it, so run `ruimte-context help`, `help <noun>` or `help <noun> <action>` for the current reference. Many actions are adapters over the catalog actions in `@ruimte/actions`, run by the daemon's handlers in `src/actions`, so an agent, a person and Voice run the same action with the same checks.

Answers are `text/plain`, one tab-separated line per result. A refusal is HTTP 422 (404 for an unknown verb) whose first line is `refused\t<code>\t<message>`, followed by what the caller can pick instead where the set is closed. The CLI prints it to stderr and exits 3.

Root `CLAUDE.md` holds the product rules for agents, and `src/canvas/CLAUDE.md` and `src/outbox/CLAUDE.md` hold the invariants of verbs, lineage, tasks and the outbox.

## Usage

`@adecore/agents/usage` answers what the CLIs cost and what is left of their plans. Nothing here calls a vendor API or reads a credential.

- The scanner reads the transcripts of every account (`~/.claude/projects` and `~/.codex/sessions`, honoring `CLAUDE_CONFIG_DIR` and `CODEX_HOME`) and keeps its place per file in `usage/index.json`. Throwing that file away costs one cold scan.
- Prices come from LiteLLM's `model_prices_and_context_window.json`, refreshed every 24 hours and kept in `usage/prices.json`, with a snapshot bundled as the offline fallback. A model the table does not price shows as unknown, never as free.
- The daemon fetches the ECB reference rate from frankfurter.app on the same schedule into `usage/exchange-rate.json`, so the client can show euros.
- `--no-price-fetch` turns off both network calls.
- Plan limits come from the CLIs themselves (`get_usage` over Claude Code's stream-json protocol, `account/rateLimits/read` over Codex's app-server), every five minutes, backing off to an hour after a failure.

## Smoke test

With a daemon running:

```sh
bun run --cwd apps/server smoke            # or: smoke ws://host:port/ws
```

It creates a session, runs `uname`, prints the streamed output and the screen a reattach would receive, then kills the session.

## A remote daemon in Docker

`docker/` runs a second daemon on Linux at `127.0.0.1:4310`, a machine that is really not the client's, for testing remote access. `bun run --cwd apps/server docker:up` starts it; `docker/README.md` has the rest.
