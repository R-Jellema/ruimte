# Devices

The invariants of this folder. The repository root's `CLAUDE.md` has the map, the wire protocol and the rules that hold everywhere; `apps/server/README.md` ("Devices") sets the iOS and Android kinds side by side, and the verb is `apps/server/src/canvas/device-verb.ts`.

## Product rules

Decisions the code cannot show. Do not reverse one without asking Bas.

- A device node is driven only over a line between it and the agent, by screenshots, taps and the tools (`ruimte-context device`): settings, a link, the clipboard, a recording, biometrics, permissions, a push and installing an app or adding media, with a path only inside the project folder or its worktrees. Starting, stopping, restarting, erasing, folding and the camera stay with the person. No approval card: the device is its own sandbox. The one exception to the line is a chat view, which no line can reach: it operates any device node of the canvas it names with `--view`, and `node new device` from a chat view draws no line (`src/canvas/chat-view.ts`).
- Only a person erases a device, after confirming; an agent never does.
