import asyncio
import io
import unittest
import wave
import av
import numpy as np
from faster_whisper.audio import decode_audio
from types import SimpleNamespace
from unittest.mock import patch
from fastapi import HTTPException, UploadFile
import app


class AudioDecodeTests(unittest.TestCase):
    def test_real_audio_decoder_accepts_wav(self):
        # Exercises the real faster-whisper/PyAV boundary without downloading a model.
        audio = io.BytesIO()
        with wave.open(audio, "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(16000)
            wav.writeframes(b"\x00\x00" * 16000)
        audio.seek(0)
        samples = decode_audio(audio, sampling_rate=16000)
        self.assertEqual(len(samples), 16000)
        self.assertEqual(samples.dtype.name, "float32")

    def test_real_audio_decoder_accepts_browser_webm_opus(self):
        audio = io.BytesIO()
        with av.open(audio, "w", format="webm") as output:
            stream = output.add_stream("libopus", rate=48000)
            frame = av.AudioFrame.from_ndarray(
                np.zeros((1, 48000), dtype=np.int16), format="s16", layout="mono"
            )
            frame.sample_rate = 48000
            for packet in stream.encode(frame):
                output.mux(packet)
            for packet in stream.encode(None):
                output.mux(packet)
        audio.seek(0)
        self.assertEqual(len(decode_audio(audio, sampling_rate=16000)), 16000)


class VoiceDiagnosticsTests(unittest.TestCase):
    def tearDown(self):
        app.model = None

    def invoke(self):
        return asyncio.run(app.transcribe(UploadFile(file=io.BytesIO(b"fake audio"))))

    def test_model_download_failure_has_reference_and_sanitized_log(self):
        app.model = None
        with patch.object(app, "WhisperModel", side_effect=RuntimeError(
            "Download failed https://host.test/path?token=private hf_secret"
        )), self.assertLogs("uvicorn.error", level="ERROR") as logs:
            with self.assertRaises(HTTPException) as result:
                self.invoke()
        self.assertEqual(result.exception.status_code, 503)
        self.assertEqual(result.exception.detail["code"], "model_load")
        self.assertTrue(result.exception.detail["reference"])
        self.assertIn("Download failed", logs.output[0])
        self.assertNotIn("private", logs.output[0])
        self.assertNotIn("hf_secret", logs.output[0])

    def test_generator_failure_is_transcription_error(self):
        def segments():
            raise RuntimeError("Inference unavailable")
            yield
        app.model = SimpleNamespace(transcribe=lambda *a, **kw: (
            segments(), SimpleNamespace(duration=1, language="ru")
        ))
        with self.assertLogs("uvicorn.error", level="ERROR"), self.assertRaises(HTTPException) as result:
            self.invoke()
        self.assertEqual(result.exception.detail["code"], "transcribe")

    def test_long_recording_is_not_service_failure(self):
        app.model = SimpleNamespace(transcribe=lambda *a, **kw: (
            [], SimpleNamespace(duration=151, language="ru")
        ))
        with self.assertRaises(HTTPException) as result:
            self.invoke()
        self.assertEqual(result.exception.status_code, 422)

    def test_success(self):
        app.model = SimpleNamespace(transcribe=lambda *a, **kw: (
            [SimpleNamespace(text=" hello ")], SimpleNamespace(duration=1, language="en")
        ))
        self.assertEqual(self.invoke(), {"text": "hello", "language": "en"})


if __name__ == "__main__":
    unittest.main()
