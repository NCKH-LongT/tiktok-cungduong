"""Private, CPU-only Vietnamese TTS endpoint. Audio never touches disk."""

import io
import json
import os
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import soundfile as sf
from korvatts import TTS


model = None
model_lock = threading.Lock()


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != "/health":
            self.send_error(404)
            return
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"ok")

    def do_POST(self):
        if self.path != "/synthesize":
            self.send_error(404)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length < 1 or length > 4096:
                self.send_error(413)
                return
            request = json.loads(self.rfile.read(length))
            text = request.get("text")
            if not isinstance(text, str) or not text.strip() or len(text) > 1000:
                self.send_error(400, "Text must contain 1-1000 characters")
                return
            speed = request.get("speed", 1)
            if not isinstance(speed, (int, float)) or not 0.5 <= speed <= 2:
                self.send_error(400, "Invalid speaking rate")
                return
            voice = request.get("voice", os.getenv("LOCAL_TTS_VOICE", "ngoc_huyen"))
            with model_lock:
                engine = get_model_unlocked()
                if not isinstance(voice, str) or voice not in engine.list_voices():
                    self.send_error(400, "Invalid local voice")
                    return
                wav, _ = engine.synthesize(
                    text, voice=voice,
                    lang="vi", total_steps=16, speed=float(speed),
                )
            output = io.BytesIO()
            sf.write(output, wav, engine.sample_rate, format="WAV")
            encoded = subprocess.run(
                ["lame", "--silent", "-b", "64", "-", "-"],
                input=output.getvalue(), capture_output=True, check=True, timeout=30,
            ).stdout
            if not encoded:
                raise RuntimeError("Local TTS encoded empty audio")
            self.send_response(200)
            self.send_header("Content-Type", "audio/mpeg")
            self.send_header("Content-Length", str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)
        except Exception as error:
            print(f"Local TTS failed: {error}", flush=True)
            self.send_error(503, "Local TTS unavailable")


def get_model_unlocked():
    global model
    if model is None:
        model = TTS(device="cpu", num_threads=int(os.getenv("LOCAL_TTS_THREADS", "2")))
    return model


def warm_model():
    try:
        with model_lock:
            get_model_unlocked()
        print("Local Vietnamese TTS model ready", flush=True)
    except Exception as error:
        print(f"Local TTS model warmup failed: {error}", flush=True)


if __name__ == "__main__":
    threading.Thread(target=warm_model, daemon=True).start()
    ThreadingHTTPServer(("0.0.0.0", 8092), Handler).serve_forever()
