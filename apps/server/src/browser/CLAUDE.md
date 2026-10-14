# Browser nodes

The invariants of this folder. The repository root's `CLAUDE.md` has the map, the wire protocol and the rules that hold everywhere; `apps/client/src/browser/CLAUDE.md` has the page in the desktop app, and the verb is `apps/server/src/canvas/browser-verb.ts`.

- A browser node's page lives where it is shown: a `<webview>` in the client on the desktop, a page on the daemon for a client that has no browser of its own. The daemon reaches the first kind only while that client holds it (`browser.hold`, `browser.drive`), drives both through one door (`drive.ts`), and nobody holding the page is an answer and never an error.

## Product rules

Decisions the code cannot show. Do not reverse one without asking Bas.

- A browser node is driven only over a line between it and the agent, and only by address: where the page goes, its own history and a picture of it (`ruimte-context browser`), never a click, a keystroke or a scroll.
