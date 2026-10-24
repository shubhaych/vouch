# worker/tools

Scripts the video reviewer runs. Droid may **run** anything here (`python3 ../../tools/probes/<name>.py …` from inside its case folder) but can never **write** here: the permission fence only allows writes under `cases/<claimId>/work/` (Case Analyst), `proof/` (Proof Builder) and `work/audit_test.py` (Report Auditor).

| script | what it measures | needs |
| --- | --- | --- |
| `transcribe.py` | word-timed transcript (faster-whisper small, int8) | `pip install faster-whisper` (otherwise the report says "no transcript") |
| `probes/luminance.py` | mean brightness of a region over time, jumps, when it lit up | ffmpeg, numpy, Pillow |
| `probes/audio_presence.py` | loudness per 100 ms, sound segments and onsets | numpy |
| `probes/claim_alignment.py` | where each spoken claim was said, the words around it | – |
| `probes/contradiction_markers.py` | brightness jumps / sound onsets near each claim, with a hint | the two probes above |
| `probes/part_motion.py` | frame-to-frame change inside a region (hinges, buttons, loose parts) | ffmpeg, numpy |
| `probes/recapture.py` | periodic-grid score of a frame (screen recapture hint) | numpy, Pillow |
| `probes/ocr.py` | text in a frame region (labels, serials) | tesseract |

Every probe prints one JSON object and writes the same JSON to `--out`; charts are PNGs under `work/` that the analyst registers with `add_artifact` so a finding can cite them. Outputs are measurements: a probe never decides anything about a person.
