# Browser pages

The invariants of this folder. The repository root's `CLAUDE.md` has the map, the wire protocol and the rules that hold everywhere; `apps/server/src/browser/CLAUDE.md` has where a page lives and how an agent drives it.

- A browser page is an Electron `<webview>`, and Electron destroys the guest whenever the element or anything above it changes parent, a state-preserving `moveBefore` included. So every page is parked in one layer over the canvas (`WebviewParking.tsx`), whatever a cell draws over a page is portaled into the layer above it (`apps/client/src/shell/CellOverlay.tsx`), and a page cuts a hole out of itself for every node standing on top of it, so the canvas under the layer shows through and the page keeps running (`page-clip.ts`).

## Product rules

Decisions the code cannot show. Do not reverse one without asking Bas.

- A page in a `<webview>` does not pinch-zoom, since Chromium scales only the top-most widget. A `WebContentsView` per page and `setZoomFactor` were weighed and rejected.
