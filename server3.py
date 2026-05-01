import os
import time
import subprocess
import glob
from datetime import datetime
from flask import Flask, send_from_directory
import threading

QUEUE_DIR = "queue"
HLS_DIR = "hls"
SILENCE_WAV = "silence.wav"
SEGMENT_TIME = 2  # seconds
PLAYLIST_WINDOW = 15
DELETE_DELAY = 2

app = Flask(__name__)

@app.route("/")
def serve_hls_player():
    return send_from_directory('.', 'hls_player.html')

@app.route('/hls/<path:filename>')
def hls_files(filename):
    return send_from_directory('hls', filename)

playlist_path = os.path.join(HLS_DIR, "playlist.m3u8")

def update_playlist(segment_files, media_seq):
    def seg_type(filename):
        return 'silence' if 'silence' in filename else 'audio'
    with open(playlist_path, "w") as f:
        f.write(f"#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:{SEGMENT_TIME}\n")
        f.write(f"#EXT-X-MEDIA-SEQUENCE:{media_seq}\n")
        last_type = None
        for seg in segment_files:
            curr_type = seg_type(os.path.basename(seg))
            if last_type is not None and curr_type != last_type:
                f.write("#EXT-X-DISCONTINUITY\n")
            f.write(f"#EXTINF:{SEGMENT_TIME}.0,\n{os.path.basename(seg)}\n")
            last_type = curr_type

# Helper to segment a WAV file into HLS .ts segments

def segment_wav_to_hls(wav_path, segment_prefix, seq):
    segment_pattern = os.path.join(HLS_DIR, f"{segment_prefix}-%03d.ts")
    cmd = [
        "ffmpeg", "-y", "-i", wav_path,
        "-f", "segment", "-segment_time", str(SEGMENT_TIME),
        "-c:a", "aac", "-b:a", "128k", segment_pattern
    ]
    subprocess.run(cmd, check=True)
    segs = sorted(glob.glob(os.path.join(HLS_DIR, f"{segment_prefix}-*.ts")))
    # Rename segments to sequential seg-<seq>.ts
    renamed = []
    for s in segs:
        new_name = os.path.join(HLS_DIR, f"seg-{seq}.ts")
        os.rename(s, new_name)
        renamed.append(new_name)
        seq += 1
    return renamed, seq

def hls_segmenter_loop():
    segment_files = []
    seq = 0
    delete_queue = []
    while True:
        files = sorted(f for f in os.listdir(QUEUE_DIR) if f.endswith('.wav'))
        if files:
            wav_path = os.path.join(QUEUE_DIR, files[0])
            segs, seq = segment_wav_to_hls(wav_path, "audio", seq)
            segment_files.extend(segs)
            os.remove(wav_path)
            update_playlist(segment_files[-PLAYLIST_WINDOW:], seq - len(segment_files[-PLAYLIST_WINDOW:]))
        else:
            # Always create a new silence segment with a unique sequence number
            silence_ts_name = f"seg-{seq}.ts"
            silence_ts_path = os.path.join(HLS_DIR, silence_ts_name)
            subprocess.run([
                "ffmpeg", "-y", "-i", SILENCE_WAV,
                "-t", str(SEGMENT_TIME),
                "-c:a", "aac", "-b:a", "128k",
                "-f", "mpegts", silence_ts_path
            ], check=True)
            segment_files.append(silence_ts_path)
            update_playlist(segment_files[-PLAYLIST_WINDOW:], seq - len(segment_files[-PLAYLIST_WINDOW:]) + 1)
            seq += 1
        # Delay deletion of old segments
        delete_queue.append(segment_files[-(PLAYLIST_WINDOW+1):-PLAYLIST_WINDOW] if len(segment_files) > PLAYLIST_WINDOW else [])
        if len(delete_queue) > DELETE_DELAY:
            old_segments = delete_queue.pop(0)
            for seg in old_segments:
                if seg and os.path.exists(seg):
                    try:
                        os.remove(seg)
                    except Exception:
                        pass
        segment_files = segment_files[-(PLAYLIST_WINDOW+DELETE_DELAY):]
        time.sleep(SEGMENT_TIME)

threading.Thread(target=hls_segmenter_loop, daemon=True).start()

if __name__ == "__main__":
    print("Server running at http://localhost:5025/")
    app.run(host="0.0.0.0", port=5025, threaded=True)
