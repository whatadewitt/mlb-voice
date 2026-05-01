import os
import time
import io
import subprocess
import glob
from datetime import datetime
from flask import Flask, Response, stream_with_context, send_from_directory
from pydub import AudioSegment

SILENCE_PATH = "silence.mp3"
QUEUE_DIR = "queue"
HLS_DIR = "hls"
SEGMENT_TIME = 2  # seconds
PLAYLIST_WINDOW = 15  # Increased window for better buffering
DELETE_DELAY = 2     # Delay (in segment windows) before deleting old segments

app = Flask(__name__)
silence_clip = AudioSegment.from_mp3(SILENCE_PATH)

def generate_audio():
    while True:
        next_audio_path = get_next_audio_file()
        if next_audio_path:
            print(f"Streaming: {next_audio_path}")
            clip = AudioSegment.from_mp3(next_audio_path)
            os.remove(next_audio_path)
        else:
            clip = silence_clip

        # Stream this clip in MP3 chunks
        mp3_data = io.BytesIO()
        clip.export(mp3_data, format="mp3", bitrate="128k")
        yield mp3_data.getvalue()
        time.sleep(1)  # Ensure we don't spin too fast

def get_next_audio_file():
    files = sorted(f for f in os.listdir(QUEUE_DIR) if f.endswith('.mp3'))
    return os.path.join(QUEUE_DIR, files[0]) if files else None

# Helper to segment an MP3 file into HLS .ts segments
def segment_mp3_to_hls(mp3_path, segment_prefix):
    timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
    segment_pattern = os.path.join(HLS_DIR, f"{segment_prefix}-%03d.ts")
    cmd = [
        "ffmpeg", "-y", "-i", mp3_path,
        "-f", "segment", "-segment_time", str(SEGMENT_TIME),
        "-c", "copy", segment_pattern
    ]
    subprocess.run(cmd, check=True)
    # Return list of new segment filenames
    return sorted(glob.glob(os.path.join(HLS_DIR, f"{segment_prefix}-*.ts")))

# Helper to update the playlist
playlist_path = os.path.join(HLS_DIR, "playlist.m3u8")
def update_playlist(segment_files, media_seq):
    # Track type of each segment (audio or silence) for discontinuity
    def seg_type(filename):
        return 'silence' if 'silence' in filename else 'audio'
    with open(playlist_path, "w") as f:
        f.write("#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:{}\n".format(SEGMENT_TIME))
        f.write(f"#EXT-X-MEDIA-SEQUENCE:{media_seq}\n")
        last_type = None
        for seg in segment_files:
            curr_type = seg_type(os.path.basename(seg))
            if last_type is not None and curr_type != last_type:
                f.write("#EXT-X-DISCONTINUITY\n")
            f.write(f"#EXTINF:{SEGMENT_TIME}.0,\n{os.path.basename(seg)}\n")
            last_type = curr_type
        # Do not end the playlist (no #EXT-X-ENDLIST) for live

# Main HLS update loop
import threading

def hls_segmenter_loop():
    processed = set()
    segment_files = []
    seq = 0  # Sequence number for HLS segments
    delete_queue = []  # Track segments to delete after a delay
    while True:
        files = sorted(f for f in os.listdir(QUEUE_DIR) if f.endswith('.mp3'))
        if files:
            mp3_path = os.path.join(QUEUE_DIR, files[0])
            segs = []
            # Segment the mp3 and assign sequence numbers
            temp_segs = segment_mp3_to_hls(mp3_path, f"audio")
            for s in temp_segs:
                new_name = os.path.join(HLS_DIR, f"seg-{seq}.ts")
                os.rename(s, new_name)
                segs.append(new_name)
                seq += 1
            segment_files.extend(segs)
            os.remove(mp3_path)
            update_playlist(segment_files[-PLAYLIST_WINDOW:], seq - len(segment_files[-PLAYLIST_WINDOW:]))
        else:
            # Always create a new silence segment with a unique sequence number
            silence_ts_name = f"seg-{seq}.ts"
            silence_ts_path = os.path.join(HLS_DIR, silence_ts_name)
            subprocess.run([
                "ffmpeg", "-y", "-i", SILENCE_PATH,
                "-f", "mpegts", "-c", "copy", silence_ts_path
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

# Start the HLS segmenter in a background thread
threading.Thread(target=hls_segmenter_loop, daemon=True).start()

@app.route("/")
def serve_hls_player():
    return send_from_directory('.', 'hls_player.html')

@app.route("/stream.mp3")
def stream():
    return Response(
        stream_with_context(generate_audio()),
        mimetype="audio/mpeg"
    )

@app.route('/hls/<path:filename>')
def hls_files(filename):
    return send_from_directory('hls', filename)

if __name__ == "__main__":
    print("Server running at http://localhost:5025/")
    app.run(host="0.0.0.0", port=5025, threaded=True)


# use append mpde that doens't use the "sequence" mode
# look up MSE and use the one that doesn't use the "append" mode
# duration of player wont be right


# segments should be marked as independent or not independent
# is ffmeg resetting things back to zero? (pts and dts)

## aac will prevent me from having to re-encode the audio
