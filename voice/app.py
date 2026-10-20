"""Local speech recognition. Audio is held in memory and never persisted."""
import io
import logging
import re
import traceback
from uuid import uuid4
import os
import threading
from fastapi import FastAPI, UploadFile, HTTPException
from starlette.concurrency import run_in_threadpool
from faster_whisper import WhisperModel

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
model = None
lock = threading.Lock()
MAX_BYTES = 20 * 1024 * 1024
logger = logging.getLogger("uvicorn.error")


class RecognitionFailure(Exception):
    def __init__(self, stage, cause):
        self.stage = stage
        self.cause = cause


class AudioTooLong(Exception):
    pass


def diagnostic(error):
    # Never log audio/transcripts or URL query credentials.
    message = str(error)
    message = re.sub(r"https?://[^\s<>'\"]+", "[remote URL]", message)
    message = re.sub(r"(?i)(bearer|basic)\s+\S+", r"\1 [redacted]", message)
    message = re.sub(r"(?i)(token|password|secret|authorization)([\s:=]+)\S+",
                     r"\1\2[redacted]", message)
    message = re.sub(r"hf_[A-Za-z0-9]+", "[redacted]", message)
    return re.sub(r"[\x00-\x1f\x7f]", " ", message)[:1500]


@app.get('/health')
def health():
    return {'ok': True, 'modelLoaded': model is not None}

def recognize(data: bytes):
    global model
    with lock:
        if model is None:
            logger.info("[voice] stage=model_load model=%s", os.getenv('WHISPER_MODEL', 'medium'))
            try:
                model = WhisperModel(os.getenv('WHISPER_MODEL', 'medium'), device='cpu', compute_type='int8', download_root='/models')
            except Exception as error:
                raise RecognitionFailure("model_load", error) from error
            logger.info("[voice] stage=model_load complete")
        try:
            segments, info = model.transcribe(io.BytesIO(data), beam_size=5, vad_filter=True)
            if info.duration > 150:
                raise AudioTooLong()
            # faster-whisper performs inference while iterating this generator.
            return {'text': ' '.join(segment.text.strip() for segment in segments).strip(), 'language': info.language}
        except AudioTooLong:
            raise
        except Exception as error:
            raise RecognitionFailure("transcribe", error) from error

@app.post('/transcribe')
async def transcribe(audio: UploadFile):
    data = await audio.read(MAX_BYTES + 1)
    await audio.close()
    if not data or len(data) > MAX_BYTES:
        raise HTTPException(413, 'Audio must be between 1 byte and 20 MB')
    try:
        return await run_in_threadpool(recognize, data)
    except AudioTooLong:
        raise HTTPException(422, {'code': 'audio_too_long'})
    except Exception as error:
        reference = str(uuid4())
        stage = error.stage if isinstance(error, RecognitionFailure) else "unknown"
        cause = error.cause if isinstance(error, RecognitionFailure) else error
        frames = " > ".join(
            f"{frame.filename.rsplit('/', 1)[-1]}:{frame.lineno}:{frame.name}"
            for frame in traceback.extract_tb(cause.__traceback__)
        )
        logger.error("[voice] reference=%s stage=%s error=%s message=%s frames=%s",
                     reference, stage, type(cause).__name__, diagnostic(cause), frames)
        raise HTTPException(503, {'code': stage, 'reference': reference}) from None
