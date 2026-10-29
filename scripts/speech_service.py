"""Loopback-only, offline speech recognition. Never stores audio or transcript text.

Run with the checkout-local Python installed by setup-speech.ps1. Importing this
module does not open a socket, import the model runtime, or download a model.
"""
from __future__ import annotations

import base64
from contextlib import contextmanager
import hashlib
import hmac
import io
import json
import logging
import math
import os
from pathlib import Path
import re
import socket
import sqlite3
import sys
import threading
import time
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Callable, Mapping
from urllib.parse import urlsplit
import uuid

HOST, PORT = "127.0.0.1", 8766
MAX_AUDIO_BYTES = 8 * 1024 * 1024
MAX_DURATION_SECONDS = 180
SAMPLE_RATE = 16000
MAX_SAMPLES = SAMPLE_RATE * MAX_DURATION_SECONDS
MAX_TICKET_LIFETIME_MS = 300000
CLOCK_SKEW_MS = 30000
MAX_SEGMENTS, MAX_TEXT = 120, 6000
DEFAULT_ORIGINS = "http://127.0.0.1:5173,http://localhost:5173"
MODEL_REVISIONS = {
    "base": "ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66",
    "small": "536b0662742c02347bc0e980a01041f333bce120",
}
MODEL_FILES = ("config.json", "model.bin", "tokenizer.json", "vocabulary.txt")
MIME_FORMATS = {
    "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav",
    "audio/webm": "matroska", "audio/ogg": "ogg", "audio/mpeg": "mp3",
    "audio/mp4": "mov", "audio/flac": "flac", "audio/x-flac": "flac",
}
CONFIG_KEYS = {
    "SAMARTH_SPEECH_SECRET", "SAMARTH_SPEECH_ALLOWED_ORIGINS",
    "SAMARTH_SPEECH_MODEL", "SAMARTH_SPEECH_DEVICE",
    "SAMARTH_SPEECH_COMPUTE_TYPE", "SAMARTH_SPEECH_THREADS",
}


class SpeechError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status, self.code = status, code


def fail(ok: bool, status: int, code: str, message: str) -> None:
    if not ok:
        raise SpeechError(status, code, message)


def epoch_ms() -> int:
    return time.time_ns() // 1000000


def compact_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def _no_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict:
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON key")
        result[key] = value
    return result


def _valid_origin(value: str) -> bool:
    try:
        parsed = urlsplit(value)
        return (parsed.scheme in {"http", "https"} and bool(parsed.hostname)
                and not parsed.username and not parsed.password and not parsed.path
                and not parsed.query and not parsed.fragment and parsed.port != 0)
    except ValueError:
        return False


@dataclass(frozen=True)
class SpeechConfig:
    root: Path
    secret: str
    allowed_origins: tuple[str, ...] = tuple(DEFAULT_ORIGINS.split(","))
    model: str = "base"
    device: str = "cpu"
    compute_type: str = "int8"
    threads: int = 4

    def __post_init__(self) -> None:
        fail(isinstance(self.secret, str) and len(self.secret) >= 32, 503, "configuration", "Local speech is not configured.")
        fail(self.model in MODEL_REVISIONS, 503, "configuration", "Choose an installed multilingual base or small model.")
        fail(0 < len(self.allowed_origins) <= 8 and all(_valid_origin(o) for o in self.allowed_origins), 503, "configuration", "Configure exact application origins.")
        fail(self.device in {"cpu", "cuda"} and self.compute_type in {"int8", "int8_float16", "float16", "float32"}, 503, "configuration", "Invalid local speech compute configuration.")
        fail(type(self.threads) is int and 1 <= self.threads <= 16, 503, "configuration", "Choose one to sixteen CPU threads.")
        fail(self.device != "cpu" or self.compute_type in {"int8", "float32"}, 503, "configuration", "CPU speech supports int8 or float32.")

    @property
    def model_dir(self) -> Path:
        return self.root / ".local-tools" / "speech" / "models" / self.model

    @property
    def state_path(self) -> Path:
        return self.root / "outputs" / "speech-state.sqlite"


def load_config(root: Path | None = None, environ: Mapping[str, str] | None = None) -> SpeechConfig:
    root = (root or Path(__file__).resolve().parent.parent).resolve()
    values: dict[str, str] = {}
    path = root / ".dev.vars.speech"
    if path.exists():
        fail(path.stat().st_size <= 16384, 503, "configuration", "Local speech configuration is invalid.")
        try:
            for line in path.read_text(encoding="utf-8-sig").splitlines():
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                key, separator, raw = line.partition("=")
                key, raw = key.strip(), raw.strip()
                if not separator or key not in CONFIG_KEYS or key in values:
                    raise ValueError("Invalid configuration entry")
                value = json.loads(raw) if raw.startswith('"') else raw
                if not isinstance(value, str):
                    raise ValueError("Configuration values must be strings")
                values[key] = value
        except (ValueError, UnicodeError, OSError):
            raise SpeechError(503, "configuration", "Local speech configuration is invalid.") from None
    current = os.environ if environ is None else environ
    values.update({key: current[key] for key in CONFIG_KEYS if key in current})
    try:
        threads = int(values.get("SAMARTH_SPEECH_THREADS", "4"))
    except ValueError:
        raise SpeechError(503, "configuration", "Choose a valid CPU thread count.") from None
    return SpeechConfig(
        root=root, secret=values.get("SAMARTH_SPEECH_SECRET", ""),
        allowed_origins=tuple(o.strip() for o in values.get("SAMARTH_SPEECH_ALLOWED_ORIGINS", DEFAULT_ORIGINS).split(",")),
        model=values.get("SAMARTH_SPEECH_MODEL", "base"),
        device=values.get("SAMARTH_SPEECH_DEVICE", "cpu"),
        compute_type=values.get("SAMARTH_SPEECH_COMPUTE_TYPE", "int8"), threads=threads,
    )


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_model_manifest(model_dir: Path, model: str) -> None:
    """Setup-only helper. Caller downloads the fixed public model revision first."""
    if model not in MODEL_REVISIONS:
        raise ValueError("Unknown model")
    manifest = {"version": 1, "model": model, "repo": f"Systran/faster-whisper-{model}",
                "revision": MODEL_REVISIONS[model], "downloadedAt": epoch_ms(),
                "files": {name: {"sha256": file_sha256(model_dir / name), "bytes": (model_dir / name).stat().st_size} for name in MODEL_FILES}}
    (model_dir / "samarth-model.json").write_text(compact_json(manifest) + "\n", encoding="utf-8")


def model_installed(config: SpeechConfig, verify_hashes: bool = False) -> bool:
    try:
        path = config.model_dir.resolve()
        if not path.is_relative_to((config.root / ".local-tools" / "speech" / "models").resolve()):
            return False
        manifest = json.loads((path / "samarth-model.json").read_text(encoding="utf-8"))
        if manifest.get("model") != config.model or manifest.get("revision") != MODEL_REVISIONS[config.model] or manifest.get("repo") != f"Systran/faster-whisper-{config.model}":
            return False
        for name in MODEL_FILES:
            file = path / name
            info = manifest.get("files", {}).get(name, {})
            if not file.is_file() or file.stat().st_size <= 0 or file.stat().st_size != info.get("bytes"):
                return False
            if verify_hashes and not hmac.compare_digest(file_sha256(file), info.get("sha256", "")):
                return False
        return True
    except (OSError, ValueError, TypeError):
        return False


def load_engine(config: SpeechConfig) -> Any:
    fail(model_installed(config, verify_hashes=True), 503, "model_unavailable", "Install and verify the selected local model before transcribing.")
    # Local directory + tokenizer + offline flags prevent a fallback network fetch.
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    logging.getLogger("faster_whisper").setLevel(logging.ERROR)
    try:
        from faster_whisper import WhisperModel
        return WhisperModel(str(config.model_dir), device=config.device, compute_type=config.compute_type,
                            cpu_threads=config.threads, num_workers=1, local_files_only=True)
    except Exception:
        raise SpeechError(503, "model_unavailable", "The installed local speech model could not be loaded.") from None


def verify_ticket(token: str, secret: str, origin: str, allowed_origins: tuple[str, ...], now_ms: int | None = None) -> dict:
    now_ms = epoch_ms() if now_ms is None else now_ms
    fail(origin in allowed_origins, 403, "origin", "This application origin is not permitted.")
    fail(isinstance(token, str) and len(token) <= 8192, 401, "ticket", "A valid, unexpired speech ticket is required.")
    parts = token.split(".")
    fail(len(parts) == 2 and re.fullmatch(r"[A-Za-z0-9_-]{1,6000}", parts[0]) is not None and re.fullmatch(r"[0-9a-f]{64}", parts[1]) is not None, 401, "ticket", "A valid, unexpired speech ticket is required.")
    encoded, signature = parts
    expected = hmac.new(secret.encode(), ("speech-ticket\n" + encoded).encode(), hashlib.sha256).hexdigest()
    fail(hmac.compare_digest(signature, expected), 401, "ticket", "A valid, unexpired speech ticket is required.")
    try:
        raw = base64.b64decode(encoded + "=" * (-len(encoded) % 4), altchars=b"-_", validate=True)
        if base64.urlsafe_b64encode(raw).decode().rstrip("=") != encoded:
            raise ValueError("Noncanonical encoding")
        value = json.loads(raw.decode("utf-8"), object_pairs_hook=_no_duplicate_keys)
        if not isinstance(value, dict) or set(value) != {"version", "id", "seniorId", "actorId", "origin", "issuedAt", "expiresAt", "consent"}:
            raise ValueError("Unknown ticket schema")
        if type(value["version"]) is not int or value["version"] != 1 or value["consent"] is not True:
            raise ValueError("Invalid version or consent")
        ticket_id = value["id"]
        if not isinstance(ticket_id, str) or str(uuid.UUID(ticket_id)) != ticket_id.lower():
            raise ValueError("Invalid ticket identity")
        if not isinstance(value["seniorId"], str) or re.fullmatch(r"S[0-9]{3,6}", value["seniorId"]) is None:
            raise ValueError("Invalid senior identity")
        actor = value["actorId"]
        if not isinstance(actor, str) or re.fullmatch(r"(?:[a-fA-F0-9]{8}-(?:[a-fA-F0-9]{4}-){3}[a-fA-F0-9]{12}|local-[A-Za-z0-9_-]{1,64})", actor) is None:
            raise ValueError("Invalid actor identity")
        if value["origin"] != origin or type(value["issuedAt"]) is not int or type(value["expiresAt"]) is not int:
            raise ValueError("Invalid ticket binding")
        issued, expires = value["issuedAt"], value["expiresAt"]
        if not (0 < expires - issued <= MAX_TICKET_LIFETIME_MS and issued <= now_ms + CLOCK_SKEW_MS and expires > now_ms):
            raise ValueError("Expired ticket")
        return value
    except (ValueError, TypeError, KeyError, UnicodeError):
        raise SpeechError(401, "ticket", "A valid, unexpired speech ticket is required.") from None


class NonceStore:
    """Only opaque ticket IDs and expiry times are retained; no audio or text."""
    def __init__(self, path: Path):
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        with self._connection() as connection:
            connection.execute("PRAGMA journal_mode=WAL")
            connection.execute("CREATE TABLE IF NOT EXISTS speech_nonces (ticket_id TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, claimed_at INTEGER NOT NULL)")
        try:
            path.chmod(0o600)
        except OSError:
            pass

    @contextmanager
    def _connection(self):
        connection = sqlite3.connect(self.path, timeout=3)
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def used(self, ticket_id: str) -> bool:
        with self._connection() as connection:
            return connection.execute("SELECT 1 FROM speech_nonces WHERE ticket_id=?", (ticket_id.lower(),)).fetchone() is not None

    def claim(self, ticket: dict, now_ms: int | None = None) -> None:
        now_ms = epoch_ms() if now_ms is None else now_ms
        fail(ticket["expiresAt"] > now_ms, 401, "ticket", "The speech ticket expired before processing began.")
        try:
            with self._connection() as connection:
                connection.execute("BEGIN IMMEDIATE")
                connection.execute("DELETE FROM speech_nonces WHERE expires_at < ?", (now_ms - 86400000,))
                connection.execute("INSERT INTO speech_nonces(ticket_id,expires_at,claimed_at) VALUES(?,?,?)", (ticket["id"].lower(), ticket["expiresAt"], now_ms))
        except sqlite3.IntegrityError:
            raise SpeechError(409, "replay", "This speech ticket has already been used. Request a new ticket.") from None


@dataclass(frozen=True)
class DecodedAudio:
    samples: Any
    duration_seconds: float
    rms: float
    peak: float


def audio_mime(value: str) -> str:
    mime = value.split(";", 1)[0].strip().lower()
    fail(mime in MIME_FORMATS, 415, "audio_type", "Use WAV, WebM, Ogg, MP3, MP4 or FLAC audio.")
    return mime


def decode_audio_bytes(audio_bytes: bytes, mime_type: str) -> DecodedAudio:
    """Bound duration, channels, input/output size and decode work before Whisper.

    A forced container demuxer and a BytesIO input prevent HTTP input from being
    interpreted as a filename, URL, playlist or external-resource instruction.
    """
    fail(isinstance(audio_bytes, bytes) and 0 < len(audio_bytes) <= MAX_AUDIO_BYTES, 413, "audio_size", "Audio must be nonempty and no larger than 8 MiB.")
    mime_type = audio_mime(mime_type)
    try:
        import av
        import numpy as np
    except ImportError:
        raise SpeechError(503, "runtime_unavailable", "Install the local speech runtime before transcribing.") from None
    chunks, total, frames, decoded_seconds = [], 0, 0, 0.0
    started = time.monotonic()
    try:
        with av.open(io.BytesIO(audio_bytes), mode="r", format=MIME_FORMATS[mime_type],
                     options={"protocol_whitelist": "pipe", "enable_drefs": "0", "probesize": "1048576", "analyzeduration": "1000000"}) as container:
            fail(len(container.streams.audio) == 1, 422, "invalid_audio", "Provide a recording with one audio stream.")
            stream = container.streams.audio[0]
            rate = stream.codec_context.sample_rate
            channels = len(stream.codec_context.layout.channels)
            fail(8000 <= rate <= 192000 and 1 <= channels <= 2, 422, "audio_format", "Use mono or stereo audio at a supported sample rate.")
            if stream.duration is not None and stream.time_base is not None:
                duration = float(stream.duration * stream.time_base)
                fail(math.isfinite(duration) and duration <= MAX_DURATION_SECONDS + 0.05, 413, "audio_duration", "Record at most 180 seconds of audio.")
            resampler = av.AudioResampler(format="fltp", layout="mono", rate=SAMPLE_RATE)

            def append_frame(frame: Any) -> None:
                nonlocal total
                total += frame.samples
                fail(total <= MAX_SAMPLES, 413, "audio_duration", "Record at most 180 seconds of audio.")
                array = frame.to_ndarray().reshape(-1)
                fail(array.size == frame.samples, 422, "invalid_audio", "The recording could not be decoded safely.")
                chunks.append(array.astype(np.float32, copy=True))

            for packet in container.demux(stream):
                fail(time.monotonic() - started <= 20, 422, "decode_limit", "The recording exceeded the safe decode work limit.")
                for frame in packet.decode():
                    frames += 1
                    frame_rate = frame.sample_rate
                    fail(frames <= 100000 and 8000 <= frame_rate <= 192000 and 1 <= len(frame.layout.channels) <= 2 and 0 <= frame.samples <= frame_rate * 5,
                         422, "decode_limit", "The recording exceeded safe audio frame limits.")
                    decoded_seconds += frame.samples / frame_rate
                    fail(decoded_seconds <= MAX_DURATION_SECONDS + 0.0001, 413, "audio_duration", "Record at most 180 seconds of audio.")
                    # Container timestamps do not become clinical event timestamps.
                    frame.pts = None
                    for output in resampler.resample(frame):
                        append_frame(output)
            for output in resampler.resample(None):
                append_frame(output)
        fail(total >= int(SAMPLE_RATE * 0.2), 422, "empty_audio", "Record at least a short spoken phrase.")
        samples = np.concatenate(chunks)
        fail(bool(np.isfinite(samples).all()), 422, "invalid_audio", "The recording contains invalid audio samples.")
        samples = np.clip(samples, -1.0, 1.0)
        return DecodedAudio(samples, total / SAMPLE_RATE, float(np.sqrt(np.mean(np.square(samples, dtype=np.float64)))), float(np.max(np.abs(samples))))
    except SpeechError:
        raise
    except Exception:
        raise SpeechError(422, "invalid_audio", "The recording could not be decoded as the declared audio type.") from None


def transcribe_audio_bytes(audio_bytes: bytes, engine: Any, *, mime_type: str = "audio/wav", model: str = "base",
                           decoder: Callable[[bytes, str], DecodedAudio] = decode_audio_bytes,
                           on_valid_audio: Callable[[], None] | None = None) -> dict:
    """Internal helper for real-model tests; no socket, path input or persistence.

    A fake decoder/engine may be injected by unit tests. Such tests are not speech
    accuracy evidence. Production always uses decode_audio_bytes and WhisperModel.
    """
    fail(model in MODEL_REVISIONS and engine is not None, 503, "model_unavailable", "The selected local model is unavailable.")
    fail(isinstance(audio_bytes, bytes) and 0 < len(audio_bytes) <= MAX_AUDIO_BYTES, 413, "audio_size", "Audio must be nonempty and no larger than 8 MiB.")
    mime_type = audio_mime(mime_type)
    decoded = decoder(audio_bytes, mime_type)
    fail(math.isfinite(decoded.duration_seconds) and 0.2 <= decoded.duration_seconds <= MAX_DURATION_SECONDS,
         413, "audio_duration", "Record a spoken phrase no longer than 180 seconds.")
    fail(math.isfinite(decoded.rms) and math.isfinite(decoded.peak) and decoded.rms >= 0.00015 and decoded.peak >= 0.001,
         422, "no_speech", "No audible speech was detected. Record again; no transcript has been invented.")
    if on_valid_audio is not None:
        on_valid_audio()
    try:
        source, info = engine.transcribe(decoded.samples, task="transcribe", language=None, multilingual=True,
                                        beam_size=3, temperature=0.0, condition_on_previous_text=False,
                                        vad_filter=True, vad_parameters={"min_silence_duration_ms": 500},
                                        word_timestamps=False, max_new_tokens=256)
        segments, texts, previous_start = [], [], 0.0
        for index, segment in enumerate(source):
            fail(index < MAX_SEGMENTS, 422, "transcript_limit", "The transcript exceeds the review limit. Record a shorter clip.")
            text = segment.text
            fail(isinstance(text, str), 502, "model_output", "The local model returned an invalid transcript.")
            text = text.strip()
            if not text:
                continue
            start, end = float(segment.start), float(segment.end)
            fail(math.isfinite(start) and math.isfinite(end) and previous_start <= start <= end <= decoded.duration_seconds + 1,
                 502, "model_output", "The local model returned invalid audio timing.")
            previous_start = start
            end = min(end, decoded.duration_seconds)
            fail(start <= end, 502, "model_output", "The local model returned invalid audio timing.")
            texts.append(text)
            fail(sum(len(t) for t in texts) + len(texts) - 1 <= MAX_TEXT, 422, "transcript_limit", "The transcript exceeds the review limit. Record a shorter clip.")
            segments.append({"start": round(start, 3), "end": round(end, 3), "text": text})
        fail(bool(segments), 422, "no_speech", "No speech was recognized. Record again; no transcript has been invented.")
        language, probability = info.language, float(info.language_probability)
        fail(isinstance(language, str) and re.fullmatch(r"[a-z]{2,3}", language) is not None and math.isfinite(probability) and 0 <= probability <= 1,
             502, "model_output", "The local model returned invalid language information.")
        return {"model": f"faster-whisper:{model}", "language": language, "languageProbability": round(probability, 6),
                "durationSeconds": round(decoded.duration_seconds, 3), "audioSha256": hashlib.sha256(audio_bytes).hexdigest(),
                "text": " ".join(texts), "segments": segments, "externalServiceUsed": False}
    except SpeechError:
        raise
    except Exception:
        raise SpeechError(503, "transcription_failed", "Local transcription failed. Request a new ticket and retry the recording.") from None


def sign_receipt(result: dict, ticket: dict, secret: str, now_ms: int | None = None) -> dict:
    now_ms = epoch_ms() if now_ms is None else now_ms
    value = {"version": 1, "ticketId": ticket["id"], "seniorId": ticket["seniorId"], "actorId": ticket["actorId"],
             "origin": ticket["origin"], **result, "createdAt": now_ms, "expiresAt": now_ms + 86400000}
    payload = compact_json(value)
    signature = hmac.new(secret.encode(), ("speech-receipt\n" + payload).encode(), hashlib.sha256).hexdigest()
    return {"payload": payload, "signature": signature}


def _header(headers: Mapping, name: str) -> str:
    if hasattr(headers, "get_all"):
        entries = headers.get_all(name, [])
        fail(len(entries) <= 1, 400, "headers", "Duplicate request headers are not permitted.")
    value = headers.get(name, "")
    if not value:
        value = next((v for k, v in headers.items() if k.lower() == name.lower()), "")
    return value


class SpeechService:
    """Transport-independent request handler; unit tests never need a listener."""
    def __init__(self, config: SpeechConfig, engine: Any = None, *, nonce_store: NonceStore | None = None,
                 decoder: Callable[[bytes, str], DecodedAudio] = decode_audio_bytes, clock: Callable[[], int] = epoch_ms):
        self.config, self.engine, self.decoder, self.clock = config, engine, decoder, clock
        self.nonces = nonce_store or NonceStore(config.state_path)
        self.processing = threading.Lock()

    def health(self) -> dict:
        installed = model_installed(self.config)
        return {"engine": "faster-whisper", "model": self.config.model, "modelInstalled": installed,
                "ready": installed and self.engine is not None, "externalServiceUsed": False}

    def handle(self, method: str, path: str, headers: Mapping, read_body: Callable[[int], bytes]) -> tuple[int, dict, dict]:
        cors: dict[str, str] = {}
        try:
            host = _header(headers, "Host")
            fail(host in {f"127.0.0.1:{PORT}", f"localhost:{PORT}"}, 403, "host", "Use the local speech address.")
            origin = _header(headers, "Origin")
            if origin in self.config.allowed_origins:
                cors = {"Access-Control-Allow-Origin": origin, "Vary": "Origin"}
            if method == "GET" and path == "/health":
                fail(not origin or origin in self.config.allowed_origins, 403, "origin", "This application origin is not permitted.")
                return 200, self.health(), cors
            fail(path == "/transcribe", 404, "route", "Local speech route not found.")
            fail(origin in self.config.allowed_origins, 403, "origin", "This application origin is not permitted.")
            if method == "OPTIONS":
                requested = _header(headers, "Access-Control-Request-Method")
                requested_headers = {h.strip().lower() for h in _header(headers, "Access-Control-Request-Headers").split(",") if h.strip()}
                fail(requested == "POST" and requested_headers <= {"authorization", "content-type"}, 403, "preflight", "This speech request is not permitted.")
                cors.update({"Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Max-Age": "60"})
                if _header(headers, "Access-Control-Request-Private-Network") == "true":
                    cors["Access-Control-Allow-Private-Network"] = "true"
                return 204, {}, cors
            fail(method == "POST", 405, "method", "Use POST for local transcription.")
            authorization = _header(headers, "Authorization")
            fail(authorization.startswith("Bearer "), 401, "ticket", "A valid, unexpired speech ticket is required.")
            ticket = verify_ticket(authorization[7:], self.config.secret, origin, self.config.allowed_origins, self.clock())
            fail(not _header(headers, "Transfer-Encoding"), 400, "framing", "Send audio with a fixed Content-Length.")
            length = _header(headers, "Content-Length")
            fail(re.fullmatch(r"[0-9]{1,10}", length) is not None, 411, "audio_size", "Send a valid audio Content-Length.")
            size = int(length)
            fail(0 < size <= MAX_AUDIO_BYTES, 413, "audio_size", "Audio must be nonempty and no larger than 8 MiB.")
            mime = audio_mime(_header(headers, "Content-Type"))
            fail(not self.nonces.used(ticket["id"]), 409, "replay", "This speech ticket has already been used. Request a new ticket.")
            fail(self.engine is not None and model_installed(self.config), 503, "model_unavailable", "Install and start the selected local model before transcribing.")
            fail(self.processing.acquire(blocking=False), 503, "busy", "Local speech is busy. Retry shortly with the same unused ticket.")
            try:
                audio = read_body(size)
                fail(isinstance(audio, bytes) and len(audio) == size, 400, "incomplete_audio", "The complete audio recording was not received.")
                result = transcribe_audio_bytes(audio, self.engine, mime_type=mime, model=self.config.model,
                                               decoder=self.decoder, on_valid_audio=lambda: self.nonces.claim(ticket, self.clock()))
                receipt = sign_receipt(result, ticket, self.config.secret, self.clock())
                return 200, {"receipt": receipt}, cors
            finally:
                self.processing.release()
        except SpeechError as error:
            return error.status, {"error": str(error), "code": error.code}, cors
        except (socket.timeout, TimeoutError):
            return 408, {"error": "The audio upload timed out.", "code": "timeout"}, cors
        except Exception:
            return 503, {"error": "Local speech is temporarily unavailable.", "code": "unavailable"}, cors


def make_handler(service: SpeechService) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        server_version = "SamarthLocalSpeech"
        sys_version = ""

        def log_message(self, *_args: Any) -> None:
            pass  # Authorization tickets and request data must not enter access logs.

        def setup(self) -> None:
            super().setup()
            self.connection.settimeout(15)

        def dispatch(self) -> None:
            status, value, cors = service.handle(self.command, self.path, self.headers, self.rfile.read)
            raw = b"" if status == 204 else compact_json(value).encode("utf-8")
            self.send_response(status)
            for key, val in {"Content-Type": "application/json; charset=utf-8", "Content-Length": str(len(raw)),
                             "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
                             "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'", "Connection": "close", **cors}.items():
                self.send_header(key, val)
            if status == 503:
                self.send_header("Retry-After", "2")
            self.end_headers()
            self.close_connection = True
            if self.command != "HEAD":
                self.wfile.write(raw)

        do_GET = do_POST = do_OPTIONS = do_PUT = do_PATCH = do_DELETE = do_HEAD = dispatch
    return Handler


def main() -> int:
    try:
        config = load_config()
        try:
            engine = load_engine(config)
        except SpeechError:
            engine = None
            print("Local speech model is not ready. Run the explicit setup/download step, then restart.", file=sys.stderr)
        service = SpeechService(config, engine)
        server = ThreadingHTTPServer((HOST, PORT), make_handler(service))
        server.daemon_threads = True
        print(f"Samarth local speech: http://{HOST}:{PORT} ({config.model}; offline inference)", flush=True)
        try:
            server.serve_forever(poll_interval=0.5)
        except KeyboardInterrupt:
            pass
        finally:
            server.server_close()
        return 0
    except (SpeechError, OSError):
        print("Local speech could not start. Check the local configuration, installed model and loopback port.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
