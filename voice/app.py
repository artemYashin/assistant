"""Local speech recognition. Audio is held in memory and never persisted."""
import io
import os
import threading
from fastapi import FastAPI, UploadFile, HTTPException
from starlette.concurrency import run_in_threadpool
from faster_whisper import WhisperModel

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
model = None
lock = threading.Lock()
MAX_BYTES = 20 * 1024 * 1024

@app.get('/health')
def health():
    return {'ok': True, 'modelLoaded': model is not None}

def recognize(data: bytes):
    global model
    with lock:
        if model is None:
            model = WhisperModel(os.getenv('WHISPER_MODEL', 'base'), device='cpu', compute_type='int8', download_root='/models')
        segments, info = model.transcribe(io.BytesIO(data), beam_size=3, vad_filter=True)
        if info.duration > 150:
            raise ValueError('Audio too long')
        return {'text': ' '.join(segment.text.strip() for segment in segments).strip(), 'language': info.language}

@app.post('/transcribe')
async def transcribe(audio: UploadFile):
    data = await audio.read(MAX_BYTES + 1)
    await audio.close()
    if not data or len(data) > MAX_BYTES:
        raise HTTPException(413, 'Audio must be between 1 byte and 20 MB')
    try:
        return await run_in_threadpool(recognize, data)
    except Exception:
        raise HTTPException(503, 'Transcription unavailable. Model may still be downloading, or audio may be invalid.')
