import os
import re
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
from dotenv import load_dotenv
from flask import Flask, Response, request, jsonify, send_from_directory

load_dotenv()

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

QUEUE_DIR = "queue"
HLS_DIR = "hls"
ADS_DIR = "ads"
PREFIX_DIR = "prefixes"
LOG_DIR = "logs"
WAVS_DIR = os.path.join(LOG_DIR, "wavs")
SEGMENT_TIME = 2
PLAYLIST_WINDOW = 15
DELETE_DELAY = 2

TTS_BACKEND = os.environ.get("TTS_BACKEND", "elevenlabs").lower()

Path(QUEUE_DIR).mkdir(exist_ok=True)
Path(HLS_DIR).mkdir(exist_ok=True)
Path(ADS_DIR).mkdir(exist_ok=True)
Path(PREFIX_DIR).mkdir(exist_ok=True)
Path(LOG_DIR).mkdir(exist_ok=True)
Path(WAVS_DIR).mkdir(parents=True, exist_ok=True)

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
    """Pipeline-only test backend: writes 1s of silence at 24kHz mono."""
    with wave.open(out_path, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(24000)
        wf.writeframes(b"\x00" * (24000 * 2))

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
DIA2_SEED = 424242
DIA2_MIN_PREFIX_SECONDS = 2.0

def _torch_compile_supported() -> bool:
    """torch.compile on CUDA needs Triton. Windows ships a broken stub; Linux/RunPod has it."""
    import torch
    if not torch.cuda.is_available():
        return False
    try:
        import triton
    except ImportError:
        return False
    return hasattr(triton, "__version__") and hasattr(triton, "Config")

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
        use_torch_compile=_torch_compile_supported(),
    )
    if use_prefix:
        cfg_kwargs["prefix_speaker_1"] = s1
        cfg_kwargs["prefix_speaker_2"] = s2
    log.info(f"tts_dia2 voice_set={voice_set} use_prefix={use_prefix} seed={DIA2_SEED}")
    model.generate(text, config=GenerationConfig(**cfg_kwargs), output_wav=out_path, verbose=True)

def _warmup_dia2() -> None:
    """Preload Mimi codec + (on Linux) trigger torch.compile autotune before serving.
    Skips CUDA graph capture: capturing during warmup leaks cuBLAS state that breaks
    the next real call with CUBLAS_STATUS_NOT_INITIALIZED."""
    import tempfile, torch
    from dia2 import GenerationConfig, SamplingConfig
    tmp_wav = os.path.join(tempfile.gettempdir(), "dia2_warmup.wav")
    tc_supported = _torch_compile_supported()
    log.info(f"dia2 warmup starting (torch.compile={'enabled' if tc_supported else 'disabled (no Triton)'})")
    t0 = time.time()
    try:
        model = _load_dia2()
        torch.manual_seed(DIA2_SEED)
        model.generate(
            "[S1] Warm up. [S2] Ready.",
            config=GenerationConfig(
                cfg_scale=2.0,
                audio=SamplingConfig(temperature=0.8, top_k=50),
                use_cuda_graph=False,
                use_torch_compile=tc_supported,
            ),
            output_wav=tmp_wav,
            verbose=True,
        )
        # Force bf16 cuBLAS handle init so the first real /generate's graph capture works.
        if torch.cuda.is_available():
            tmp = torch.empty((2, 2), device="cuda", dtype=torch.bfloat16)
            torch.matmul(tmp, tmp)
            torch.cuda.synchronize()
        log.info(f"dia2 warmup complete elapsed={time.time()-t0:.1f}s")
    except Exception:
        log.exception("dia2 warmup failed (server will continue; first /generate will be slow)")
    finally:
        try: os.remove(tmp_wav)
        except OSError: pass

ELEVEN_API_BASE = "https://api.elevenlabs.io/v1"
ELEVEN_MODEL = os.environ.get("ELEVEN_LABS_MODEL", "eleven_flash_v2_5")
ELEVEN_SAMPLE_RATE = 24000
ELEVEN_DEFAULT_S1 = "Jerry B. - Classic Radio DJ & Energetic"
ELEVEN_DEFAULT_S2 = "Marty B"
ELEVEN_VOICE_REQUEST = {
    "broadcaster": {
        "S1": os.environ.get("ELEVEN_LABS_VOICE_S1", ELEVEN_DEFAULT_S1),
        "S2": os.environ.get("ELEVEN_LABS_VOICE_S2", ELEVEN_DEFAULT_S2),
    },
    "ad_announcer": {
        "S1": os.environ.get("ELEVEN_LABS_VOICE_AD_S1", os.environ.get("ELEVEN_LABS_VOICE_S1", ELEVEN_DEFAULT_S1)),
        "S2": os.environ.get("ELEVEN_LABS_VOICE_AD_S2", os.environ.get("ELEVEN_LABS_VOICE_S2", ELEVEN_DEFAULT_S2)),
    },
}
_eleven_voice_id_cache: dict[str, str] = {}
_eleven_voice_lock = threading.Lock()

_SPEAKER_RE = re.compile(r"\[S([12])\]\s*([^\[]*)", re.DOTALL)

def _split_script_by_speaker(text: str) -> list[tuple[str, str]]:
    """Split a script like '[S1] foo [S2] bar [S1]' into [('S1','foo'),('S2','bar')].
    Empty trailing handoff tag (e.g. ' [S1]' at end) is dropped."""
    out = []
    for m in _SPEAKER_RE.finditer(text):
        line = m.group(2).strip()
        if line:
            out.append((f"S{m.group(1)}", line))
    return out

def _looks_like_voice_id(s: str) -> bool:
    """ElevenLabs voice IDs are 20-char alphanumeric. Names usually contain a space."""
    return bool(re.fullmatch(r"[A-Za-z0-9]{18,32}", s or ""))

def _resolve_elevenlabs_voice_id(name_or_id: str, api_key: str) -> str:
    """Resolve a configured value (name or id) to a voice_id. Cached per process."""
    with _eleven_voice_lock:
        cached = _eleven_voice_id_cache.get(name_or_id)
        if cached:
            return cached
        if _looks_like_voice_id(name_or_id):
            _eleven_voice_id_cache[name_or_id] = name_or_id
            return name_or_id
        import requests
        # next_page_token paginates; we walk it because some accounts have many.
        token = None
        target = name_or_id.strip().lower()
        while True:
            params = {"page_size": 100}
            if token: params["next_page_token"] = token
            r = requests.get(f"{ELEVEN_API_BASE}/voices", headers={"xi-api-key": api_key},
                             params=params, timeout=15)
            r.raise_for_status()
            data = r.json()
            for v in data.get("voices", []):
                if (v.get("name") or "").strip().lower() == target:
                    vid = v["voice_id"]
                    _eleven_voice_id_cache[name_or_id] = vid
                    log.info(f"elevenlabs resolved voice name={name_or_id!r} -> id={vid}")
                    return vid
            token = data.get("next_page_token")
            if not token: break
        raise RuntimeError(f"elevenlabs voice not found: {name_or_id!r}")

def _eleven_tts_pcm(voice_id: str, text: str, api_key: str) -> bytes:
    """Hit ElevenLabs streaming TTS, request raw PCM at 24kHz, return bytes."""
    import requests
    url = f"{ELEVEN_API_BASE}/text-to-speech/{voice_id}/stream"
    r = requests.post(
        url,
        headers={"xi-api-key": api_key, "Content-Type": "application/json", "accept": "audio/pcm"},
        params={"output_format": f"pcm_{ELEVEN_SAMPLE_RATE}"},
        json={"text": text, "model_id": ELEVEN_MODEL},
        timeout=60,
    )
    if not r.ok:
        raise RuntimeError(f"elevenlabs TTS failed {r.status_code}: {r.text[:300]}")
    return r.content

def tts_elevenlabs(text: str, voice_set: str, out_path: str) -> None:
    """Parse [S1]/[S2] script, fetch PCM per line from ElevenLabs with the right
    voice, concatenate (with a short silence between lines) into a 24kHz mono WAV."""
    api_key = os.environ.get("ELEVEN_LABS_API_KEY")
    if not api_key:
        raise RuntimeError("ELEVEN_LABS_API_KEY not set")
    voice_map = ELEVEN_VOICE_REQUEST.get(voice_set) or ELEVEN_VOICE_REQUEST["broadcaster"]
    lines = _split_script_by_speaker(text)
    if not lines:
        # No speaker tags — treat the whole text as a single S1 line.
        lines = [("S1", text.strip())]
    # 120ms silence between lines for natural cadence (2 bytes * 24000 hz * 0.12s = 5760 bytes).
    gap = b"\x00" * int(ELEVEN_SAMPLE_RATE * 0.12) * 2
    pcm_chunks: list[bytes] = []
    for i, (speaker, line) in enumerate(lines):
        voice_name = voice_map.get(speaker) or voice_map["S1"]
        vid = _resolve_elevenlabs_voice_id(voice_name, api_key)
        pcm = _eleven_tts_pcm(vid, line, api_key)
        if i > 0:
            pcm_chunks.append(gap)
        pcm_chunks.append(pcm)
    audio = b"".join(pcm_chunks)
    with wave.open(out_path, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)  # 16-bit
        wf.setframerate(ELEVEN_SAMPLE_RATE)
        wf.writeframes(audio)
    log.info(f"tts_elevenlabs voice_set={voice_set} lines={len(lines)} bytes={len(audio)}")

def _warmup_elevenlabs() -> None:
    """Pre-resolve voice IDs so the first /generate doesn't pay the lookup cost."""
    api_key = os.environ.get("ELEVEN_LABS_API_KEY")
    if not api_key:
        log.warning("elevenlabs warmup skipped: ELEVEN_LABS_API_KEY not set")
        return
    t0 = time.time()
    try:
        for vset, vmap in ELEVEN_VOICE_REQUEST.items():
            for spk, name in vmap.items():
                _resolve_elevenlabs_voice_id(name, api_key)
        log.info(f"elevenlabs warmup complete elapsed={time.time()-t0:.2f}s model={ELEVEN_MODEL}")
    except Exception:
        log.exception("elevenlabs warmup failed (server will continue; first /generate will surface the error)")

TTS_BACKENDS = {"stub": tts_stub, "openai": tts_openai, "dia2": tts_dia2, "elevenlabs": tts_elevenlabs}

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
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", wav_path,
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
                    archive_path = os.path.join(WAVS_DIR, os.path.basename(wav_path))
                    shutil.move(wav_path, archive_path)
                    log.info(f"segmenter wav_archived path={archive_path}")
            if pending_audio:
                segment_files.append(pending_audio.pop(0))
            else:
                silence_name = f"seg-{seq}_silence.ts"
                silence_path = os.path.join(HLS_DIR, silence_name)
                subprocess.run([
                    "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
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
    return send_from_directory("web", "index.html")

@app.route("/web/<path:filename>")
def web_files(filename):
    return send_from_directory("web", filename)

@app.route("/hls/<path:filename>")
def hls_files(filename):
    return send_from_directory("hls", filename)

# ---------- SSE live game state ----------
# Pipeline POSTs each enriched play to /state. /events streams those snapshots
# (plus a heartbeat every SSE_HEARTBEAT_SECS) to any connected frontend so the
# count/diamond can update without polling.
import json as _json

SSE_HEARTBEAT_SECS = 15
_state_lock = threading.Lock()
_state_cond = threading.Condition(_state_lock)
_last_state: dict = {}
_state_version = 0  # bumped on every /state update so SSE generators wake up

@app.route("/state", methods=["POST"])
def post_state():
    global _last_state, _state_version
    body = request.get_json(force=True, silent=True) or {}
    with _state_cond:
        _last_state = body
        _state_version += 1
        _state_cond.notify_all()
    return jsonify({"ok": True, "version": _state_version})

@app.route("/events")
def events():
    def stream():
        seen = -1
        # Emit whatever we know right now so a late-connecting client doesn't
        # see a stale placeholder.
        with _state_cond:
            if _last_state:
                yield f"data: {_json.dumps(_last_state)}\n\n"
                seen = _state_version
        while True:
            with _state_cond:
                # Wait up to heartbeat interval for a new state, then fall
                # through and send a comment-line heartbeat to keep the
                # connection alive through proxies.
                _state_cond.wait_for(lambda: _state_version != seen, timeout=SSE_HEARTBEAT_SECS)
                if _state_version != seen:
                    payload = _json.dumps(_last_state)
                    seen = _state_version
                else:
                    payload = None
            if payload is not None:
                yield f"data: {payload}\n\n"
            else:
                yield ": heartbeat\n\n"
    headers = {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",  # disable buffering on nginx-style proxies
    }
    return Response(stream(), headers=headers)

@app.route("/health")
def health():
    files = [f for f in os.listdir(QUEUE_DIR) if f.endswith(".wav")]
    return jsonify({
        "backend": TTS_BACKEND,
        "queue_depth": len(files),
        "hls_running": hls_thread is not None and hls_thread.is_alive(),
        "state_version": _state_version,
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

def _mlbam_to_fangraphs(mlbam_id):
    """Cross-walk MLBAM player ID to Fangraphs ID via pybaseball lookup table.
    Returns int Fangraphs ID, or None if no mapping exists."""
    import math
    from pybaseball import playerid_reverse_lookup
    df = playerid_reverse_lookup([int(mlbam_id)], key_type="mlbam")
    if not len(df):
        return None
    fg = df.iloc[0].get("key_fangraphs")
    if fg is None or (isinstance(fg, float) and math.isnan(fg)):
        return None
    return int(fg)

@app.route("/statcast", methods=["POST"])
def statcast():
    body = request.get_json(force=True) or {}
    kind = body.get("kind")
    params = body.get("params", {})
    try:
        if kind in ("batter_season", "pitcher_season"):
            year = params.get("year")
            mlbam_id = params.get("mlbam_id")
            fg_id = _mlbam_to_fangraphs(mlbam_id)
            if fg_id is None:
                return jsonify({"ok": True, "data": {}})
            if kind == "batter_season":
                from pybaseball import batting_stats
                df = batting_stats(year, year, qual=1)
            else:
                from pybaseball import pitching_stats
                df = pitching_stats(year, year, qual=1)
            sub = df[df["IDfg"] == fg_id] if "IDfg" in df else df.iloc[0:0]
            row = sub.iloc[0].to_dict() if len(sub) else {}
            return jsonify({"ok": True, "data": _scrub(row)})
        return jsonify({"ok": False, "error": f"unknown kind: {kind}"}), 400
    except Exception as e:
        log.warning(f"/statcast failed kind={kind} params={params} reason={e}")
        return jsonify({"ok": False, "error": str(e)}), 500

def _scrub(d):
    """Drop pandas NaNs and unsupported types for JSON."""
    import math
    out = {}
    for k, v in d.items():
        if isinstance(v, float) and math.isnan(v): continue
        if hasattr(v, "item"): v = v.item()
        try:
            import json; json.dumps(v); out[k] = v
        except (TypeError, ValueError):
            out[k] = str(v)
    return out

if __name__ == "__main__":
    print(f"TTS backend: {TTS_BACKEND}")
    if TTS_BACKEND == "dia2":
        print("⏳ Loading Dia2-2B (one-time)...")
        _load_dia2()
        print("✅ Dia2 ready.")
        print("⏳ Warming up (torch.compile autotune; 30-90s on first run)...")
        _warmup_dia2()
        print("✅ Warmup complete.")
    elif TTS_BACKEND == "elevenlabs":
        print("⏳ Resolving ElevenLabs voice IDs...")
        _warmup_elevenlabs()
        print("✅ ElevenLabs ready.")
    app.run(host="0.0.0.0", port=5025, threaded=True, debug=False)
