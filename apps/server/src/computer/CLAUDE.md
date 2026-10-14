# Computer use

The invariants of this folder. The repository root's `CLAUDE.md` has the map, the wire protocol and the rules that hold everywhere; `apps/computer-use/README.md` has the helper and what each command does.

- Off per machine until a person turns it on (`computer.setEnabled`). While off every action refuses with `computer-use-off`, the helper is never started and the verbs note leaves the noun out. Every request to the helper carries the local secret.
- Every action that reads or operates an app needs a person's yes for that app by bundle id, in every permission mode; only `apps` asks nobody. "This time" lives in memory until the agent's turn ends; "always" is written to `$RUIMTE_HOME/computer-use/grants.json`, which no verb writes. The helper is told the pid the person let in, never the name the agent typed. Only a person lists or revokes grants.
- A call holds for a card `APPROVAL_WAIT_MS` (6 seconds, under the 10 seconds some CLIs give a shell command) or `--wait` up to `MAX_HOLD_MS` (110 seconds), then refuses with `awaiting-approval`. The canvas route lets a verb run `CANVAS_REQUEST_TIMEOUT_S` (240 seconds). A card stays up `CARD_MS` (ten minutes) after the agent last asked (`approvals.ts`).
- An app that runs shells is refused with `terminal`, whatever was granted: a process up to three levels below it with a controlling terminal the app does not share, or a bundle id in `terminal-apps.ts`. An app once seen doing so is remembered in `grants.json`. The Ruimte desktop app is never a terminal; its shells run under the daemon.
- One agent operates the Mac at a time, since the helper runs every action in one line (`presence.ts`). It holds the Mac until its turn ends, its node closes or it exits; anyone else gets `busy`, and with `--wait` stands in line in the order it asked.
- Work happens behind the person's work unless the agent passes `--front`. What only the front can do refuses with `needs-front`, and the daemon never retries it in front on the agent's behalf.
- A pause or take-over makes calls wait within the same budget, then refuse with `paused` or `taken-over`. An action the person cut off is never sent again, since it may have run halfway. After a stop every agent that used computer use hears `stopped` once, every grant for this time goes, and the daemon then clears the stop so it is no ban.
- The tree an agent last saw lives in the daemon, not the helper (`tree-diff.ts`), since the helper keeps one element map for every agent. It goes with the node and when computer use is turned off.

## Product rules

Decisions the code cannot show. Do not reverse one without asking Bas.

- Computer use is the desktop's own door: off per machine until a person turns it on, then `ruimte-context computer` operates any app, Ruimte included, only after a person let the agent into that app (this time or always, in every mode), and never a terminal.
- Letting an agent into Ruimte itself is the person's own risk: it can do there whatever the person can, and the daemon refuses nothing extra from the Ruimte window while it does.
- Computer use stays as it is and gains no new abilities; Bas hopes to remove it once the agents' own computer use is good enough (2026-10-13).
