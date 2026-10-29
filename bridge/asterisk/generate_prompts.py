#!/usr/bin/env python3
"""Optional, explicit local generation. Requires installed espeak-ng and ffmpeg."""
import argparse
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import wave


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True, help='Local staging directory; never overwrites WAV files.')
    arguments = parser.parse_args()
    tools = {name: shutil.which(name) for name in ('espeak-ng', 'ffmpeg')}
    if not all(tools.values()):
        parser.error('Install or provide espeak-ng and ffmpeg yourself before running this optional generator.')
    scripts = json.loads(Path(__file__).with_name('prompts.json').read_text(encoding='utf-8'))
    target = arguments.output.resolve()
    expected = [target / language / f'{name}.wav' for language in ('hi', 'en') for name in scripts[language]]
    if any(path.exists() for path in expected):
        parser.error('A target WAV already exists. Choose a fresh output directory to preserve reviewed recordings.')
    for language in ('hi', 'en'):
        directory = target / language
        directory.mkdir(parents=True, exist_ok=True)
        for name, text in scripts[language].items():
            destination = directory / f'{name}.wav'
            with tempfile.TemporaryDirectory() as work:
                source = Path(work) / 'source.wav'
                subprocess.run([tools['espeak-ng'], '-v', language, '-s', '145', '-w', str(source), '--stdin'],
                               input=text, text=True, encoding='utf-8', check=True, capture_output=True)
                subprocess.run([tools['ffmpeg'], '-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-i', str(source),
                                '-ar', '8000', '-ac', '1', '-c:a', 'pcm_s16le', str(destination)], check=True, capture_output=True)
            with wave.open(str(destination), 'rb') as audio:
                duration = audio.getnframes() / audio.getframerate()
                if duration > (55 if name == 'consent' else 30):
                    raise SystemExit('A generated prompt exceeds the call time budget. Review the speaking rate or record the script yourself.')
    print('Created fourteen local WAV prompts. Listen to both languages and approve pronunciation before installation.')


if __name__ == '__main__':
    main()
