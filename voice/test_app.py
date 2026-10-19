import asyncio
import io
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from fastapi import HTTPException, UploadFile
import app


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
