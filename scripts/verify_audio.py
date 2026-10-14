"""Check delivered soundtrack duration, channel count, headroom, and signal energy."""
from pathlib import Path
import json
import wave
import numpy as np

measurements = []
for audio_path in sorted((Path(__file__).resolve().parent.parent / "audio").glob("*.wav")):
    with wave.open(str(audio_path)) as audio_file:
        duration_seconds = audio_file.getnframes() / audio_file.getframerate()
        samples = np.frombuffer(audio_file.readframes(audio_file.getnframes()), dtype="<i2").astype(float) / 32768
        peak_amplitude = float(np.max(np.abs(samples)))
        root_mean_square_amplitude = float(np.sqrt(np.mean(samples * samples)))
        assert 90 <= duration_seconds <= 120
        assert audio_file.getnchannels() == 2
        assert 0.1 < peak_amplitude < 0.95
        assert root_mean_square_amplitude > 0.01
        measurements.append(dict(file=audio_path.name, duration_seconds=round(duration_seconds,4), sample_rate=audio_file.getframerate(), channels=audio_file.getnchannels(), peak=round(peak_amplitude,5), rms=round(root_mean_square_amplitude,5)))
print(json.dumps(measurements, indent=2))
(Path(__file__).resolve().parent.parent / "audio" / "verification.json").write_text(json.dumps(measurements, indent=2))
