use std::io::{BufRead, Read, Write};
use std::path::PathBuf;

use anyhow::{Result, bail};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use clap::{Parser, Subcommand};
use parakeet_rs::{ExecutionConfig, ExecutionProvider, Nemotron, NemotronHandle};
use serde::Deserialize;
use serde_json::json;

const SAMPLE_RATE: usize = 16_000;
const MAX_SAMPLES: usize = SAMPLE_RATE * 600;
const MAX_LINE: u64 = 128 * 1024;

#[derive(Parser)]
struct Arguments {
    #[command(subcommand)]
    command: Command,
}

#[derive(clap::Args)]
struct Model {
    #[arg(long)]
    model: PathBuf,

    // Only CoreML compiles into the cache, so the CPU provider leaves it unused.
    #[arg(long)]
    #[allow(dead_code)]
    cache: Option<PathBuf>,
}

#[derive(Subcommand)]
enum Command {
    Serve {
        #[command(flatten)]
        model: Model,
    },
    Probe {
        #[command(flatten)]
        model: Model,
    },
    Transcribe {
        #[command(flatten)]
        model: Model,

        #[arg(long, default_value = "auto")]
        language: String,
    },
}

#[derive(Deserialize)]
#[serde(
    tag = "type",
    rename_all = "lowercase",
    rename_all_fields = "camelCase"
)]
enum Request {
    Start {
        session_id: String,
        language: String,
    },
    Samples {
        session_id: String,
        audio: String,
    },
    Stop {
        session_id: String,
    },
    Cancel {
        session_id: String,
    },
}

fn load(model: &Model) -> Result<Nemotron> {
    // CPU only: CoreML's compiler crashes the process while loading this model, past any Rust error handling.
    // Try CoreML again once a model or ONNX Runtime update loads under it in `probe` without a crash.
    let handle = NemotronHandle::from_pretrained(
        &model.model,
        Some(ExecutionConfig::new().with_execution_provider(ExecutionProvider::Cpu)),
    )?;
    Ok(Nemotron::from_shared(&handle))
}

fn emit(value: serde_json::Value) -> Result<()> {
    let mut output = std::io::stdout().lock();
    serde_json::to_writer(&mut output, &value)?;
    output.write_all(b"\n")?;
    output.flush()?;
    Ok(())
}

fn fail(session_id: &str, error: anyhow::Error) -> Result<()> {
    emit(json!({"type":"failed", "sessionId":session_id, "message":error.to_string()}))
}

fn samples_from(bytes: &[u8]) -> Result<Vec<f32>> {
    if !bytes.len().is_multiple_of(4) {
        bail!("Audio ends inside a sample");
    }

    let samples: Vec<_> = bytes
        .as_chunks()
        .0
        .iter()
        .map(|chunk| f32::from_le_bytes(*chunk))
        .collect();

    if samples.iter().any(|sample| !sample.is_finite()) {
        bail!("Audio contains a non-finite sample");
    }
    Ok(samples)
}

#[derive(Default)]
struct Run {
    id: String,
    heard: usize,
    pending: Vec<f32>,
    last_text: String,
}

fn feed(model: &mut Nemotron, run: &mut Run, samples: &[f32]) -> Result<()> {
    run.heard += samples.len();

    if run.heard > MAX_SAMPLES {
        bail!("A dictation can last at most ten minutes");
    }

    run.pending.extend_from_slice(samples);
    let chunk_size = model.chunk_samples();
    let whole = run.pending.len() / chunk_size * chunk_size;

    for chunk in run.pending[..whole].chunks_exact(chunk_size) {
        model.transcribe_chunk(chunk)?;
        let text = model.get_transcript();

        if text != run.last_text {
            emit(json!({"type":"transcript", "sessionId":run.id, "text":text, "final":false}))?;
            run.last_text = text;
        }
    }

    run.pending.drain(..whole);

    Ok(())
}

fn finish(model: &mut Nemotron, run: &mut Run) -> Result<()> {
    if run.heard > 0 {
        // The decoder needs a complete chunk and trailing silence to release the final words.
        run.pending.resize(model.chunk_samples(), 0.0);
        model.transcribe_chunk(&run.pending)?;
        run.pending.fill(0.0);
        model.transcribe_chunk(&run.pending)?;
    }

    emit(
        json!({"type":"transcript", "sessionId":run.id, "text":model.get_transcript(), "final":true}),
    )?;
    emit(json!({"type":"ended", "sessionId":run.id}))
}

fn serve(model: &Model) -> Result<()> {
    let mut model = load(model)?;
    let mut run: Option<Run> = None;
    let mut input = std::io::stdin().lock();
    let mut line = String::new();

    loop {
        line.clear();
        let read = input.by_ref().take(MAX_LINE + 1).read_line(&mut line)?;

        if read == 0 {
            break;
        }

        if read as u64 > MAX_LINE {
            bail!("Speech message too large");
        }

        match serde_json::from_str(&line)? {
            Request::Start {
                session_id,
                language,
            } => {
                if run.is_some() {
                    bail!("A dictation is already running");
                }

                // Reset the utterance and replace the previous language prompt.
                model.reset();

                if let Err(error) = model.set_target_lang(&language) {
                    fail(&session_id, error.into())?;
                    continue;
                }

                emit(json!({"type":"ready", "sessionId":session_id}))?;
                run = Some(Run {
                    id: session_id,
                    ..Run::default()
                });
            }
            Request::Samples { session_id, audio } => {
                let Some(active) = run.as_mut().filter(|active| active.id == session_id) else {
                    continue;
                };

                let result = STANDARD
                    .decode(audio)
                    .map_err(anyhow::Error::from)
                    .and_then(|bytes| samples_from(&bytes))
                    .and_then(|samples| feed(&mut model, active, &samples));

                if let Err(error) = result {
                    fail(&session_id, error)?;
                    run = None;
                    model.reset();
                }
            }
            Request::Stop { session_id } => {
                let Some(mut active) = run.take_if(|active| active.id == session_id) else {
                    continue;
                };

                if let Err(error) = finish(&mut model, &mut active) {
                    fail(&session_id, error)?;
                }

                model.reset();
            }
            Request::Cancel { session_id } => {
                if run.take_if(|active| active.id == session_id).is_some() {
                    model.reset();
                    emit(json!({"type":"ended", "sessionId":session_id}))?;
                }
            }
        }
    }

    Ok(())
}

fn main() -> Result<()> {
    match Arguments::parse().command {
        Command::Serve { model } => serve(&model),
        Command::Probe { model } => {
            let model = load(&model)?;
            emit(json!({"present":true, "chunk_samples":model.chunk_samples()}))
        }
        Command::Transcribe { model, language } => {
            let mut model = load(&model)?;
            model.set_target_lang(&language)?;
            let mut run = Run {
                id: "cli".into(),
                ..Run::default()
            };
            let mut bytes = Vec::new();
            std::io::stdin()
                .lock()
                .take((MAX_SAMPLES * 4 + 1) as u64)
                .read_to_end(&mut bytes)?;
            feed(&mut model, &mut run, &samples_from(&bytes)?)?;
            finish(&mut model, &mut run)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_audio_frames() {
        assert_eq!(samples_from(&0.5f32.to_le_bytes()).unwrap(), vec![0.5]);
        assert!(samples_from(&[0, 1, 2]).is_err());
        assert!(samples_from(&f32::NAN.to_le_bytes()).is_err());
    }
    #[test]
    fn session_identity_is_required() {
        assert!(serde_json::from_str::<Request>(r#"{"type":"stop"}"#).is_err());
        assert!(serde_json::from_str::<Request>(r#"{"type":"stop","sessionId":"a"}"#).is_ok());
    }
}
