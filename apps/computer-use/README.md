# Computer use

This macOS-only app lets an agent see and operate another Mac app. It reads the accessibility tree of a window, captures the window, and clicks, types, scrolls and runs menu items in it. It is an app of its own because macOS attaches the Accessibility and Screen Recording grants to a bundle, so they belong to **Ruimte Computer Use** and not to the daemon, a terminal or the agent that asks. It runs in the background (`LSUIElement`). While it acts it shows a session bar at the top of the screen and an item in the menu bar and the phantom cursor, and the person can pause it, take over or stop it at any time.

Every command works behind the person's work unless it asks for the front, so the person can go on while an agent operates an app they are not using (see [Background and front](#background-and-front)).

The daemon talks to it over a Unix socket. `cu` is a command line for the same socket, for development and debugging only; it is built into the dev app and never ships.

## Build

```sh
bun scripts/build.ts
```

This builds the package with Swift Package Manager and assembles `dist/Ruimte Computer Use Dev.app` (bundle id `app.ruimte.computer-use.dev`) with `cu` inside it and `dist/cu` linked beside it. `bun dev` in `apps/desktop` runs the same build first. The dev app has its own bundle id and name, so a checkout and an installed Ruimte never share an entry in System Settings.

The script signs with the first Apple Development identity in the keychain (`security find-identity -v -p codesigning`), with the hardened runtime and the empty entitlements in `Resources/entitlements.plist`. A stable identity keeps the grants across rebuilds. Without one it signs ad hoc and says so; macOS then asks for the grants again after every build. `--identity <name|hash|->` or `RUIMTE_COMPUTER_USE_IDENTITY` picks another identity, and `-` signs ad hoc.

### In Ruimte.app

`apps/server/scripts/compile.ts` builds `--variant release` (`Ruimte Computer Use.app`, `app.ruimte.computer-use`) into `apps/server/dist/mac-<arch>/Helpers`. electron-builder copies that folder to `Ruimte.app/Contents/Helpers` and keeps it out of `Contents/Resources/bin`. `Contents/Helpers` is where a bundle expects a nested app. Codesign signs and verifies it there as nested code; under `Resources` it would only seal it as files. `apps/desktop/build/sign.cjs` signs it like everything else, with the app's Developer ID, the hardened runtime and a timestamp. Its entitlements are `Resources/entitlements.plist`, not the shell's. Those open up JIT and library validation for Electron and the daemon, and a helper with these grants has no use for either.

The daemon inside the app finds it at `../../Helpers/Ruimte Computer Use.app` from its own executable (`Contents/Resources/bin/ruimte`). A daemon from npm has no helper.

## Launch and authentication

The daemon starts the helper with the home it serves:

```sh
open -g "<path>/Ruimte Computer Use.app" --args --home "$RUIMTE_HOME"
```

Without `--home` the helper takes `~/.ruimte`, or `~/.ruimte-dev` for the dev app, which are the daemon's own defaults. macOS runs one instance per bundle id, so a helper that already serves another home has to quit before it can serve this one.

Everything it keeps sits under `$RUIMTE_HOME/computer-use/` (mode `0700`):

```
agent.sock        the socket, mode 0600
overlay.json      the words of the overlay, written by the daemon
screenshots/      window captures; one older than an hour goes at the next capture
```

A connection carries one request. The client writes one JSON object and half-closes, the helper answers with one JSON object and closes. The request is `Request` in `Sources/ComputerUseCore/Wire.swift`. It holds `command`, the fields that command takes, and `secret`, the content of `$RUIMTE_HOME/local.key`. The helper accepts a connection only from a process of the same user. It accepts a request only when `secret` matches that file, which it reads again for every request and compares in constant time. Whoever can read `local.key` can drive the daemon already, so the helper is no weaker than the daemon. The reply is `{"ok": true, "result": {...}}` or `{"ok": false, "error": "...", "code": "..."}`. `code` is there only for a refusal a caller branches on (`paused`, `taken-over`, `stopped`, `needs-front`); the message is for people and may change. A request without the secret gets `refused: ...` before the helper looks at anything else in it.

The commands are the ones `cu` sends, listed below, with field names in `Wire.swift`. `doctor` also takes `grant` (`accessibility` or `screenRecording`), which asks macOS for that one grant only and leaves opening the pane to the caller; `cu` has no flag for it.

Every command that acts runs one at a time, in the order it came, so two callers never race for the focus. `wait` is the exception: it only reads and may take two minutes, so it runs beside the queue, and a pause, a take-over or a stop cancels it like a queued command. Every state carries `instance`, a UUID for this run of the helper: handles start over at 0 when it restarts, so a caller that remembers a tree knows it cannot compare the next one with it.

### The words

`overlay.json` holds the overlay's words, written by the daemon in the person's language. The helper reads it again at every action and every `presence`, so a language switch reaches a running session; a missing file or key keeps the English default. The keys and defaults are in `Sources/ComputerUseCore/OverlayConfig.swift`.

### Presence

The helper sets the action states itself from the commands it runs. What it cannot see, the daemon tells it:

```json
{ "command": "presence", "state": "think", "label": "Reading the inbox", "step": "Step 12 · Reading the inbox", "secret": "..." }
```

`state` is `think`, `waiting`, `permission`, `error`, `done` or `end`; `label` replaces the words beside the cursor and `step` the step line of the menu, both optional. The reply is `{"session": true, "shown": "<state on screen>", "mode": "running|paused|takenOver"}`. While the person holds the session, the state is kept and shows once they resume. `think`, `waiting`, `permission` and `error` start a session when none runs; `done` without one answers `{"session": false, "shown": null}`. After a stop the first four are refused like an action. `done` ends the session once its cursor has faded. With `"ends": true` any state does what `done` does: it shows for a moment, three seconds for words to read, and then the session ends. `end` is for an agent that went without finishing: it ends the session at once, paused or taken over too, without the checkmark, and answers `{"session": false, "shown": null}`.

## Grant the permissions

Run `cu doctor`. It asks macOS for what is missing and opens System Settings. Then:

1. **Accessibility**: System Settings > Privacy & Security > Accessibility. Turn on **Ruimte Computer Use Dev**. If it is not listed, click +, pick `dist/Ruimte Computer Use Dev.app` and turn it on.
2. **Screen Recording**: System Settings > Privacy & Security > Screen & System Audio Recording. Turn on **Ruimte Computer Use Dev** the same way.
3. Run `cu quit`. Screen Recording only applies to a fresh launch; the next `cu` command starts the agent again.
4. Run `cu doctor --no-prompt` and check that `ready` is `true`.

## Usage

`cu` needs a daemon that has run once for its home, since it presents that home's `local.key`. There is no separate start step: the first command starts the app `cu` sits in with `open`, and `cu quit` stops it. `RUIMTE_COMPUTER_USE_APP` points it at another app, such as the one inside a packaged Ruimte.

```
cu doctor [--no-prompt]                  check Accessibility and Screen Recording;
                                         without --no-prompt it asks macOS for what is missing
cu apps                                  list running apps with name, bundle id, bundle file name
                                         (bundleName), pid, frontmost
cu open <app>                            launch an app, or unhide it; --front brings it forward
cu state <app> [--find T] [--within N]   accessibility tree of the key window, plus a PNG of it
cu click <app> --element N [--count 2] [--button right]
cu click <app> --x PX --y PX [--count 2] [--button right]
cu scroll <app> (--element N | --x PX --y PX) --direction up|down|left|right [--pages N]
cu type <app> <text>                     type text into the focused element
cu key <app> <combo> [<combo>...]        press keys: cmd+n, return, escape, tab, shift+tab, up
cu set-value <app> --element N <value>   set the AXValue of element N
cu drag <app> (--from N | --from-x PX --from-y PX) (--to N | --to-x PX --to-y PX)
cu read <app> --element N                every text of element N whole, with its role and frame
cu wait <app> (--for T | --gone T | --element N --value V) [--timeout S]
                                         read the app until the condition holds (10 s, at most 110 s)
cu menu <app>                            list the menu bar with indices
cu menu <app> <index | "File > Save">    run a menu item
cu presence <state> [--label T] [--step T]
                                         think, waiting, permission, error, done or end
cu pause | resume | stop                 what the buttons of the session bar do
cu quit                                  stop the agent
cu render sheet|<state>|bar [<state>]    development: the overlay as PNGs, see below
```

Every command takes `--home <dir>`; without it `cu` uses `RUIMTE_HOME`, else the default of the app it sits in. Every command that reads or operates an app takes `--front`. Options for `state`, and for every action together with `--state`:

```
--front            bring the app to the front and use the real pointer and keyboard (see below)
--state            after the action, wait until the UI settles and answer with a new state
--text             print the tree (or menu) as plain text instead of JSON
--no-screenshot    --max-depth N (60)    --max-elements N (500)    --max-text N (100)
```

`<app>` is a name, a bundle id or a pid from `cu apps`. The name may be the localized one (`Rekenmachine`) or the bundle's file name (`Calculator`).

Every command prints JSON on stdout. On failure the exit code is 1, stdout holds `{"error": "..."}` and stderr repeats the message. Put `--` before text that starts with `--`: `cu type TextEdit -- --flag`.

### A typical loop

```sh
cu open TextEdit
cu state TextEdit --text                      # read the tree, look at the screenshot
cu click TextEdit --element 2                 # focus the text area
cu type TextEdit "Hello"
cu menu TextEdit "File > Save" --front --state --text # save goes to the window, which needs the front
```

With `--state` an action waits until the tree stops changing (the same tree three polls in a row, 120 ms apart, 3 seconds at most) and returns the new state under `state`, with `settled` saying whether it did settle. That replaces a separate `state` call and guessing at sleeps.

### `state`

One line per meaningful element: controls, anything with a title, value or description, and landmarks such as windows, sheets, scroll areas, web areas, tables, lists and open menus. Plain containers are left out and their children move up.

```
[0] Window:StandardWindow "Untitled 2" (292,161 586x488)
  [1] ScrollArea (292,229 586x420)
    [2] TextArea value="1\n2\n3…"(cut: 1091 chars) id="First Text View" (292,261 586x382) focused
  [26] Sheet "save" id="save-panel" (391,296 388x218)
    [36] Button "Save" id="OKButton" (679,469 81x26)
```

- `[N]` is the handle for `--element`. An element keeps its number for as long as it is the same accessibility element, and a number is never reused for another one. Numbers start over when the helper restarts (`instance` changes).
- The frame is in screen points, top-left origin of the main display. `offscreen` marks an element outside the window or scrolled out of its container; such elements get at most a fifth of the lines, so a long pane never pushes out what shows. It can still be pressed, read and set, but a mouse event for it is refused until `scroll --element` brings it in.
- The tree stops at 500 elements and 60 levels by default, and `truncated` says when and why. `--find T` reads up to 5000 elements and keeps those that hold `T` with what they sit in; `--within N` lists only element `N` of the last state.
- `screenshot.path` is a PNG of the window alone (`SCContentFilter(desktopIndependentWindow:)`), at most 1280 px wide, so other apps and the overlay never show and a window behind the person's work comes out whole. While a sheet, menu or popover is up, the app's windows are composed on their display instead. Map a pixel with `screenX = origin.x + px / scale`; `click --x --y` does this for you.
- For Chromium and Electron apps the helper sets `AXManualAccessibility`, and `AXEnhancedUserInterface` when the tree stays nearly empty. Chromium stops drawing a window that others cover whole, and `note` says so, since its picture and tree may then be stale.

### Background and front

Without `--front` a command works behind the person's work. It never activates the app, moves the real pointer or posts to the system's event stream, so the app in front keeps the focus and the person's keys:

- `click --element` presses the element (`AXPress`), puts the focus in a field that has no press (`AXFocused`), or opens its menu for `--button right` (`AXShowMenu`). That menu is on screen where the app puts it, a Chromium one at the real pointer, so it may stand over the person's work until an item of it is pressed or escape goes to the app.
- `type` and `key` focus the element again, make its window the app's main window (`AXMain`), which raises it among the windows behind but does not activate the app, and post each key to the app's process alone (`CGEvent.postToPid`), a character every 40 ms. Whether a key arrived shows only in the focused value, and a terminal takes its keys and keeps its field as it was, so `type` never refuses once a key went out: when the focused value did not change, its `note` says so. A row of a list is never focused again: a browser reports the row `aria-activedescendant` names as the focused element while its keys go to the text, so the focus goes to the element that names the row as `AXActiveDescendant`, or stays where the app keeps it (`KeyAim.swift`).
- `scroll --element` uses the page actions of the element or what it sits in, and else sets the value of the scroll bar of the scroll area around it. Chromium has neither for an element that scrolls, only `AXScrollToVisible`: then a step brings the next element hidden past that edge into view, from inside the element or else from what it sits in, and Chromium centers it, so a step is about half a page. An element that is itself out of view is brought in first. Wheel events posted to a process do not scroll, in native apps or in Chromium.
- `set-value`, `read`, `wait`, `state` and `menu` work as they do in front; `open` starts an app without activating it, or shows a hidden one.

What only the front can do is refused with `code` `needs-front`, whose message says to call again with `--front`, and never done in front on the helper's own: a click by pixel, a double click, a click on an element without a press, a drag, a scroll by pixel or of an area with no accessibility scrolling, keys for a minimized window or one on another Space, and select all, cut, copy, paste, undo and redo by key or by menu. Those go to the focused view of the key window, and an app behind the person's work has none; the same holds for a menu item such as save, export or print, which the helper cannot tell apart, so a `menu` in the background says so in its `note`.

With `--front` the app comes to the front where an action needs it (a minimized window is shown again first), keys go through the system's event stream, and mouse events use the real pointer and put it back.

### Actions

Every action result has `target`: the role, label, identifier and window of what it acted on.

- Before a mouse event for an element, the helper hit-tests the point and refuses unless it finds that element or something inside it. This catches a window that opened over the old one. `click --x --y` is refused when another app's window covers the point.
- `type` takes at most 500 characters and `key` at most 50 combos per call, refused before anything is typed, since every other command waits behind them. Keys are ANSI key codes.
- `set-value` reads the value back for up to a second, because some apps answer success and keep the old value; `note` says when the value differs.
- `drag` lets go of the button also when the person interrupts halfway. Only its start is hit-tested, since the end is often another element or window.
- `wait` reads the app every 250 ms and answers with the state at the end, also when the time ran out.

### Menus

`cu menu <app>` lists the menu bar as an indented tree with shortcuts, `checked`, `disabled`, and `>` for a submenu. The first menu is the system's; its items are not listed, since they are the same everywhere and include recent files. `cu menu <app> 25` runs item 25 from the last listing; `cu menu <app> "File > Save As"` finds it by title, ignoring case and a trailing ellipsis, and names the choices when a step does not match. The agent presses the item through accessibility, with `--front` after bringing the app to the front. Picking a top-level title opens that menu.

`disabled` is what the app reported when it last refreshed the menu, which it usually does only when the menu opens, so the agent tries a disabled item anyway.

### The phantom cursor

During a session the helper draws its own cursor in a click-through window above everything. The real pointer only visits a point for a mouse event and goes back. The cursor shows each action and, between actions, the state the daemon sends with `presence`. Nothing of the overlay appears in a screenshot. In the background the cursor shows as well, over whatever covers the app, so the person sees that something happens and where. Under Reduce Motion it drops every loop and reads by color and label alone.

The session bar at the top of the screen and the menu bar item show the state, the time the agent held the Mac, and Pause, Take over and Stop session. A session ends on a stop, on `done`, or two minutes after the last command unless it waits for the person or the person holds it.

### Pause, take over, stop

- ⌥Space, the pause button or the menu pauses and resumes. ⌥⎋, the stop button or the menu stops. Both keys are registered only while a session runs and never reach the app in front. A key another app already holds is logged, and the menu then shows no shortcut for it.
- The person's mouse takes over: a click, or more than 12 points of movement within half a second inside the window the agent acts in. In the background only bringing that app to the front or clicking in its window takes over, so the person can go on working elsewhere. Waiting for the person never counts, and the helper's own events carry a marker so they are never mistaken for the person.
- While paused or taken over, every command that reads or operates an app is refused with `code` `paused` or `taken-over`, and an action under way is cancelled.
- A stop cancels what runs and ends the session. Every later command is refused with `stopped` until the next `cu state` or a `clear-stop` on the socket, which the daemon sends once it told its agents.
- `pause`, `resume` and `stop` on the socket are the same buttons. `doctor` answers with `session` (`active`, `mode`, `stopped`), so a caller can read the session without changing it.

### The look

`Sources/Phantom` holds the look apart from how the helper moves it: tokens in `OverlayStyle.swift`, forms in `PhantomForms.swift`, the state table in `PhantomLook.swift` and every animation as a `Track` in `Motion.swift`, so a snapshot draws the same value the overlay plays. `cu render` draws it offscreen without the agent, a grant or a screen:

```sh
cu render sheet --theme both --scale all --out /tmp/phantom   # every state, the forms, the session bar
cu render bar think --time 02:31                              # the session bar; --held shows it paused
```

A render cannot draw glass, since the window server draws it from what lies behind a window.

## Known limitations

- Keys are ANSI key codes: `cmd+z` on an AZERTY or Dvorak layout presses the key in the US position. `type` is not affected.
- Only the key window of an app is read, with its sheet and open menus. A window on another Space cannot be read or captured; a minimized one gives its last frame.
- The screenshot composes the app's windows in their own stacking order. Another window of the same app behind the key window shows where the key window does not cover it.
- Autocorrect and smart substitutions in the target app still apply to typed text.
- Some apps report an `AXPress` as done without acting on it. Then click on coordinates instead.
- Only a click or a move of the mouse takes over; typing does not.
- `cu doctor` exits 0 even when a grant is missing; read `ready`.
- In the background a menu item or key that goes to the focused view or window (save, export, print, select all, copy, paste) does nothing, and the helper refuses only the edit commands it can recognize by their shortcut.
- In the background a Chromium or Electron window that others cover whole may show a stale picture and tree, unless the app runs with `--disable-backgrounding-occluded-windows`.
