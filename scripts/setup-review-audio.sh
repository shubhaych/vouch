#!/usr/bin/env bash
# Isolated local Python dependencies. No credentials or system Python changes.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 -m venv .venv-review
.venv-review/bin/python3 -m pip install -r worker/tools/requirements.txt
# Download once now, rather than during the first customer's review.
.venv-review/bin/python3 -c 'import os; from faster_whisper import WhisperModel; WhisperModel(os.environ.get("WHISPER_MODEL", "small"), device="cpu", compute_type="int8"); print("Transcriber ready. Restart the worker.")'
