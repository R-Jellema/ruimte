# Speech bridge

Local streaming speech recognition for the optional Speech to Text feature. The Electron shell owns the helper and model files. Audio is held in memory for the current dictation and is never written to disk or sent over the network.

A release builds the helper for macOS only. The prebuilt ONNX Runtime that `ort` links wants a newer glibc and libstdc++ than the Ubuntu 22.04 floor the Linux build targets, and raising that floor would lock out Debian 12. Without the helper beside the daemon, Settings reports Speech to Text as unavailable.

## Development

`bun dev` builds the release helper before starting Electron. Rust and a working native toolchain are required. A standalone build is `cargo build --release --locked` in this directory.

In **Settings > Voice**, enable **Speech to Text**. This downloads approximately 2.6 GB of Nemotron 3.5 ASR streaming ONNX weights. The source revision, file sizes and SHA-256 hashes are pinned in `apps/desktop/src/speech-model.ts`. Files are downloaded to temporary names and installed only after verification. Cancellation keeps completed, verified files for a retry.

Turning it off cancels a recording and shuts down the helper, but keeps the model. **Remove model** removes the weights and their compiled CoreML cache.

The helper uses ONNX Runtime on the CPU. CoreML compilation of this streaming model crashed inside Apple's native compiler, and that process-level crash bypasses Rust error recovery.

## Helper protocol

`serve --model <directory> --cache <directory>` loads the streaming model once and reads newline-delimited JSON on stdin:

- `start`: `sessionId`, `language` (a supported BCP 47 locale or `auto`).
- `samples`: `sessionId`, `audio` (base64 f32 little-endian, mono, 16 kHz).
- `stop`: flush the final audio and end the utterance.
- `cancel`: discard the utterance.

Stdout events carry `sessionId`: `ready`, `transcript` with the complete `text` and `final`, `ended`, or `failed` with `message`. Each live transcript replaces the previous preview. It is never appended as a word fragment. The client waits for `ready` before opening its microphone. An unexpected exit closes the microphone and discards the result.

The desktop shell kills an idle helper after sixty seconds. Finished utterances reset decoder state while retaining the model. Cancelling kills the helper immediately, including during a cold load. A recording is bounded to ten minutes.

`probe --model <directory> --cache <directory>` checks that a model loads. `transcribe --model <directory> --language nl-NL --cache <directory>` reads raw samples from stdin for synthetic or recorded test fixtures. Neither command records a microphone.

## Verification

`cargo test --locked` covers sample and protocol validation; the open device checks are in [`docs/ACCEPTANCE.md`](../../docs/ACCEPTANCE.md#speech-to-text). Model weights have their own NVIDIA license; the app does not bundle them.
