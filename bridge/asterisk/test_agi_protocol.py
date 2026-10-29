"""Offline protocol and spool checks, invoked by the Node test suite. No Asterisk."""
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile

spec = importlib.util.spec_from_file_location('checkin_agi', Path(__file__).with_name('samarth_checkin.py'))
agi = importlib.util.module_from_spec(spec)
spec.loader.exec_module(agi)
JOB_ID = '33333333-3333-4333-8333-333333333333'
NOW = 1800000000000
JOB = {'id': JOB_ID, 'dialNumber': '+919000000001', 'language': 'hi', 'approved': True, 'expiresAt': NOW + 60000}


class MemorySpool:
    def __init__(self):
        self.audio_requests = []

    def validate_prompts(self, _language):
        return None

    def prompt(self, language, name):
        return f'/var/lib/asterisk/sounds/samarth/{language}/{name}'

    def recording_base(self, job_id, index):
        self.audio_requests.append(index)
        return f'/var/lib/samarth/recordings/{job_id}/q{index}'

    def answer(self, job_id, index):
        return {'questionId': agi.QUESTIONS[index - 1], 'path': f'/var/lib/samarth/recordings/{job_id}/q{index}.wav',
                'durationSeconds': 2, 'sampleRate': 8000, 'channels': 1, 'sampleWidth': 2}


class FakeProtocol:
    def __init__(self, consent='1', disconnect_record=None, playback_ok=True, channel='6'):
        self.commands, self.consent, self.disconnect_record = [], consent, disconnect_record
        self.playback_ok, self.channel = playback_ok, channel

    def command(self, command):
        self.commands.append(command)
        if command == 'CHANNEL STATUS':
            return self.channel, ''
        if command.startswith('GET DATA '):
            if self.consent == '-1':
                raise agi.Disconnected()
            return self.consent, ''
        if command.startswith('GET VARIABLE '):
            return '1', '(SUCCESS)' if self.playback_ok else '(FAILED)'
        if command.startswith('RECORD FILE ') and self.disconnect_record == sum(c.startswith('RECORD FILE ') for c in self.commands):
            raise agi.Disconnected()
        return '0', ''


checks = 0
def check(condition):
    global checks
    assert condition
    checks += 1


protocol, spool = FakeProtocol(), MemorySpool()
result = agi.run_session(JOB, protocol, spool)
check(result['status'] == 'answers_recorded' and result['consentGranted'])
check(len(result['answers']) == 4 and result['completedAt'] is not None)
records = [command for command in protocol.commands if command.startswith('RECORD FILE ')]
check(len(records) == 4 and all(command.endswith('wav "#" 30000 0 BEEP s=3') for command in records))
check(protocol.commands.index(records[0]) > next(i for i, command in enumerate(protocol.commands) if command.startswith('GET DATA ')))
for digit in ('9', '0', '2', ''):
    protocol, spool = FakeProtocol(consent=digit), MemorySpool()
    result = agi.run_session(JOB, protocol, spool)
    check(result['status'] == 'declined' and not result['consentGranted'] and not result['answers'])
    check(not spool.audio_requests and not any(command.startswith('RECORD FILE ') for command in protocol.commands))
protocol, spool = FakeProtocol(consent='-1'), MemorySpool()
result = agi.run_session(JOB, protocol, spool)
check(result['status'] == 'disconnected' and not spool.audio_requests and not result['consentGranted'])
protocol, spool = FakeProtocol(disconnect_record=2), MemorySpool()
result = agi.run_session(JOB, protocol, spool)
check(result['status'] == 'disconnected' and result['consentGranted'] and len(result['answers']) == 1)
protocol, spool = FakeProtocol(playback_ok=False), MemorySpool()
result = agi.run_session(JOB, protocol, spool)
check(result['status'] == 'failed' and not spool.audio_requests)
protocol, spool = FakeProtocol(channel='5'), MemorySpool()
result = agi.run_session(JOB, protocol, spool)
check(result['status'] == 'disconnected' and not result['callAnswered'] and not spool.audio_requests)

transport = agi.AgiProtocol(io.StringIO('agi_channel: Mobile/test\nagi_arg_1: ' + JOB_ID + '\n\n200 result=1\n'), io.StringIO())
check(transport.environment()['agi_arg_1'] == JOB_ID)
check(transport.command('GET DATA "fixed/consent" 12000 1') == ('1', ''))
for response in ('HANGUP\n', '200 result=-1\n', ''):
    try:
        agi.AgiProtocol(io.StringIO(response), io.StringIO()).command('CHANNEL STATUS')
        raise AssertionError('disconnect was accepted')
    except agi.Disconnected:
        checks += 1
try:
    agi.AgiProtocol(io.StringIO('510 Invalid command\n'), io.StringIO()).command('CHANNEL STATUS')
    raise AssertionError('invalid protocol accepted')
except agi.ProtocolError:
    checks += 1
check(agi.validate_job(JOB, JOB_ID, now=NOW)['id'] == JOB_ID)
for changed in ({'approved': False}, {'expiresAt': NOW}, {'expiresAt': NOW + 86400001}, {'dialNumber': '+9190;System(x)'}, {'path': '/tmp/evil'}, {'language': 'hi\nEXEC System'}, {'version': True}):
    try:
        agi.validate_job({**JOB, **changed}, JOB_ID, now=NOW)
        raise AssertionError('invalid manifest accepted')
    except ValueError:
        checks += 1
try:
    agi.validate_job(JOB, '../../etc/passwd', now=NOW)
    raise AssertionError('path traversal accepted')
except ValueError:
    checks += 1
with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    (root / 'jobs').mkdir()
    spool = agi.FileSpool(root, root / 'prompts')
    spool.begin(JOB_ID)
    try:
        spool.begin(JOB_ID)
        raise AssertionError('second session was accepted')
    except FileExistsError:
        checks += 1
    spool.save({'version': 1, 'jobId': JOB_ID, 'status': 'declined', 'consentGranted': False, 'answers': []})
    check(json.loads((root / 'results' / f'{JOB_ID}.json').read_text())['status'] == 'declined')
    check(not (root / 'recordings').exists())
print(json.dumps({'checks': checks, 'callsStarted': 0, 'networkRequests': 0}))
