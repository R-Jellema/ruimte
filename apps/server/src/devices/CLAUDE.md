# Devices

The invariants of this folder. The repository root's `CLAUDE.md` has the map, the wire protocol and the rules that hold everywhere; `apps/server/README.md` ("Devices") sets the iOS and Android kinds side by side, and the verb is `apps/server/src/canvas/device-verb.ts`.

## Product rules

Decisions the code cannot show. Do not reverse one without asking Bas.

- A device node is driven only over a line between it and the agent, by screenshots and taps (`ruimte-context device`), with no approval card: the device is its own sandbox.
