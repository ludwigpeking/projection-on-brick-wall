"""Resample the circular soundtrack to exactly 2,922 video frames."""
from pathlib import Path
import subprocess
import sys
import wave

import numpy as np

project_directory = Path(__file__).resolve().parent.parent
audio_path = project_directory / "audio" / "surf-4k-loop.wav"
with wave.open(str(project_directory / "audio" / "surf-loop.wav"), "rb") as source_file:
    source_samples = np.frombuffer(source_file.readframes(source_file.getnframes()), dtype="<i2").reshape(-1, 2)
target_sample_count = 4675200
source_positions = np.arange(target_sample_count, dtype=np.float64) * len(source_samples) / target_sample_count
lower_indices = source_positions.astype(np.int64)
interpolation_factors = (source_positions - lower_indices)[:, None]
target_samples = np.rint(source_samples[lower_indices] * (1 - interpolation_factors) + source_samples[(lower_indices + 1) % len(source_samples)] * interpolation_factors).astype("<i2")
with wave.open(str(audio_path), "wb") as output_file:
    output_file.setnchannels(2)
    output_file.setsampwidth(2)
    output_file.setframerate(48000)
    output_file.writeframes(target_samples.tobytes())
print("Prepared exact 97.4-second circular soundtrack", flush=True)
for orientation in sys.argv[1:]:
    video_path = project_directory / "exports" / f"brick-ghosts-4k-{orientation}.mp4"
    temporary_path = video_path.with_name(video_path.stem + "-aligned.mp4")
    subprocess.run([
        "ffmpeg", "-hide_banner", "-v", "error", "-y", "-i", str(video_path),
        "-i", str(audio_path), "-map", "0:v:0", "-map", "1:a:0",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "320k", "-af", "volume=0.55",
        "-t", "97.4", "-movflags", "+faststart", str(temporary_path)
    ], check=True)
    temporary_path.replace(video_path)
    settings_path = project_directory / "exports" / "support" / f"{orientation}-settings.json"
    if settings_path.exists():
        import json
        configuration = json.loads(settings_path.read_text())
        configuration["audio"] = "surf-4k-loop.wav"
        configuration["audioDurationSeconds"] = 97.4
        settings_path.write_text(json.dumps(configuration, indent=2))
    print("Aligned " + orientation, flush=True)
