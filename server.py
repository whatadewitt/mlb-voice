import os
import sys
import time
import shutil
import subprocess
import glob
import logging
import threading
import wave
from datetime import datetime
from pathlib import Path
from flask import Flask, Response, request, jsonify, send_from_directory

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

QUEUE_DIR = "queue"
HLS_DIR = "hls"
ADS_DIR = "ads"
PREFIX_DIR = "prefixes"
LOG_DIR = "logs"
SEGMENT_TIME = 2
PLAYLIST_WINDOW = 15
DELETE_DELAY = 2

TTS_BACKEND = os.environ.get("TTS_BACKEND", "dia2").lower()

Path(QUEUE_DIR).mkdir(exist_ok=True)
Path(HLS_DIR).mkdir(exist_ok=True)
Path(ADS_DIR).mkdir(exist_ok=True)
Path(PREFIX_DIR).mkdir(exist_ok=True)
Path(LOG_DIR).mkdir(exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(os.path.join(LOG_DIR, "server.log")),
        logging.StreamHandler(),
    ],
)
log = logging.getLogger("server")

def _wav_seconds(path):
    try:
        with wave.open(path, "rb") as w:
            return w.getnframes() / float(w.getframerate())
    except Exception:
        return -1.0

def _ts_seconds(path):
    try:
        out = subprocess.check_output(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", path],
            timeout=5,
        ).decode().strip()
        return float(out)
    except Exception:
        return -1.0

app = Flask(__name__)
hls_thread = None
playlist_path = os.path.join(HLS_DIR, "playlist.m3u8")

# ---------- TTS backends ----------

def tts_stub(text: str, voice_set: str, out_path: str) -> None:
    """Pipeline-only test backend: copies silence.wav to out_path."""
    shutil.copyfile(SILENCE_WAV, out_path)

def tts_openai(text: str, voice_set: str, out_path: str) -> None:
    from openai import OpenAI
    client = OpenAI()
    voice = "onyx" if voice_set == "broadcaster" else "alloy"
    stripped = text.replace("[S1]", "").replace("[S2]", "").strip()
    with client.audio.speech.with_streaming_response.create(
        model="gpt-4o-mini-tts", voice=voice, input=stripped, response_format="wav"
    ) as resp:
        resp.stream_to_file(out_path)

_dia2_model = None
_dia2_lock = threading.Lock()
DIA2_SEED = 0
DIA2_MIN_PREFIX_SECONDS = 2.0

def _dia2_device_dtype():
    import torch
    if torch.cuda.is_available():
        return "cuda", "bfloat16"
    if torch.backends.mps.is_available():
        return "mps", "float32"
    return "cpu", "float32"

def _load_dia2():
    global _dia2_model
    if _dia2_model is not None:
        return _dia2_model
    with _dia2_lock:
        if _dia2_model is None:
            from dia2 import Dia2
            device, dtype = _dia2_device_dtype()
            log.info(f"loading Dia2-2B device={device} dtype={dtype}")
            _dia2_model = Dia2.from_repo("nari-labs/Dia2-2B", device=device, dtype=dtype)
    return _dia2_model

def tts_dia2(text: str, voice_set: str, out_path: str) -> None:
    from dia2 import GenerationConfig, SamplingConfig
    import torch
    s1 = os.path.join(PREFIX_DIR, f"{voice_set}_s1.wav")
    s2 = os.path.join(PREFIX_DIR, f"{voice_set}_s2.wav")
    use_prefix = (
        os.path.isfile(s1) and os.path.isfile(s2)
        and _wav_seconds(s1) >= DIA2_MIN_PREFIX_SECONDS
        and _wav_seconds(s2) >= DIA2_MIN_PREFIX_SECONDS
    )
    model = _load_dia2()
    torch.manual_seed(DIA2_SEED)
    cfg_kwargs = dict(
        cfg_scale=2.0,
        audio=SamplingConfig(temperature=0.8, top_k=50),
        use_cuda_graph=torch.cuda.is_available(),
    )
    if use_prefix:
        cfg_kwargs["prefix_speaker_1"] = s1
        cfg_kwargs["prefix_speaker_2"] = s2
    log.info(f"tts_dia2 voice_set={voice_set} use_prefix={use_prefix} seed={DIA2_SEED}")
    model.generate(text, config=GenerationConfig(**cfg_kwargs), output_wav=out_path, verbose=True)

TTS_BACKENDS = {"stub": tts_stub, "openai": tts_openai, "dia2": tts_dia2}

def run_tts(text: str, voice_set: str, out_path: str) -> None:
    fn = TTS_BACKENDS.get(TTS_BACKEND)
    if not fn:
        raise ValueError(f"Unknown TTS_BACKEND={TTS_BACKEND}")
    fn(text, voice_set, out_path)

# ---------- HLS segmenter ----------

def update_playlist(segment_files, media_seq):
    def seg_type(fn): return "silence" if "_silence" in fn else "audio"
    with open(playlist_path, "w") as f:
        f.write(f"#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:{SEGMENT_TIME}\n")
        f.write(f"#EXT-X-MEDIA-SEQUENCE:{media_seq}\n")
        last_type = None
        for seg in segment_files:
            curr = seg_type(os.path.basename(seg))
            if last_type is not None and curr != last_type:
                f.write("#EXT-X-DISCONTINUITY\n")
            f.write(f"#EXTINF:{SEGMENT_TIME}.0,\n{os.path.basename(seg)}\n")
            last_type = curr

def segment_wav_to_hls(wav_path, seq):
    pattern = os.path.join(HLS_DIR, f"audio-%03d.ts")
    subprocess.run([
        "ffmpeg", "-y", "-i", wav_path,
        "-f", "segment", "-segment_time", str(SEGMENT_TIME),
        "-c:a", "aac", "-b:a", "128k", pattern,
    ], check=True)
    segs = sorted(glob.glob(os.path.join(HLS_DIR, "audio-*.ts")))
    renamed = []
    for s in segs:
        new = os.path.join(HLS_DIR, f"seg-{seq}.ts")
        os.rename(s, new); renamed.append(new); seq += 1
    return renamed, seq

_shutdown = threading.Event()

def hls_segmenter_loop():
    log.info("segmenter started")
    for f in glob.glob(os.path.join(HLS_DIR, "*.ts")):
        try: os.remove(f)
        except OSError: pass
    if os.path.exists(playlist_path):
        try: os.remove(playlist_path)
        except OSError: pass
    segment_files, seq, delete_queue = [], 0, []
    pending_audio = []
    n_exposed = 0
    while not _shutdown.is_set():
        try:
            if not pending_audio:
                files = sorted(f for f in os.listdir(QUEUE_DIR) if f.endswith(".wav"))
                if files:
                    wav_path = os.path.join(QUEUE_DIR, files[0])
                    wav_size = os.path.getsize(wav_path)
                    wav_dur = _wav_seconds(wav_path)
                    log.info(f"segmenter wav_in path={wav_path} bytes={wav_size} dur={wav_dur:.2f}s")
                    segs, seq = segment_wav_to_hls(wav_path, seq)
                    seg_durs = [_ts_seconds(s) for s in segs]
                    log.info(f"segmenter wav_segged count={len(segs)} total_dur={sum(seg_durs):.2f}s seg_durs={[round(d,2) for d in seg_durs]}")
                    pending_audio.extend(segs)
                    os.remove(wav_path)
            if pending_audio:
                segment_files.append(pending_audio.pop(0))
            else:
                silence_name = f"seg-{seq}_silence.ts"
                silence_path = os.path.join(HLS_DIR, silence_name)
                subprocess.run([
                    "ffmpeg", "-y",
                    "-f", "lavfi", "-i", "anullsrc=channel_layout=mono:sample_rate=24000",
                    "-t", str(SEGMENT_TIME),
                    "-c:a", "aac", "-b:a", "128k", "-f", "mpegts", silence_path,
                ], check=True)
                segment_files.append(silence_path); seq += 1
            n_exposed += 1
            update_playlist(segment_files[-PLAYLIST_WINDOW:], max(0, n_exposed - len(segment_files[-PLAYLIST_WINDOW:])))
            delete_queue.append(segment_files[-(PLAYLIST_WINDOW+1):-PLAYLIST_WINDOW] if len(segment_files) > PLAYLIST_WINDOW else [])
            if len(delete_queue) > DELETE_DELAY:
                for seg in delete_queue.pop(0):
                    if seg and os.path.exists(seg):
                        try: os.remove(seg)
                        except OSError: pass
            segment_files = segment_files[-(PLAYLIST_WINDOW+DELETE_DELAY):]
            time.sleep(SEGMENT_TIME)
        except Exception:
            log.exception("segmenter iter failed")
            time.sleep(1)

# ---------- Routes ----------

@app.route("/")
def root():
    return send_from_directory(".", "hls_player.html")

@app.route("/hls/<path:filename>")
def hls_files(filename):
    return send_from_directory("hls", filename)

@app.route("/health")
def health():
    files = [f for f in os.listdir(QUEUE_DIR) if f.endswith(".wav")]
    return jsonify({
        "backend": TTS_BACKEND,
        "queue_depth": len(files),
        "hls_running": hls_thread is not None and hls_thread.is_alive(),
    })

@app.route("/start_hls", methods=["POST"])
def start_hls():
    global hls_thread
    if hls_thread is None or not hls_thread.is_alive():
        hls_thread = threading.Thread(target=hls_segmenter_loop, daemon=True)
        hls_thread.start()
        return jsonify({"status": "started"})
    return jsonify({"status": "already_running"})

@app.route("/generate", methods=["POST"])
def generate():
    body = request.get_json(force=True) or {}
    text = body.get("text", "").strip()
    voice_set = body.get("voice_set", "broadcaster")
    if not text:
        return jsonify({"error": "no text"}), 400
    if hls_thread is None or not hls_thread.is_alive():
        return jsonify({"error": "hls not running"}), 500
    ts = datetime.now().strftime("%Y%m%d%H%M%S%f")
    out_path = os.path.join(QUEUE_DIR, f"play-{ts}.wav")
    tmp_path = out_path + ".part"
    log.info(f"/generate begin text_len={len(text)} voice={voice_set} backend={TTS_BACKEND}")
    t0 = time.time()
    try:
        run_tts(text, voice_set, tmp_path)
    except Exception:
        log.exception("/generate run_tts failed")
        try: os.remove(tmp_path)
        except OSError: pass
        return jsonify({"error": "tts_failed"}), 500
    os.rename(tmp_path, out_path)
    size = os.path.getsize(out_path)
    dur = _wav_seconds(out_path)
    log.info(f"/generate ok wav={out_path} bytes={size} dur={dur:.2f}s elapsed={time.time()-t0:.2f}s")
    return jsonify({"status": "queued", "file": out_path})

@app.route("/enqueue_ad", methods=["POST"])
def enqueue_ad():
    body = request.get_json(force=True) or {}
    filename = body.get("filename", "")
    src = os.path.join(ADS_DIR, filename)
    if not os.path.isfile(src):
        return jsonify({"error": f"ad not found: {filename}"}), 404
    ts = datetime.now().strftime("%Y%m%d%H%M%S%f")
    dst = os.path.join(QUEUE_DIR, f"ad-{ts}.wav")
    shutil.copyfile(src, dst)
    return jsonify({"status": "queued", "file": dst})

@app.route("/statcast", methods=["POST"])
def statcast():
    # Stub. Real implementation lands in Task 18.
    return jsonify({"error": "not_implemented"}), 501

if __name__ == "__main__":
    print(f"TTS backend: {TTS_BACKEND}")
    if TTS_BACKEND == "dia2":
        print("⏳ Loading Dia2-2B (one-time)...")
        _load_dia2()
        print("✅ Dia2 ready.")
    app.run(host="0.0.0.0", port=5025, threaded=True, debug=False)
