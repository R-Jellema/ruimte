# Pets

A small figure on every agent's node of a canvas, which a person turns on in Settings, Views, Pets.
Off to start with. Everything here is the client's: what a pet shows comes from the state the client
already holds (`chat.status`, a terminal's `session.status` from the CLI's hooks), and nothing reads
the file system, the daemon's folders or a project file.

- Which nodes have one: a chat, and a terminal whose CLI reported through its hooks (`petsOf` in
  `pet-state.ts`). A node a collapsed group hides has none.
- What it shows: working, waiting on you, idle or stopped. Waiting is the "needs you" every count
  reads (`groupAttention`). A waiting pet has a black speech bubble with an orange exclamation mark
  and jumps until the question or approval is answered. A wait a person snoozed keeps its bubble until
  it is answered but does not jump. With reduced motion nothing moves: every pet holds one frame, and
  that follows the system setting as it changes.
- A pet paints its canvas only when the picture changes (`petPainter`), so a strip of one frame at
  rest paints once.
- A click goes to the node (`goToNode`): the camera centers on it and selects it, and Back in the
  camera history returns.
- Only the figure takes a press (`petHitBox`, 52 by 40 world pixels from its feet up, which covers it
  at rest and through its jump); the bubble above it never does. Where that box lies on another node
  (`coversOtherNode`, a group the node stands in aside), or while a line is being aimed, the pet takes
  no press at all, so a press on the bottom of a node standing close above still lands in that node.
  Its button still takes the keyboard. A text on the canvas is not counted.
- One interval for the page drives every pet (`ticker.ts`), only while a pet is mounted, and a pet
  whose node is out of view mounts no canvas (`useNodeInViewport`).

## The visitor

While Pets is off, a pet now and then stands beside a node on screen for four seconds and fades
away (`visitor.ts`), never where it would stand on another node. One clock for the page, a first
visit 20 to 60 minutes after a canvas opens and the next 20 to 60 minutes after that, only while the
window is visible and nobody is dragging or has a node maximized. It takes no press. It is on by
default and has no row in Settings; the setting `petsVisitor` in `ruimte.settings` turns it off: set
it to `false` in this client's storage.

## A figure of your own

Settings, Views, Pets, Add figure takes one file from the system's open panel. Only that file is
read; it is kept as a data URL in this client's storage (`ruimte.pets.sprites`), which every window
of the app shares and no machine sees. What is read back from there goes through the same checks as
an import (`storedSpriteOf`): the bytes, the byte limit and the size in the image's own header against
the frames stored beside it, so an entry edited by hand that does not pass is dropped. A strip whose
decoded image has another size than it says is not drawn.

The format:

- A PNG or a WebP image, at most 64 KB. The bytes must start with the signature of that format; an
  SVG, or any other file with a PNG name, is refused.
- One row of square frames, left to right, with no gaps. A frame is as high as the image, so the
  width is the height times the number of frames.
- A frame is 8 to 256 pixels high, and a strip has 1 to 16 frames. A single square image is a strip
  of one frame.
- A transparent background. The frames are scaled without smoothing, so pixel art stays sharp;
  the figure is drawn about 36 pixels high on the canvas at 100%.
- The strip plays in a loop for every state: at a walk while the agent works or waits on you, slower
  while it is idle, and tipped over and faded once it stopped. The bubble and the jump are drawn over
  it as for a built-in figure.

At most 8 figures are kept. A figure you added stands for every agent; the built-in sets have one
for Claude and one for Codex, and every other CLI gets Claude's.
