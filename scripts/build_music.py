"""Original procedural rock sketches. No recordings or third-party music samples."""
from pathlib import Path
import json
import wave
import numpy as np

SAMPLE_RATE = 32000
OUTPUT_DIRECTORY = Path(__file__).resolve().parent.parent / "audio"
OUTPUT_DIRECTORY.mkdir(exist_ok=True)
random_generator = np.random.default_rng(721)

OPTIONS = [
    dict(key="surf", name="Gothic surf rock", tempo=138, bars=56, root=45, description="Tremolo-picked minor runs, spring-like echoes, restless drums."),
    dict(key="doom", name="Slow doom rock", tempo=88, bars=40, root=33, description="Low power chords, half-time weight, long haunted spaces."),
    dict(key="industrial", name="Industrial horror rock", tempo=120, bars=48, root=38, description="Muted distorted pulses, metallic accents, insistent backbeat."),
]

def frequency_from_note(note_number):
    return 440 * 2 ** ((note_number - 69) / 12)

def string_note(note_number, duration_seconds, muted=False):
    sample_times = np.arange(int(duration_seconds * SAMPLE_RATE)) / SAMPLE_RATE
    fundamental_frequency = frequency_from_note(note_number)
    waveform = np.zeros_like(sample_times)
    for harmonic_number in range(1, 18):
        harmonic_frequency = fundamental_frequency * harmonic_number * (1 + 0.000018 * harmonic_number ** 2)
        harmonic_amplitude = np.sin(harmonic_number * 0.38) / harmonic_number ** 0.9
        decay_rate = (5 if muted else 1.6) + harmonic_number * 0.32
        waveform += harmonic_amplitude * np.sin(2 * np.pi * harmonic_frequency * sample_times) * np.exp(-sample_times * decay_rate)
    waveform = np.tanh(waveform * (2.8 if muted else 1.6))
    envelope = np.minimum(sample_times / 0.004, 1) * np.minimum((duration_seconds - sample_times) / 0.055, 1)
    return waveform * np.maximum(envelope, 0)

def percussion(kind):
    duration_seconds = {"kick":0.45, "snare":0.3, "hat":0.11, "crash":1.9}[kind]
    sample_times = np.arange(int(duration_seconds * SAMPLE_RATE)) / SAMPLE_RATE
    noise = random_generator.normal(0, 1, len(sample_times))
    high_noise = noise - np.roll(noise, 1)
    if kind == "kick":
        phase = 2 * np.pi * (44 * sample_times + 95 * 0.022 * (1 - np.exp(-sample_times / 0.022)))
        waveform = np.sin(phase) * np.exp(-sample_times * 10) + 0.055 * high_noise * np.exp(-sample_times * 150)
    elif kind == "snare":
        waveform = 0.35 * noise * np.exp(-sample_times * 20) + 0.24 * np.sin(2 * np.pi * 185 * sample_times) * np.exp(-sample_times * 28)
    elif kind == "hat":
        waveform = 0.1 * high_noise * np.exp(-sample_times * 65)
    else:
        waveform = 0.12 * high_noise * np.exp(-sample_times * 3.8)
    return waveform * np.minimum(sample_times / 0.001, 1)

drum_samples = {kind:percussion(kind) for kind in ["kick", "snare", "hat", "crash"]}
metadata = []
for option in OPTIONS:
    beat_duration_seconds = 60 / option["tempo"]
    duration_seconds = option["bars"] * 4 * beat_duration_seconds
    stereo_mix = np.zeros((int(duration_seconds * SAMPLE_RATE), 2), dtype=np.float32)
    def add_sound(waveform, start_seconds, amplitude, pan=0):
        start_sample = int(start_seconds * SAMPLE_RATE)
        available_samples = min(len(waveform), len(stereo_mix) - start_sample)
        if available_samples <= 0 or start_sample < 0:
            return
        stereo_mix[start_sample:start_sample + available_samples, 0] += waveform[:available_samples] * amplitude * np.sqrt((1 - pan) / 2)
        stereo_mix[start_sample:start_sample + available_samples, 1] += waveform[:available_samples] * amplitude * np.sqrt((1 + pan) / 2)
    for bar_index in range(option["bars"]):
        section_progress = bar_index / option["bars"]
        section_amplitude = 0.35 if section_progress < 0.12 else (0.72 if section_progress < 0.48 else 1)
        if section_progress > 0.88:
            section_amplitude *= max(0.08, (1 - section_progress) / 0.12)
        root_note = option["root"] + [0, 0, 1, -2, 0, -5, 1, -2][(bar_index // 2) % 8]
        for beat_index in range(4):
            onset_seconds = (bar_index * 4 + beat_index) * beat_duration_seconds
            if beat_index in [0, 2]:
                add_sound(drum_samples["kick"], onset_seconds, 0.65 * section_amplitude)
            if beat_index in ([2] if option["key"] == "doom" else [1, 3]):
                add_sound(drum_samples["snare"], onset_seconds, 0.6 * section_amplitude, 0.12)
            for half_beat in range(2):
                add_sound(drum_samples["hat"], onset_seconds + half_beat * beat_duration_seconds / 2, section_amplitude * (0.7 if half_beat else 1), -0.3)
            bass_times = np.arange(int(beat_duration_seconds * 0.9 * SAMPLE_RATE)) / SAMPLE_RATE
            bass_frequency = frequency_from_note(root_note - 12)
            bass_waveform = (np.sin(2 * np.pi * bass_frequency * bass_times) + 0.2 * np.sin(4 * np.pi * bass_frequency * bass_times)) * np.exp(-bass_times * 3)
            bass_waveform *= np.minimum(bass_times / 0.006, 1) * np.minimum((bass_times[-1] - bass_times) / 0.035, 1)
            add_sound(bass_waveform, onset_seconds, 0.25 * section_amplitude)
        if bar_index % 4 == 0:
            add_sound(drum_samples["crash"], bar_index * 4 * beat_duration_seconds, section_amplitude, 0.4)
        note_count = 16 if option["key"] == "surf" else (8 if option["key"] == "industrial" else 2)
        for note_index in range(note_count):
            note_start_seconds = (bar_index * 4 + note_index * 4 / note_count) * beat_duration_seconds
            note_duration_seconds = beat_duration_seconds * (0.7 if note_count > 2 else 2.5)
            if option["key"] == "surf":
                interval = [12, 12, 19, 19, 15, 15, 13, 13, 12, 12, 11, 11, 7, 7, 13, 11][note_index]
                lead_waveform = string_note(root_note + interval, note_duration_seconds)
                add_sound(lead_waveform, note_start_seconds, 0.19 * section_amplitude, -0.4)
                add_sound(lead_waveform, note_start_seconds + beat_duration_seconds * 0.75, 0.075 * section_amplitude, 0.6)
                add_sound(lead_waveform, note_start_seconds + beat_duration_seconds * 1.5, 0.033 * section_amplitude, -0.6)
            else:
                interval = [0, 0, 0, 1, 0, 0, 6, 1][note_index % 8] if note_count == 8 else 0
                chord_waveform = string_note(root_note + interval, note_duration_seconds, note_count == 8)
                chord_waveform += 0.6 * string_note(root_note + interval + 7, note_duration_seconds, note_count == 8)
                add_sound(chord_waveform, note_start_seconds, 0.17 * section_amplitude, -0.45)
                add_sound(chord_waveform, note_start_seconds + 0.012, 0.13 * section_amplitude, 0.45)
        if option["key"] == "surf":
            rhythm_chord = string_note(root_note, beat_duration_seconds * 1.5, True) + 0.6 * string_note(root_note + 7, beat_duration_seconds * 1.5, True)
            for chord_beat in [0, 2]:
                add_sound(rhythm_chord, (bar_index * 4 + chord_beat) * beat_duration_seconds, 0.1 * section_amplitude, 0.45)
        if bar_index % 8 == 7 and section_progress > 0.16:
            for fill_index in range(4):
                add_sound(drum_samples["snare"], (bar_index * 4 + 3 + fill_index / 4) * beat_duration_seconds, 0.22 * section_amplitude, (fill_index - 1.5) / 4)
    # Small unequal reflections approximate the spring-room character of a scratch demo.
    for delay_seconds, reflection_amplitude in [(0.071,0.13),(0.113,0.09),(0.181,0.065)]:
        delay_samples = int(delay_seconds * SAMPLE_RATE)
        stereo_mix[delay_samples:] += stereo_mix[:-delay_samples, ::-1] * reflection_amplitude
    fade_sample_count = int(2 * SAMPLE_RATE)
    stereo_mix[:fade_sample_count] *= np.linspace(0,1,fade_sample_count)[:,None]
    stereo_mix[-fade_sample_count:] *= np.linspace(1,0,fade_sample_count)[:,None]
    stereo_mix = np.tanh(stereo_mix * 1.2)
    peak_amplitude = float(np.max(np.abs(stereo_mix)))
    stereo_mix *= 0.88 / max(peak_amplitude, 0.001)
    with wave.open(str(OUTPUT_DIRECTORY / (option["key"] + ".wav")), "wb") as audio_file:
        audio_file.setnchannels(2)
        audio_file.setsampwidth(2)
        audio_file.setframerate(SAMPLE_RATE)
        audio_file.writeframes((stereo_mix * 32767).astype("<i2").tobytes())
    metadata.append({**option, "duration":duration_seconds, "file":"audio/" + option["key"] + ".wav", "peak":float(np.max(np.abs(stereo_mix)))})
    print(option["key"], round(duration_seconds,2), "seconds", flush=True)
(OUTPUT_DIRECTORY / "options.json").write_text(json.dumps(metadata,indent=2))
