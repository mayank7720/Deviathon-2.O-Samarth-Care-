"""Boundary regressions with an explicitly fake ASR engine; no accuracy claims.

Run: python tests/speech-service-test.py
No HTTP listener, model download, real recording or external service is used.
"""
import base64
from dataclasses import replace
import hashlib
import hmac
import io
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
import uuid
import wave

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import speech_service as speech


class FakeEngine:
    def __init__(self, segments=None):
        self.calls = []
        self.segments = segments if segments is not None else [SimpleNamespace(start=0.0, end=1.5, text=" आज खाना ठीक था। I spoke with family.")]

    def transcribe(self, samples, **kwargs):
        self.calls.append((samples, kwargs))
        return iter(self.segments), SimpleNamespace(language="hi", language_probability=0.82)


def fake_decoder(_audio, _mime):
    return speech.DecodedAudio([0.1] * 32, 2.0, 0.1, 0.2)


def wav_bytes(seconds=1.0, sample=0):
    output = io.BytesIO()
    with wave.open(output, "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(16000)
        audio.writeframes(int(sample).to_bytes(2, "little", signed=True) * int(seconds * 16000))
    return output.getvalue()


class SpeechBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.secret = "unit-test-only-" + "1" * 40
        self.now = 1800000000000
        self.origin = "http://127.0.0.1:5173"
        self.config = speech.SpeechConfig(self.root, self.secret)
        self.config.model_dir.mkdir(parents=True)
        for name in speech.MODEL_FILES:
            (self.config.model_dir / name).write_bytes(b"fake-model-file-not-a-real-model")
        speech.write_model_manifest(self.config.model_dir, self.config.model)
        self.engine = FakeEngine()
        self.service = speech.SpeechService(self.config, self.engine, decoder=fake_decoder, clock=lambda: self.now)
        self.audio = b"fake-audio-only-used-with-injected-decoder"
        self.read_count = 0

    def tearDown(self):
        self.temp.cleanup()

    def ticket_value(self, **updates):
        return {"version": 1, "id": str(uuid.uuid4()), "seniorId": "S001", "actorId": "local-coordinator",
                "origin": self.origin, "issuedAt": self.now, "expiresAt": self.now + 60000, "consent": True, **updates}

    def token(self, value):
        encoded = base64.urlsafe_b64encode(speech.compact_json(value).encode()).decode().rstrip("=")
        signature = hmac.new(self.secret.encode(), ("speech-ticket\n" + encoded).encode(), hashlib.sha256).hexdigest()
        return encoded + "." + signature

    def headers(self, ticket=None, **updates):
        value = ticket or self.ticket_value()
        return {"Host": "127.0.0.1:8766", "Origin": self.origin, "Content-Type": "audio/webm;codecs=opus",
                "Content-Length": str(len(self.audio)), "Authorization": "Bearer " + self.token(value), **updates}

    def request(self, headers=None, method="POST", path="/transcribe", audio=None):
        def read(size):
            self.read_count += 1
            value = self.audio if audio is None else audio
            self.assertLessEqual(size, speech.MAX_AUDIO_BYTES)
            return value
        return self.service.handle(method, path, headers or self.headers(), read)

    def test_valid_audio_produces_a_bound_signed_receipt_without_retention(self):
        ticket = self.ticket_value()
        status, result, cors = self.request(self.headers(ticket))
        self.assertEqual(status, 200, result)
        receipt = result["receipt"]
        expected = hmac.new(self.secret.encode(), ("speech-receipt\n" + receipt["payload"]).encode(), hashlib.sha256).hexdigest()
        self.assertTrue(hmac.compare_digest(receipt["signature"], expected))
        value = json.loads(receipt["payload"])
        self.assertEqual((value["ticketId"], value["seniorId"], value["actorId"], value["origin"]), (ticket["id"], "S001", "local-coordinator", self.origin))
        self.assertEqual(value["model"], "faster-whisper:base")
        self.assertEqual(value["audioSha256"], hashlib.sha256(self.audio).hexdigest())
        self.assertEqual(value["expiresAt"] - value["createdAt"], 86400000)
        self.assertFalse(value["externalServiceUsed"])
        self.assertIn("आज", value["text"])
        self.assertEqual(cors["Access-Control-Allow-Origin"], self.origin)
        self.assertTrue(self.engine.calls[0][1]["vad_filter"])
        self.assertEqual(self.engine.calls[0][1]["task"], "transcribe")
        self.assertFalse(self.engine.calls[0][1]["condition_on_previous_text"])
        with self.service.nonces._connection() as database:
            columns = {r[1] for r in database.execute("PRAGMA table_info(speech_nonces)")}
            self.assertEqual(columns, {"ticket_id", "expires_at", "claimed_at"})

    def test_origin_host_signature_and_method_fail_before_audio_is_read(self):
        for update, method, expected in [({"Origin": "https://evil.example"}, "POST", 403),
                                          ({"Origin": "http://127.0.0.1:5173/"}, "POST", 403),
                                          ({"Origin": "null"}, "POST", 403),
                                          ({"Host": "evil.example:8766"}, "POST", 403),
                                          ({"Authorization": "Bearer invalid"}, "POST", 401),
                                          ({}, "DELETE", 405)]:
            with self.subTest(update=update, method=method):
                self.assertEqual(self.request(self.headers(**update), method=method)[0], expected)
        ticket = self.ticket_value()
        headers = self.headers(ticket)
        raw = headers["Authorization"]
        headers["Authorization"] = raw[:-1] + ("1" if raw[-1] != "1" else "2")
        self.assertEqual(self.request(headers)[0], 401)
        self.assertEqual(self.read_count, 0)
        self.assertEqual(self.engine.calls, [])

    def test_ticket_schema_time_consent_and_origin_are_enforced(self):
        invalid = [dict(consent=False), dict(version=True), dict(issuedAt=self.now - 70000, expiresAt=self.now - 1),
                   dict(expiresAt=self.now + 300001), dict(issuedAt=self.now + 31000, expiresAt=self.now + 60000),
                   dict(origin="http://localhost:5173"), dict(seniorId="../../private"), dict(actorId="../../private"),
                   dict(id="not-a-uuid"), dict(path="C:/private/audio.wav")]
        for fields in invalid:
            with self.subTest(fields=fields):
                self.assertEqual(self.request(self.headers(self.ticket_value(**fields)))[0], 401)
        self.assertEqual(self.read_count, 0)

    def test_replay_claim_is_durable_across_service_restart(self):
        ticket = self.ticket_value()
        headers = self.headers(ticket)
        self.assertEqual(self.request(headers)[0], 200)
        self.service = speech.SpeechService(self.config, self.engine, decoder=fake_decoder, clock=lambda: self.now)
        self.assertEqual(self.request(headers)[0], 409)
        self.assertEqual(self.read_count, 1)
        self.assertEqual(len(self.engine.calls), 1)

    def test_oversize_wrong_mime_framing_and_short_body_are_rejected(self):
        for update, expected in [({"Content-Length": str(speech.MAX_AUDIO_BYTES + 1)}, 413),
                                 ({"Content-Length": "0"}, 413), ({"Content-Length": "bad"}, 411),
                                 ({"Transfer-Encoding": "chunked"}, 400),
                                 ({"Content-Type": "text/plain"}, 415),
                                 ({"Content-Type": "multipart/form-data;boundary=foo"}, 415)]:
            with self.subTest(update=update):
                self.assertEqual(self.request(self.headers(**update))[0], expected)
        self.assertEqual(self.read_count, 0)
        ticket = self.ticket_value()
        self.assertEqual(self.request(self.headers(ticket), audio=b"x")[0], 400)
        self.assertFalse(self.service.nonces.used(ticket["id"]))

    def test_busy_does_not_consume_ticket_or_read_audio(self):
        ticket = self.ticket_value()
        self.service.processing.acquire()
        try:
            status, result, _ = self.request(self.headers(ticket))
            self.assertEqual((status, result["code"]), (503, "busy"))
        finally:
            self.service.processing.release()
        self.assertEqual(self.read_count, 0)
        self.assertFalse(self.service.nonces.used(ticket["id"]))
        self.assertEqual(self.request(self.headers(ticket))[0], 200)

    def test_silence_and_duration_bounds_never_invent_a_transcript(self):
        for decoded, code in [(speech.DecodedAudio([], 2, 0, 0), "no_speech"),
                              (speech.DecodedAudio([], 181, 0.1, 0.2), "audio_duration")]:
            ticket = self.ticket_value()
            self.service.decoder = lambda _audio, _mime: decoded
            _, result, _ = self.request(self.headers(ticket))
            self.assertEqual(result["code"], code)
            self.assertNotIn("receipt", result)
            self.assertFalse(self.service.nonces.used(ticket["id"]))
        self.assertEqual(self.engine.calls, [])

    def test_no_recognized_speech_consumes_valid_audio_ticket_without_success(self):
        ticket = self.ticket_value()
        self.service.engine = FakeEngine(segments=[])
        status, result, _ = self.request(self.headers(ticket))
        self.assertEqual((status, result["code"]), (422, "no_speech"))
        self.assertTrue(self.service.nonces.used(ticket["id"]))
        self.assertNotIn("receipt", result)

    def test_transcript_and_segment_limits_reject_instead_of_silent_truncation(self):
        for segments in [[SimpleNamespace(start=0, end=1, text="x" * 6001)],
                         [SimpleNamespace(start=0, end=1, text="word")] * 121,
                         [SimpleNamespace(start=0, end=99, text="outside actual audio")]]:
            self.service.engine = FakeEngine(segments)
            status, result, _ = self.request()
            self.assertNotEqual(status, 200)
            self.assertNotIn("receipt", result)

    def test_engine_errors_are_generic_and_do_not_leak_server_paths(self):
        class BrokenEngine:
            def transcribe(self, *_args, **_kwargs):
                raise RuntimeError("C:/sensitive/secret-file.wav patient narrative")
        self.service.engine = BrokenEngine()
        status, result, _ = self.request()
        self.assertEqual(status, 503)
        self.assertNotIn("sensitive", json.dumps(result))
        self.assertNotIn("patient", json.dumps(result))

    def test_health_preflight_and_model_allowlist_expose_no_secrets(self):
        status, value, _ = self.request({"Host": "127.0.0.1:8766"}, method="GET", path="/health")
        self.assertEqual(status, 200)
        self.assertEqual(set(value), {"engine", "model", "modelInstalled", "ready", "externalServiceUsed"})
        self.assertNotIn(self.secret, json.dumps(value))
        self.assertNotIn(str(self.root), json.dumps(value))
        status, _, cors = self.request({"Host": "127.0.0.1:8766", "Origin": self.origin,
                                        "Access-Control-Request-Method": "POST",
                                        "Access-Control-Request-Headers": "authorization, content-type"}, method="OPTIONS")
        self.assertEqual(status, 204)
        self.assertEqual(cors["Access-Control-Allow-Origin"], self.origin)
        with self.assertRaises(speech.SpeechError):
            replace(self.config, model="../../private/model")
        self.assertEqual(self.read_count, 0)

    def test_config_json_quoted_values_are_not_executed_and_manifest_is_verified(self):
        path = self.root / ".dev.vars.speech"
        path.write_text('SAMARTH_SPEECH_SECRET=' + json.dumps(self.secret) + '\nSAMARTH_SPEECH_THREADS="4"\n', encoding="utf-8")
        config = speech.load_config(self.root, environ={})
        self.assertEqual(config.secret, self.secret)
        self.assertTrue(speech.model_installed(config, verify_hashes=True))
        (config.model_dir / "model.bin").write_bytes(b"tampered")
        self.assertFalse(speech.model_installed(config, verify_hashes=True))
        path.write_text('SAMARTH_SPEECH_SECRET=$(Get-Content private)\nUNKNOWN=oops\n', encoding="utf-8")
        with self.assertRaises(speech.SpeechError):
            speech.load_config(self.root, environ={})

    def test_real_decoder_rejects_bad_audio_and_checks_decoded_duration_when_installed(self):
        try:
            import av  # noqa: F401 - test is optional before explicit runtime installation.
            import numpy  # noqa: F401
        except ImportError:
            self.skipTest("PyAV/NumPy not installed; no model or decoder accuracy is claimed")
        for audio in [b"not a wave", b"#EXTM3U\nhttps://example.invalid/audio.mp3"]:
            with self.assertRaises(speech.SpeechError):
                speech.decode_audio_bytes(audio, "audio/wav")
        silent = speech.decode_audio_bytes(wav_bytes(), "audio/wav")
        self.assertEqual(silent.duration_seconds, 1)
        self.assertEqual(silent.peak, 0)
        with self.assertRaises(speech.SpeechError) as caught:
            speech.transcribe_audio_bytes(wav_bytes(), self.engine)
        self.assertEqual(caught.exception.code, "no_speech")
        with self.assertRaises(speech.SpeechError) as caught:
            speech.decode_audio_bytes(wav_bytes(seconds=181), "audio/wav")
        self.assertEqual(caught.exception.code, "audio_duration")


if __name__ == "__main__":
    unittest.main(verbosity=2)
