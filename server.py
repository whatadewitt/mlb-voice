import os
import time
import shutil
import subprocess
import glob
import threading
from datetime import datetime
from pathlib import Path
from flask import Flask, Response, request, jsonify, send_from_directory

QUEUE_DIR = "queue"
HLS_DIR = "hls"
ADS_DIR = "ads"
PREFIX_DIR = "prefixes"
SILENCE_WAV = "silence.wav"
SEGMENT_TIME = 2
PLAYLIST_WINDOW = 15
DELETE_DELAY = 2

TTS_BACKEND = os.environ.get("TTS_BACKEND", "stub").lower()

Path(QUEUE_DIR).mkdir(exist_ok=True)
Path(HLS_DIR).mkdir(exist_ok=True)
Path(ADS_DIR).mkdir(exist_ok=True)
Path(PREFIX_DIR).mkdir(exist_ok=True)

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

def _load_dia2():
    global _dia2_model
    if _dia2_model is not None:
        return _dia2_model
    from dia2 import Dia2
    _dia2_model = Dia2.from_repo("nari-labs/Dia2-2B", device="cuda", dtype="bfloat16")
    return _dia2_model

def tts_dia2(text: str, voice_set: str, out_path: str) -> None:
    from dia2 import GenerationConfig, SamplingConfig
    model = _load_dia2()
    s1 = os.path.join(PREFIX_DIR, f"{voice_set}_s1.wav")
    s2 = os.path.join(PREFIX_DIR, f"{voice_set}_s2.wav")
    if not (os.path.isfile(s1) and os.path.isfile(s2)):
        raise FileNotFoundError(f"voice prefixes missing for set={voice_set}: {s1}, {s2}")
    config = GenerationConfig(
        cfg_scale=2.0,
        audio=SamplingConfig(temperature=0.8, top_k=50),
        use_cuda_graph=True,
        prefix_speaker_1=s1,
        prefix_speaker_2=s2,
    )
    model.generate(text, config=config, output_wav=out_path, verbose=True)

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
    segment_files, seq, delete_queue = [], 0, []
    while not _shutdown.is_set():
        files = sorted(f for f in os.listdir(QUEUE_DIR) if f.endswith(".wav"))
        if files:
            wav_path = os.path.join(QUEUE_DIR, files[0])
            segs, seq = segment_wav_to_hls(wav_path, seq)
            segment_files.extend(segs)
            os.remove(wav_path)
        else:
            silence_name = f"seg-{seq}_silence.ts"
            silence_path = os.path.join(HLS_DIR, silence_name)
            subprocess.run([
                "ffmpeg", "-y", "-i", SILENCE_WAV, "-t", str(SEGMENT_TIME),
                "-c:a", "aac", "-b:a", "128k", "-f", "mpegts", silence_path,
            ], check=True)
            segment_files.append(silence_path); seq += 1
        update_playlist(segment_files[-PLAYLIST_WINDOW:], max(0, seq - len(segment_files[-PLAYLIST_WINDOW:])))
        delete_queue.append(segment_files[-(PLAYLIST_WINDOW+1):-PLAYLIST_WINDOW] if len(segment_files) > PLAYLIST_WINDOW else [])
        if len(delete_queue) > DELETE_DELAY:
            for seg in delete_queue.pop(0):
                if seg and os.path.exists(seg):
                    try: os.remove(seg)
                    except OSError: pass
        segment_files = segment_files[-(PLAYLIST_WINDOW+DELETE_DELAY):]
        time.sleep(SEGMENT_TIME)

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
    run_tts(text, voice_set, out_path)
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
