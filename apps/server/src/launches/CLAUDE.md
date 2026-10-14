# Launches

The invariants of this folder. The repository root's `CLAUDE.md` has the map, the wire protocol and the rules that hold everywhere, including that no verb starts a command; the verb is `apps/server/src/canvas/launch-verb.ts`.

## Product rules

Decisions the code cannot show. Do not reverse one without asking Bas.

- A launch is the one exception to the rule that an agent starts no command through a verb. `ruimte-context launches` lists and reads them, and starts, restarts and stops only a launch a person approved on this machine for its command, folder and environment as they stand now (`agent-host.ts`). Anything else is refused with `launch-held` and the chip asks the person.
- After a worktree chat settles the daemon starts one launch by itself: the one task a person chose for the project, which that choice approved for its worktrees as its command and environment stand then, in that chat's worktree, once per settled turn, through the outbox (`run-after-settle`, `after-settle.ts`). The chat gets notes and no wake.
- An agent's stop is Ctrl+C and then SIGTERM; SIGKILL is only a person's Force stop (`runner.ts`). An agent never adds, edits or approves a launch.
