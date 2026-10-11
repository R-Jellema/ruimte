# Speech to Text

Local dictation, under Voice settings beside Voice Control, on Nemotron streaming only. Root `CLAUDE.md` has the product rules (off by default, no agent starts it, audio never leaves the machine).

- `audio/ownership.ts` permits one microphone listener at a time, shared with Voice Control.
- A run owns one target and one session ID. Cancelling, unmounting its target, replacing its draft or receiving stale IPC must never insert elsewhere.
- Live transcripts are complete replacement previews. Only the final transcript is inserted, once, after stopping. Escape discards.
- A terminal's paste sends sanitized text through xterm; never Enter, control characters or partial transcripts.
- The microphone closes on normal stop, cancellation and every failure. Stop drains the final worklet block before asking the helper for its last result.
- No word substitutions or spoken commands. Recognition errors remain visible for the person to edit.
- A failure reaches a person only through `failure.ts`. Each `DictationError` code is a key under `voice:dictation.errors`, and a person never sees a raw code or a Chromium message.

`controller.ts` coordinates the target and audio ownership. `helper.ts` manages capture and the optional desktop bridge. `editor.ts` tracks CodeMirror insertion ranges and isolates undo history. The desktop shell owns downloads, persisted enablement and the helper's sixty-second idle timeout. IPC shapes live in `packages/desktop-bridge/src/speech.ts`.
