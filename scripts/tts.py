"""
Phase 2. One audio file per narration line, and their real durations.

The durations are the clock the whole take runs on, so they are measured off
the rendered samples rather than estimated from word count — an estimate that
is 300ms out on every line is nine seconds of drift by the end, and drift is
the thing that makes narration and footage come apart.

    python3 scripts/tts.py

Writes wavs into `recording/audio/` and `recording/audio/durations.json`, which
the driver reads to decide how long to hold each beat.
"""

import json
import os
import pathlib
import sys
import wave

from kokoro_onnx import Kokoro
import soundfile as sf

ROOT = pathlib.Path(__file__).resolve().parent.parent
MODELS = pathlib.Path(
    os.environ.get(
        "KOKORO_DIR",
        "/private/tmp/claude-501/-Volumes-Extreme-SSD-Projects-keeperhub/"
        "b7802fc1-e0d1-457d-9e91-ee852cb82fb2/scratchpad/kokoro",
    )
)
# Which script, and where its audio goes. Defaults to the original take so the
# earlier cut still rebuilds; the terminal take passes its own pair.
SCRIPT = ROOT / (sys.argv[1] if len(sys.argv) > 1 else "scripts/narration.json")
OUT = ROOT / "recording" / (sys.argv[2] if len(sys.argv) > 2 else "audio")
OUT.mkdir(parents=True, exist_ok=True)

spec = json.loads(SCRIPT.read_text())
lines = spec["lines"]

model = MODELS / "kokoro-v1.0.onnx"
voices = MODELS / "voices-v1.0.bin"
if not model.exists() or not voices.exists():
    sys.exit(f"kokoro weights not found in {MODELS}")

kokoro = Kokoro(str(model), str(voices))

durations = {}
total = 0.0
for line in lines:
    samples, rate = kokoro.create(line["text"], voice=spec["voice"], speed=spec.get("speed", 1.0), lang="en-us")
    path = OUT / f"{line['id']}.wav"
    sf.write(path, samples, rate)

    # Measured off the written file, not off len(samples) — if the writer ever
    # resamples, the file is what the player will actually play.
    with wave.open(str(path)) as w:
        seconds = w.getnframes() / float(w.getframerate())
    durations[line["id"]] = round(seconds, 3)
    total += seconds
    print(f"{line['id']:<14} {seconds:6.2f}s  {path.name}")

(OUT / "durations.json").write_text(json.dumps(durations, indent=1) + "\n")
print(f"\n{len(lines)} lines, {total:.1f}s of narration")
print(f"durations → {OUT / 'durations.json'}")
