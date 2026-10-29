#!/usr/bin/env python3
"""Local Asterisk AGI only. No network, API credentials, model or arbitrary paths."""
import datetime as dt
import json
import os
from pathlib import Path
import re
import signal
import stat
import sys
import tempfile
import time
import wave

SPOOL_ROOT = Path('/var/lib/samarth')
PROMPT_ROOT = Path('/var/lib/asterisk/sounds/samarth')
UUID = re.compile(r'^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$', re.I)
PHONE = re.compile(r'^\+[1-9][0-9]{7,14}$')
QUESTIONS = ('wellbeing', 'medication', 'appetite', 'support')
FIELDS = {'version', 'id', 'jobId', 'dialNumber', 'language', 'approved', 'expiresAt'}


class Disconnected(Exception):
    pass


class ProtocolError(Exception):
    pass


def timestamp():
    return dt.datetime.now(dt.timezone.utc).isoformat().replace('+00:00', 'Z')


def validate_job(value, job_id, now=None):
    now = int(time.time() * 1000) if now is None else now
    if not isinstance(job_id, str) or not UUID.fullmatch(job_id):
        raise ValueError('invalid_job_id')
    if not isinstance(value, dict) or set(value) - FIELDS:
        raise ValueError('invalid_manifest_fields')
    ident = value.get('id', value.get('jobId'))
    if not isinstance(ident, str) or ident.lower() != job_id.lower():
        raise ValueError('manifest_id_mismatch')
    if 'jobId' in value and (not isinstance(value['jobId'], str) or value['jobId'].lower() != job_id.lower()):
        raise ValueError('manifest_id_mismatch')
    if type(value.get('version', 1)) is not int or value.get('version', 1) != 1 or value.get('approved') is not True:
        raise ValueError('unapproved_manifest')
    if not isinstance(value.get('dialNumber'), str) or not PHONE.fullmatch(value['dialNumber']):
        raise ValueError('invalid_destination')
    if value.get('language') not in ('hi', 'en'):
        raise ValueError('invalid_language')
    expiry = value.get('expiresAt')
    if type(expiry) is not int or not now < expiry <= now + 86400000:
        raise ValueError('expired_manifest')
    return {**value, 'id': job_id.lower(), 'jobId': job_id.lower()}


def read_private_json(path):
    flags = os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0)
    descriptor = os.open(path, flags)
    with os.fdopen(descriptor, 'r', encoding='utf-8') as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size > 8192 or info.st_mode & 0o022:
            raise ValueError('invalid_manifest_file')
        return json.load(stream)


def wav_metadata(path):
    if path.is_symlink() or not path.is_file():
        raise ValueError('missing_audio')
    with wave.open(str(path), 'rb') as audio:
        frames, rate = audio.getnframes(), audio.getframerate()
        metadata = {'durationSeconds': round(frames / rate, 4) if rate else 0,
                    'sampleRate': rate, 'channels': audio.getnchannels(),
                    'sampleWidth': audio.getsampwidth()}
        if rate != 8000 or metadata['channels'] != 1 or metadata['sampleWidth'] != 2 or audio.getcomptype() != 'NONE' or frames <= 0:
            raise ValueError('invalid_audio_format')
        return metadata


class FileSpool:
    def __init__(self, root=SPOOL_ROOT, prompts=PROMPT_ROOT):
        # Main always uses the fixed constants; explicit injection is for local tests.
        self.root, self.prompts = Path(root), Path(prompts)

    def load(self, job_id):
        if not UUID.fullmatch(job_id):
            raise ValueError('invalid_job_id')
        return validate_job(read_private_json(self.root / 'jobs' / f'{job_id}.json'), job_id)

    def begin(self, job_id):
        for folder in ('jobs', 'results', 'recordings'):
            if self.root.joinpath(folder).is_symlink():
                raise ValueError('invalid_spool_directory')
        self.root.joinpath('results').mkdir(mode=0o700, parents=True, exist_ok=True)
        if self.root.joinpath('results', f'{job_id}.json').exists():
            raise ValueError('already_completed')
        marker = self.root / 'jobs' / f'{job_id}.started'
        descriptor = os.open(marker, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0), 0o600)
        with os.fdopen(descriptor, 'w', encoding='utf-8') as stream:
            stream.write(timestamp())

    def prompt(self, language, name):
        if language not in ('hi', 'en') or name not in ('consent', 'q1', 'q2', 'q3', 'q4', 'thanks', 'declined'):
            raise ValueError('invalid_prompt')
        return str(self.prompts / language / name)

    def validate_prompts(self, language):
        for name in ('consent', 'q1', 'q2', 'q3', 'q4', 'thanks', 'declined'):
            duration = wav_metadata(Path(self.prompt(language, name) + '.wav'))['durationSeconds']
            if duration > (55 if name == 'consent' else 30):
                raise ValueError('prompt_too_long')

    def recording_base(self, job_id, index):
        if not UUID.fullmatch(job_id) or index not in range(1, 5):
            raise ValueError('invalid_recording_path')
        folder = self.root / 'recordings' / job_id
        folder.mkdir(mode=0o700, parents=True, exist_ok=True)
        if folder.is_symlink():
            raise ValueError('invalid_recording_directory')
        target = folder / f'q{index}'
        if target.with_suffix('.wav').exists() or target.with_suffix('.wav').is_symlink():
            raise ValueError('recording_exists')
        return str(target)

    def answer(self, job_id, index):
        path = self.root / 'recordings' / job_id / f'q{index}.wav'
        metadata = wav_metadata(path)
        if metadata['durationSeconds'] > 30.1:
            raise ValueError('recording_too_long')
        return {'questionId': QUESTIONS[index - 1], 'path': str(path), **metadata}

    def save(self, result):
        directory = self.root / 'results'
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=directory, prefix='.', delete=False) as stream:
            temporary = stream.name
            os.chmod(temporary, 0o600)
            json.dump(result, stream, ensure_ascii=False)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, directory / f"{result['jobId']}.json")


class AgiProtocol:
    def __init__(self, input_stream=sys.stdin, output_stream=sys.stdout):
        self.input, self.output = input_stream, output_stream

    def environment(self):
        values = {}
        for _ in range(100):
            line = self.input.readline(8193)
            if len(line) > 8192 or not line:
                raise ProtocolError('invalid_agi_environment')
            if not line.strip():
                return values
            key, separator, value = line.rstrip('\r\n').partition(':')
            if not separator:
                raise ProtocolError('invalid_agi_environment')
            values[key.strip()] = value.strip()
        raise ProtocolError('too_many_agi_fields')

    def command(self, value):
        if '\n' in value or '\r' in value:
            raise ProtocolError('invalid_command')
        try:
            self.output.write(value + '\n')
            self.output.flush()
            line = self.input.readline(8193)
        except (BrokenPipeError, OSError) as error:
            raise Disconnected() from error
        if not line or line.startswith('HANGUP'):
            raise Disconnected()
        match = re.fullmatch(r'200 result=(-?\d+)(?:\s+(.*))?\r?\n?', line)
        if not match or len(line) > 8192:
            raise ProtocolError('unexpected_agi_response')
        result = match.group(1)
        if result == '-1':
            raise Disconnected()
        return result, match.group(2) or ''


def quoted(value):
    # Every caller supplies a fixed path, not caller notes or a phone number.
    if any(character in value for character in ('"', '\\', '\n', '\r')):
        raise ValueError('invalid_agi_argument')
    return '"' + value + '"'


def play(protocol, path):
    result, _ = protocol.command(f'STREAM FILE {quoted(path)} ""')
    if result != '0':
        raise ProtocolError('unexpected_playback_result')
    result, detail = protocol.command('GET VARIABLE PLAYBACKSTATUS')
    if result != '1' or detail != '(SUCCESS)':
        raise ProtocolError('prompt_playback_failed')


def run_session(job, protocol, spool, clock=timestamp):
    result = {'version': 1, 'jobId': job['id'], 'status': 'failed', 'consentGranted': False,
              'consentedAt': None, 'answers': [], 'startedAt': clock(), 'completedAt': None,
              'callAnswered': False, 'externalDelivery': False,
              'source': 'asterisk-bluetooth-sim', 'transcriptionStatus': 'not_started',
              'requiresHumanReview': True}
    try:
        spool.validate_prompts(job['language'])
        state, _ = protocol.command('CHANNEL STATUS')
        if state != '6':
            raise Disconnected()
        result['callAnswered'], result['externalDelivery'] = True, True
        # GET DATA returns digit text; STREAM/RECORD interruption codes are ASCII.
        digit, _ = protocol.command(f"GET DATA {quoted(spool.prompt(job['language'], 'consent'))} 12000 1")
        if digit != '1':
            result['status'] = 'declined'
            play(protocol, spool.prompt(job['language'], 'declined'))
            return result
        result['consentGranted'], result['consentedAt'] = True, clock()
        for index in range(1, 5):
            play(protocol, spool.prompt(job['language'], f'q{index}'))
            base = spool.recording_base(job['id'], index)
            # At most 30 seconds. Hash finishes an answer; three silent seconds end it.
            protocol.command(f'RECORD FILE {quoted(base)} wav "#" 30000 0 BEEP s=3')
            result['answers'].append(spool.answer(job['id'], index))
        result['status'] = 'answers_recorded'
        play(protocol, spool.prompt(job['language'], 'thanks'))
    except Disconnected:
        result['status'] = 'disconnected'
    except (ProtocolError, ValueError, OSError, wave.Error, EOFError):
        result['status'] = 'failed'
        result['errorCode'] = 'local_audio_or_protocol_failure'
    finally:
        result['completedAt'] = clock()
    return result


def main():
    os.umask(0o077)
    protocol = AgiProtocol()
    try:
        environment = protocol.environment()
        if len(sys.argv) != 2 or not UUID.fullmatch(sys.argv[1]):
            raise ValueError('invalid_job_id')
        job_id = sys.argv[1].lower()
        if environment.get('agi_arg_1', job_id).lower() != job_id:
            raise ValueError('invalid_agi_job')
        spool = FileSpool()
        job = spool.load(job_id)
        spool.begin(job_id)
    except (ValueError, OSError, ProtocolError, json.JSONDecodeError):
        print('Samarth AGI rejected an invalid or already-started job.', file=sys.stderr)
        return 1
    def disconnected(_number, _frame):
        raise Disconnected()
    if hasattr(signal, 'SIGHUP'):
        signal.signal(signal.SIGHUP, disconnected)
    result = run_session(job, protocol, spool)
    # Do not let a second hangup interrupt the atomic local evidence write.
    if hasattr(signal, 'SIGHUP'):
        signal.signal(signal.SIGHUP, signal.SIG_IGN)
    try:
        spool.save(result)
    except OSError:
        print('Samarth AGI could not save local session evidence.', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
