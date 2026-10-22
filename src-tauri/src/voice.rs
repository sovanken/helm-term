//! Voice input: speech to text on this PC, nothing sent anywhere. The microphone (cpal) feeds a
//! voice detector (Silero VAD) and NVIDIA's Parakeet model (via sherpa-onnx). Each phrase is
//! decoded when you pause; while you speak, the phrase so far is decoded a few times a second
//! for the live preview. The model is downloaded once, on first use.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, SampleFormat, SizedSample};
use serde::Serialize;
use sherpa_onnx::{LinearResampler, OfflineRecognizer, OfflineRecognizerConfig, VadModelConfig, VoiceActivityDetector};
use tauri::{AppHandle, Emitter, Manager};

const MODEL: &str = "sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8";
const MODEL_URL: &str = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8.tar.bz2";
const VAD_URL: &str = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx";
const MODEL_FILES: [&str; 4] = ["encoder.int8.onnx", "decoder.int8.onnx", "joiner.int8.onnx", "tokens.txt"];
/// About what the download is, for the first-use prompt.
pub const DOWNLOAD_MB: u32 = 460;
const RATE: i32 = 16_000;
const WINDOW: usize = 512; // Silero's window, in samples
/// Free the model's memory after this long without use.
const UNLOAD_AFTER: Duration = Duration::from_secs(10 * 60);

pub fn voice_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_local_data_dir().ok().map(|d| d.join("voice"))
}

fn model_dir(dir: &Path) -> PathBuf {
    dir.join(MODEL)
}

pub fn installed(dir: &Path) -> bool {
    MODEL_FILES.iter().all(|f| model_dir(dir).join(f).is_file()) && dir.join("silero_vad.onnx").is_file()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub installed: bool,
    pub installing: bool,
    pub download_mb: u32,
    /// Space the model takes on disk (MB), when installed.
    pub size_mb: u32,
}

fn dir_size(dir: &Path) -> u64 {
    std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| {
            let p = e.path();
            if p.is_dir() {
                dir_size(&p)
            } else {
                e.metadata().map(|m| m.len()).unwrap_or(0)
            }
        })
        .sum()
}

pub fn microphones() -> Vec<String> {
    let host = cpal::default_host();
    host.input_devices().map(|ds| ds.map(|d| d.to_string()).collect()).unwrap_or_default()
}

// ---------- download ----------

#[derive(Default)]
pub struct Install {
    running: AtomicBool,
    cancel: AtomicBool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Progress {
    done: u64,
    total: u64,
    /// "downloading", "unpacking", "done", "error", "cancelled"
    stage: &'static str,
    error: Option<String>,
}

async fn download(app: &AppHandle, url: &str, to: &Path, cancel: &AtomicBool, report: bool) -> Result<(), String> {
    let mut res = reqwest::get(url).await.map_err(|e| format!("Couldn't download the voice model: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("Couldn't download the voice model (server said {}).", res.status()));
    }
    let total = res.content_length().unwrap_or(0);
    let mut file = std::fs::File::create(to).map_err(|e| e.to_string())?;
    let mut done = 0u64;
    let mut last = Instant::now();
    while let Some(chunk) = res.chunk().await.map_err(|e| format!("The download stopped: {e}"))? {
        if cancel.load(Ordering::Relaxed) {
            return Err("cancelled".into());
        }
        std::io::Write::write_all(&mut file, &chunk).map_err(|e| e.to_string())?;
        done += chunk.len() as u64;
        if report && last.elapsed() > Duration::from_millis(200) {
            last = Instant::now();
            let _ = app.emit("voice-install", Progress { done, total, stage: "downloading", error: None });
        }
    }
    Ok(())
}

/// Takes only the files Helm needs out of the model archive.
fn unpack(archive: &Path, dir: &Path) -> Result<(), String> {
    let out = model_dir(dir);
    std::fs::create_dir_all(&out).map_err(|e| e.to_string())?;
    let file = std::fs::File::open(archive).map_err(|e| e.to_string())?;
    let mut tar = tar::Archive::new(bzip2::read::BzDecoder::new(std::io::BufReader::new(file)));
    for entry in tar.entries().map_err(|e| e.to_string())? {
        let mut entry = entry.map_err(|e| e.to_string())?;
        let name = entry.path().ok().and_then(|p| p.file_name().map(|n| n.to_string_lossy().into_owned())).unwrap_or_default();
        if MODEL_FILES.contains(&name.as_str()) {
            entry.unpack(out.join(&name)).map_err(|e| e.to_string())?;
        }
    }
    if !MODEL_FILES.iter().all(|f| out.join(f).is_file()) {
        return Err("The voice model download was incomplete. Try again.".into());
    }
    Ok(())
}

pub async fn install(app: AppHandle, state: Arc<Install>) -> Result<(), String> {
    if state.running.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    state.cancel.store(false, Ordering::SeqCst);
    let result = async {
        let dir = voice_dir(&app).ok_or("No folder for app data")?;
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        if !dir.join("silero_vad.onnx").is_file() {
            let part = dir.join("silero_vad.onnx.part");
            download(&app, VAD_URL, &part, &state.cancel, false).await?;
            std::fs::rename(&part, dir.join("silero_vad.onnx")).map_err(|e| e.to_string())?;
        }
        if !MODEL_FILES.iter().all(|f| model_dir(&dir).join(f).is_file()) {
            let archive = dir.join("model.tar.bz2.part");
            let got = download(&app, MODEL_URL, &archive, &state.cancel, true).await;
            if got.is_err() {
                let _ = std::fs::remove_file(&archive);
            }
            got?;
            let _ = app.emit("voice-install", Progress { done: 0, total: 0, stage: "unpacking", error: None });
            let (a, d) = (archive.clone(), dir.clone());
            let unpacked = tauri::async_runtime::spawn_blocking(move || unpack(&a, &d)).await.map_err(|e| e.to_string())?;
            let _ = std::fs::remove_file(&archive);
            unpacked?;
        }
        Ok::<(), String>(())
    }
    .await;
    state.running.store(false, Ordering::SeqCst);
    let progress = match &result {
        Ok(()) => Progress { done: 0, total: 0, stage: "done", error: None },
        Err(e) if e == "cancelled" => Progress { done: 0, total: 0, stage: "cancelled", error: None },
        Err(e) => Progress { done: 0, total: 0, stage: "error", error: Some(e.clone()) },
    };
    let _ = app.emit("voice-install", progress);
    result.or_else(|e| if e == "cancelled" { Ok(()) } else { Err(e) })
}

pub fn cancel_install(state: &Install) {
    state.cancel.store(true, Ordering::SeqCst);
}

pub fn status(app: &AppHandle, state: &Install) -> Status {
    let dir = voice_dir(app);
    let ok = dir.as_deref().is_some_and(installed);
    Status {
        installed: ok,
        installing: state.running.load(Ordering::SeqCst),
        download_mb: DOWNLOAD_MB,
        size_mb: if ok { (dir_size(dir.as_deref().unwrap()) / 1_048_576) as u32 } else { 0 },
    }
}

pub fn remove(app: &AppHandle, voice: &Voice) -> Result<(), String> {
    voice.send(Cmd::Unload);
    let dir = voice_dir(app).ok_or("No folder for app data")?;
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ---------- listening ----------

enum Cmd {
    Start { mic: Option<String>, test: bool },
    /// Stop and type what's left.
    Stop,
    /// Stop and drop what's left.
    Cancel,
    Unload,
}

/// One worker thread owns the microphone and the model; commands go to it over a channel.
#[derive(Default)]
pub struct Voice {
    tx: Mutex<Option<Sender<Cmd>>>,
}

impl Voice {
    fn send(&self, cmd: Cmd) {
        if let Some(tx) = self.tx.lock().unwrap().as_ref() {
            let _ = tx.send(cmd);
        }
    }

    fn ensure(&self, app: &AppHandle) {
        let mut tx = self.tx.lock().unwrap();
        if tx.is_none() {
            let (s, r) = mpsc::channel();
            let app = app.clone();
            std::thread::Builder::new().name("voice".into()).spawn(move || worker(app, r)).ok();
            *tx = Some(s);
        }
    }
}

pub fn start(app: &AppHandle, voice: &Voice, mic: Option<String>, test: bool) -> Result<(), String> {
    let dir = voice_dir(app).ok_or("No folder for app data")?;
    if !test && !installed(&dir) {
        return Err("not-installed".into());
    }
    voice.ensure(app);
    voice.send(Cmd::Start { mic, test });
    Ok(())
}

pub fn stop(voice: &Voice, keep: bool) {
    voice.send(if keep { Cmd::Stop } else { Cmd::Cancel });
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct VoiceEvent {
    /// "loading", "listening", "partial", "final", "level", "idle", "error"
    kind: &'static str,
    text: Option<String>,
    level: Option<f32>,
}

fn emit(app: &AppHandle, kind: &'static str, text: Option<String>, level: Option<f32>) {
    let _ = app.emit("voice", VoiceEvent { kind, text, level });
}

pub(crate) fn load_recognizer(dir: &Path) -> Option<OfflineRecognizer> {
    let m = model_dir(dir);
    let s = |f: &str| Some(m.join(f).to_string_lossy().into_owned());
    let mut config = OfflineRecognizerConfig::default();
    config.model_config.transducer.encoder = s("encoder.int8.onnx");
    config.model_config.transducer.decoder = s("decoder.int8.onnx");
    config.model_config.transducer.joiner = s("joiner.int8.onnx");
    config.model_config.tokens = s("tokens.txt");
    config.model_config.model_type = Some("nemo_transducer".into());
    config.model_config.num_threads = std::thread::available_parallelism().map(|n| (n.get() / 2).clamp(1, 4) as i32).unwrap_or(2);
    OfflineRecognizer::create(&config)
}

pub(crate) fn create_vad(dir: &Path) -> Option<VoiceActivityDetector> {
    let mut config = VadModelConfig::default();
    config.silero_vad.model = Some(dir.join("silero_vad.onnx").to_string_lossy().into_owned());
    config.silero_vad.threshold = 0.5;
    // Short thinking pauses stay in one phrase.
    config.silero_vad.min_silence_duration = 0.5;
    config.silero_vad.min_speech_duration = 0.25;
    config.silero_vad.max_speech_duration = 12.0;
    config.silero_vad.window_size = WINDOW as i32;
    config.sample_rate = RATE;
    VoiceActivityDetector::create(&config, 60.0)
}

fn input_stream<T>(device: &cpal::Device, config: cpal::StreamConfig, tx: Sender<Vec<f32>>) -> Result<cpal::Stream, cpal::Error>
where
    T: SizedSample + Send + 'static,
    f32: FromSample<T>,
{
    let channels = config.channels.max(1) as usize;
    device.build_input_stream(
        config,
        move |data: &[T], _: &cpal::InputCallbackInfo| {
            let mono: Vec<f32> = data.chunks(channels).map(|f| f.iter().map(|s| s.to_sample::<f32>()).sum::<f32>() / channels as f32).collect();
            let _ = tx.send(mono);
        },
        |_| {},
        None,
    )
}

fn open_mic(name: Option<&str>, tx: Sender<Vec<f32>>) -> Result<(cpal::Stream, i32), String> {
    let host = cpal::default_host();
    let device = name
        .and_then(|n| host.input_devices().ok()?.find(|d| d.to_string() == n))
        .or_else(|| host.default_input_device())
        .ok_or("No microphone found. Plug one in or check Windows' sound settings.")?;
    let supported = device.default_input_config().map_err(|_| "Windows didn't let Helm use the microphone. Check Settings › Privacy › Microphone.".to_string())?;
    let rate = supported.sample_rate() as i32;
    let config = supported.config();
    let stream = match supported.sample_format() {
        SampleFormat::F32 => input_stream::<f32>(&device, config, tx),
        SampleFormat::I16 => input_stream::<i16>(&device, config, tx),
        SampleFormat::U16 => input_stream::<u16>(&device, config, tx),
        SampleFormat::I32 => input_stream::<i32>(&device, config, tx),
        other => return Err(format!("This microphone uses a format Helm can't read ({other:?}).")),
    }
    .map_err(|e| format!("Couldn't open the microphone: {e}"))?;
    stream.play().map_err(|e| format!("Couldn't start the microphone: {e}"))?;
    Ok((stream, rate))
}

pub(crate) fn decode(recognizer: &OfflineRecognizer, samples: &[f32]) -> String {
    let stream = recognizer.create_stream();
    stream.accept_waveform(RATE, samples);
    recognizer.decode(&stream);
    stream.get_result().map(|r| r.text.trim().to_string()).unwrap_or_default()
}

fn worker(app: AppHandle, rx: Receiver<Cmd>) {
    let mut recognizer: Option<OfflineRecognizer> = None;
    loop {
        let cmd = match rx.recv_timeout(UNLOAD_AFTER) {
            Ok(c) => c,
            Err(RecvTimeoutError::Timeout) => {
                recognizer = None;
                continue;
            }
            Err(RecvTimeoutError::Disconnected) => return,
        };
        let (mic, test) = match cmd {
            Cmd::Start { mic, test } => (mic, test),
            Cmd::Unload => {
                recognizer = None;
                continue;
            }
            Cmd::Stop | Cmd::Cancel => continue,
        };
        let Some(dir) = voice_dir(&app) else { continue };
        if !test && recognizer.is_none() {
            emit(&app, "loading", None, None);
            recognizer = load_recognizer(&dir);
            if recognizer.is_none() {
                emit(&app, "error", Some("The voice model couldn't be loaded. Remove it in Settings and download it again.".into()), None);
                emit(&app, "idle", None, None);
                continue;
            }
        }
        if let Err(e) = listen(&app, &rx, &dir, if test { None } else { recognizer.as_ref() }, mic.as_deref()) {
            emit(&app, "error", Some(e), None);
        }
        emit(&app, "idle", None, None);
    }
}

/// One listening session, until Stop or Cancel. With no recognizer it only reports the level
/// (the microphone test in Settings).
fn listen(app: &AppHandle, rx: &Receiver<Cmd>, dir: &Path, recognizer: Option<&OfflineRecognizer>, mic: Option<&str>) -> Result<(), String> {
    let (atx, arx) = mpsc::channel::<Vec<f32>>();
    let (stream, mic_rate) = open_mic(mic, atx)?;
    let resampler = (mic_rate != RATE).then(|| LinearResampler::create(mic_rate, RATE)).flatten();
    let vad = match recognizer {
        Some(_) => Some(create_vad(dir).ok_or("The voice detector couldn't be loaded.")?),
        None => None,
    };
    emit(app, "listening", None, None);

    let mut buffer: Vec<f32> = Vec::new();
    let mut offset = 0usize;
    let mut speaking = false;
    let mut last_partial = Instant::now();
    let mut last_level = Instant::now();
    let mut peak = 0f32;
    let mut keep = true;

    'session: loop {
        // Commands first: Stop or Cancel ends the session.
        loop {
            match rx.try_recv() {
                Ok(Cmd::Stop) => break 'session,
                Ok(Cmd::Cancel) => {
                    keep = false;
                    break 'session;
                }
                Ok(Cmd::Start { .. }) | Ok(Cmd::Unload) => {}
                Err(mpsc::TryRecvError::Empty) => break,
                Err(mpsc::TryRecvError::Disconnected) => return Ok(()),
            }
        }
        let samples = match arx.recv_timeout(Duration::from_millis(50)) {
            Ok(s) => s,
            Err(RecvTimeoutError::Timeout) => continue,
            Err(RecvTimeoutError::Disconnected) => return Err("The microphone stopped.".into()),
        };
        let samples = match &resampler {
            Some(r) => r.resample(&samples, false),
            None => samples,
        };
        peak = samples.iter().fold(peak, |m, s| m.max(s.abs()));
        if last_level.elapsed() > Duration::from_millis(60) {
            emit(app, "level", None, Some(peak.min(1.0)));
            peak = 0.0;
            last_level = Instant::now();
        }
        let (Some(recognizer), Some(vad)) = (recognizer, vad.as_ref()) else { continue };

        buffer.extend_from_slice(&samples);
        while offset + WINDOW <= buffer.len() {
            vad.accept_waveform(&buffer[offset..offset + WINDOW]);
            if !speaking && vad.detected() {
                speaking = true;
                last_partial = Instant::now();
            }
            offset += WINDOW;
        }
        // Before speech, keep just a little audio so the first word isn't cut.
        if !speaking && buffer.len() > 10 * WINDOW {
            let cut = buffer.len() - 10 * WINDOW;
            buffer.drain(..cut);
            offset = offset.saturating_sub(cut);
        }
        // The phrase so far, for the live preview.
        if speaking && last_partial.elapsed() > Duration::from_millis(400) {
            let text = decode(recognizer, &buffer);
            if !text.is_empty() {
                emit(app, "partial", Some(text), None);
            }
            last_partial = Instant::now();
        }
        // Finished phrases.
        let mut finished = false;
        while let Some(segment) = vad.front() {
            vad.pop();
            finished = true;
            let text = decode(recognizer, segment.samples());
            if !text.is_empty() {
                emit(app, "final", Some(text), None);
            }
        }
        if finished {
            buffer.clear();
            offset = 0;
            speaking = false;
        }
    }
    drop(stream);
    if keep {
        if let (Some(recognizer), Some(vad)) = (recognizer, vad.as_ref()) {
            // Whatever was still being said when you stopped.
            vad.flush();
            let mut any = false;
            while let Some(segment) = vad.front() {
                vad.pop();
                any = true;
                let text = decode(recognizer, segment.samples());
                if !text.is_empty() {
                    emit(app, "final", Some(text), None);
                }
            }
            if !any && speaking && buffer.len() > RATE as usize / 4 {
                let text = decode(recognizer, &buffer);
                if !text.is_empty() {
                    emit(app, "final", Some(text), None);
                }
            }
        }
    }
    Ok(())
}
