# Pets

A small figure on every agent's node of a canvas, which a person turns on in Settings, Views, Pets.
Off to start with. Everything here is the client's: what a pet shows comes from the state the client
already holds (`chat.status`, a terminal's `session.status` from the CLI's hooks), and nothing reads
the file system, the daemon's folders or a project file.

- Which nodes have one: a chat, a design (through the chat under its own id, as its status dot), and a
  terminal whose CLI reported through its hooks (`petNodeKey` and `petOf` in `pet-state.ts`). A node
  a collapsed group hides has none.
- What it shows: working, waiting on you, idle or stopped. Waiting is the "needs you" every count
  reads (`groupAttention`). A waiting pet has a black speech bubble with an orange exclamation mark
  and jumps until the question or approval is answered. The bubble stands over its head, or beside it
  where another node lies there (`petCrowded`), such as one 40 pixels above, so it never covers that
  node. A wait a person snoozed keeps its bubble until it is answered but does not jump. With reduced
  motion nothing moves: every pet holds one frame, and that follows the system setting as it changes.
- A pet whose node has a color wears a bow in it on its head (`bow` and `bowColors` in `pixel.ts`),
  so a person tells which pet is whose. Each pose of a built-in figure says where its head is; a
  figure a person added gets none, since nothing says where its head is, and the visitor, which
  belongs to no node, none either.
- A pet paints its canvas only when the picture changes (`petPainter`), so a strip of one frame at
  rest paints once.
- A click goes to the node (`goToNode`): the camera centers on it and selects it, and Back in the
  camera history returns.
- Only the figure takes a press (`petHitBox`, 52 by 38 world pixels from its node's top edge up, which
  covers it at rest and through its jump); the bubble never does. Where that box lies on another node
  (`coversOtherNode`, a group the node stands in aside), or while a line is being aimed, the pet takes
  no press at all, so a press on the bottom of a node standing close above still lands in that node.
  Its button still takes the keyboard. A text on the canvas is not counted, and neither is a card
  beside a node, such as a design's pages.
- One interval for the page drives every pet (`ticker.ts`), only while a pet is mounted, and a pet
  whose node is out of view mounts no canvas (`useNodeInViewport`).

## Along the bottom of the screen

Settings, Views, Pets, Where pets are (`petsPlace`) takes the pets off their nodes and puts them along
the bottom of the canvas, over it in its cell's overlay and under the dock (`PetRoam.tsx`). Nodes
still have them, so a node a collapsed group hides has none here either.

- `roam.ts` decides where each one is, a beat at a time on the shared clock: it rests a while in its
  mood's pose, walks (`walk`, the one pose only this place uses) somewhere else on the floor or onto
  the dock, and rests again. One that waits on you or stopped stays where it is. New ones start
  spread over the floor. A pet whose way runs past another jumps over it; one already in the air
  passes under.
- The floor runs between what stands on it: the dock, the minimap and a prompt card low enough to
  touch a pet (`PET_LEDGE_ATTRIBUTE` and `PET_WALL_ATTRIBUTE` in `attributes.ts`, the prompt stack by
  its own attribute). A pet hops onto the dock and off again at its ends; the minimap it only walks
  up to. A dock that hides, or a prompt card that comes up over it, sends the pets on it to the floor
  beside it.
- The obstacles are measured on every beat, in whole pixels, so the ground changes only when one moves.
- With reduced motion they only take their place.
- A click goes to the node, as on a node; the bubble and the bow are the same.

## The visitor

While Pets is off, a pet now and then stands beside a node on screen for four seconds and fades
away (`visitor.ts`), never where it would stand on another node. One clock for the page, a first
visit 20 to 60 minutes after a canvas opens and the next 20 to 60 minutes after that, only while the
window is visible and nobody is dragging or has a node maximized. It takes no press. It is on by
default; Settings, Views, Pets, Visitor turns it off (`petsVisitor`).

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
