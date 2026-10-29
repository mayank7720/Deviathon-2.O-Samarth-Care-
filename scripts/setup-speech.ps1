[CmdletBinding()]
param(
    [ValidateSet('base', 'small')][string]$Model = 'base',
    [string]$Python = 'python',
    [switch]$DownloadModel
)
$ErrorActionPreference = 'Stop'
$RepoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$ToolRoot = Join-Path $RepoRoot '.local-tools/speech'
$VenvRoot = Join-Path $ToolRoot 'venv'
$VenvPython = Join-Path $VenvRoot 'Scripts/python.exe'
$Requirements = Join-Path $RepoRoot 'config/speech-requirements.txt'

# Invoke executable paths and distinct arguments directly. No generated shell command.
& $Python -c 'import sys; sys.exit(0 if sys.version_info[:2] in ((3,12),(3,13)) and sys.maxsize > 2**32 else 1)'
if ($LASTEXITCODE -ne 0) { throw 'Use 64-bit Python 3.12 or 3.13; pass its executable with -Python.' }
New-Item -ItemType Directory -Path $ToolRoot -Force | Out-Null
if (-not (Test-Path -LiteralPath $VenvPython)) {
    & $Python -m venv $VenvRoot
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the checkout-local speech virtual environment.' }
}
& $VenvPython -m pip install --disable-pip-version-check --index-url 'https://pypi.org/simple' --only-binary=:all: --requirement $Requirements
if ($LASTEXITCODE -ne 0) { throw 'Local speech dependency installation failed; no global environment was changed.' }
$Installed = & $VenvPython -m pip freeze
if ($LASTEXITCODE -ne 0) { throw 'Could not record installed speech dependencies.' }
$Installed | Set-Content -LiteralPath (Join-Path $ToolRoot 'installed-requirements.txt') -Encoding utf8

if ($DownloadModel) {
    $DownloadScript = @'
import os, sys
from pathlib import Path
root, model = Path(sys.argv[1]).resolve(), sys.argv[2]
sys.path.insert(0, str(root / 'scripts'))
from speech_service import MODEL_FILES, MODEL_REVISIONS, write_model_manifest
from huggingface_hub import snapshot_download
if model not in MODEL_REVISIONS:
    raise SystemExit('Choose an allowed multilingual model.')
os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
os.environ['HF_HUB_DISABLE_IMPLICIT_TOKEN'] = '1'
target = root / '.local-tools' / 'speech' / 'models' / model
target.mkdir(parents=True, exist_ok=True)
snapshot_download(repo_id='Systran/faster-whisper-' + model,
                  revision=MODEL_REVISIONS[model], local_dir=str(target),
                  allow_patterns=list(MODEL_FILES), token=False)
write_model_manifest(target, model)
print('Installed multilingual ' + model + ' at fixed revision ' + MODEL_REVISIONS[model])
'@
    $DownloadScript | & $VenvPython - $RepoRoot $Model
    if ($LASTEXITCODE -ne 0) { throw 'The explicit model download failed. The speech service will not download at runtime.' }
} else {
    Write-Output 'Dependencies installed. To download the chosen public model, rerun with -Model base (or small) -DownloadModel.'
}
Write-Output 'Setup does not create a secret or start a listener. Configure .dev.vars.speech, then run the local service explicitly.'
