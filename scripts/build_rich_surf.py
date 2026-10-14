"""Layered original gothic surf arrangement, synthesized locally without samples."""
from pathlib import Path
from functools import lru_cache
import json
import sys
import shutil
import wave
import numpy as np

LOOP_MODE = "--loop" in sys.argv
SAMPLE_RATE = 32000
TEMPO = 138
BAR_COUNT = 56
BEAT_SECONDS = 60 / TEMPO
DURATION_SECONDS = BAR_COUNT * 4 * BEAT_SECONDS
OUTPUT_DIRECTORY = Path(__file__).resolve().parent.parent / "audio"
random_generator = np.random.default_rng(72119)
sample_count = int(DURATION_SECONDS * SAMPLE_RATE)
instrument_buses = {name: np.zeros((sample_count, 2), dtype=np.float32)
                   for name in ["guitars", "lead", "organ", "bass", "drums"]}


def frequency(note_number):
    return 440 * 2 ** ((note_number - 69) / 12)


def envelope(sample_times, duration_seconds, attack_seconds, release_seconds):
    return np.minimum(sample_times / attack_seconds, 1) * np.clip(
        (duration_seconds - sample_times) / release_seconds, 0, 1)


@lru_cache(maxsize=512)
def guitar(note_number, duration_seconds, muted=False, detune_cents=0):
    sample_times = np.arange(int(duration_seconds * SAMPLE_RATE)) / SAMPLE_RATE
    fundamental = frequency(note_number) * 2 ** (detune_cents / 1200)
    vibration_phase = 2 * np.pi * fundamental * sample_times
    vibration_phase += 0.018 * np.sin(2 * np.pi * 5.1 * sample_times)
    waveform = np.zeros_like(sample_times)
    for harmonic_number in range(1, 19):
        # Pick position, independently decaying partials, and a short pick transient.
        amplitude = np.sin(harmonic_number * 0.41) / harmonic_number ** 1.1
        decay_rate = (8.5 if muted else 1.7) + harmonic_number * 0.25
        waveform += amplitude * np.sin(vibration_phase * harmonic_number) * np.exp(-sample_times * decay_rate)
    waveform = np.tanh(waveform * (2.4 if muted else 1.8))
    # Guitar-cabinet rolloff, applied to the generated note rather than the master.
    spectrum = np.fft.rfft(waveform)
    frequencies = np.fft.rfftfreq(len(waveform), 1 / SAMPLE_RATE)
    spectrum *= 1 / np.sqrt(1 + (frequencies / 3600) ** 6)
    waveform = np.fft.irfft(spectrum, n=len(waveform))
    return (waveform * envelope(sample_times, duration_seconds, 0.003, 0.065)).astype(np.float32)


def organ(note_number, duration_seconds, phase_offset):
    sample_times = np.arange(int(duration_seconds * SAMPLE_RATE)) / SAMPLE_RATE
    fundamental = frequency(note_number)
    phase = 2 * np.pi * fundamental * sample_times + 0.04 * np.sin(2 * np.pi * 4.6 * sample_times + phase_offset)
    waveform = (np.sin(phase) + 0.35 * np.sin(phase * 2) + 0.2 * np.sin(phase * 3)
                + 0.12 * np.sin(phase * 4) + 0.09 * np.sin(phase * 6))
    waveform *= 0.88 + 0.12 * np.sin(2 * np.pi * 3.4 * sample_times + phase_offset)
    return waveform * envelope(sample_times, duration_seconds, 0.12, 0.35)


@lru_cache(maxsize=128)
def bass(note_number, duration_seconds):
    sample_times = np.arange(int(duration_seconds * SAMPLE_RATE)) / SAMPLE_RATE
    phase = 2 * np.pi * frequency(note_number) * sample_times
    waveform = np.sin(phase) + 0.28 * np.sin(2 * phase) + 0.13 * np.sin(3 * phase)
    waveform *= np.exp(-sample_times * 1.8)
    return np.tanh(waveform * 1.2) * envelope(sample_times, duration_seconds, 0.005, 0.035)


def drum(kind, variation):
    duration_seconds = {"kick": 0.45, "snare": 0.30, "hat": 0.09,
                        "open_hat": 0.45, "ride": 0.75, "crash": 2.4,
                        "tom_high": 0.45, "tom_low": 0.65}[kind]
    sample_times = np.arange(int(duration_seconds * SAMPLE_RATE)) / SAMPLE_RATE
    noise = random_generator.normal(0, 1, len(sample_times))
    high_noise = noise - np.roll(noise, 1)
    if kind == "kick":
        phase = 2 * np.pi * (46 * sample_times + 95 * 0.02 * (1 - np.exp(-sample_times / 0.02)))
        waveform = np.sin(phase) * np.exp(-sample_times * 11) + high_noise * 0.035 * np.exp(-sample_times * 160)
    elif kind == "snare":
        waveform = noise * 0.37 * np.exp(-sample_times * 19)
        waveform += np.sin(2 * np.pi * (178 + variation * 3) * sample_times) * 0.23 * np.exp(-sample_times * 22)
    elif kind.startswith("tom"):
        fundamental = 142 if kind == "tom_high" else 94
        phase = 2 * np.pi * (fundamental * sample_times + 25 * 0.04 * (1 - np.exp(-sample_times / 0.04)))
        waveform = np.sin(phase) * np.exp(-sample_times * 8) + noise * 0.06 * np.exp(-sample_times * 50)
    else:
        decay_rate = {"hat": 75, "open_hat": 11, "ride": 6, "crash": 2.5}[kind]
        waveform = high_noise * 0.12 * np.exp(-sample_times * decay_rate)
        if kind == "ride":
            waveform += np.sin(2 * np.pi * 2371 * sample_times) * 0.07 * np.exp(-sample_times * 8)
    return (waveform * np.minimum(sample_times / 0.001, 1)).astype(np.float32)


drum_samples = {kind: [drum(kind, variation) for variation in range(4)]
               for kind in ["kick", "snare", "hat", "open_hat", "ride", "crash", "tom_high", "tom_low"]}


def add(instrument, waveform, start_seconds, amplitude, pan=0):
    start_sample = max(0, int(start_seconds * SAMPLE_RATE))
    available_samples = min(len(waveform), sample_count - start_sample)
    if available_samples <= 0:
        return
    instrument_buses[instrument][start_sample:start_sample + available_samples, 0] += waveform[:available_samples] * amplitude * np.sqrt((1 - pan) / 2)
    instrument_buses[instrument][start_sample:start_sample + available_samples, 1] += waveform[:available_samples] * amplitude * np.sqrt((1 + pan) / 2)
    if LOOP_MODE and available_samples < len(waveform):
        wrapped_waveform = waveform[available_samples:]
        instrument_buses[instrument][:len(wrapped_waveform), 0] += wrapped_waveform * amplitude * np.sqrt((1 - pan) / 2)
        instrument_buses[instrument][:len(wrapped_waveform), 1] += wrapped_waveform * amplitude * np.sqrt((1 + pan) / 2)


def hit(kind, beat_position, amplitude, pan=0):
    add("drums", drum_samples[kind][int(beat_position * 7) % 4], beat_position * BEAT_SECONDS, amplitude, pan)


# Voicings include thirds, sevenths, and ninths, rather than only power chords.
chords = {
    "Am9": (33, [57, 60, 64, 67, 71]),
    "Fmaj7": (29, [57, 60, 64, 65]),
    "Dm9": (38, [57, 60, 64, 65, 69]),
    "E7b9": (28, [56, 59, 62, 65, 68]),
    "Cmaj7": (36, [55, 59, 60, 64]),
    "Bbmaj7": (34, [57, 58, 62, 65]),
    "Dm6": (38, [57, 59, 62, 65]),
    "E7": (28, [56, 59, 62, 64]),
}
progression_a = ["Am9", "Am9", "Fmaj7", "Dm9", "Am9", "Cmaj7", "Dm6", "E7b9"]
progression_b = ["Fmaj7", "Cmaj7", "Dm9", "E7", "Am9", "Bbmaj7", "Dm6", "E7b9"]
arrangement = []
for bar_index in range(BAR_COUNT):
    bar_beat = bar_index * 4
    progression = progression_b if 24 <= bar_index < 40 else progression_a
    chord_name = progression[bar_index % 8]
    if bar_index == BAR_COUNT - 1 and not LOOP_MODE:
        chord_name = "Am9"
    root_note, chord_notes = chords[chord_name]
    arrangement.append({"bar": bar_index + 1, "chord": chord_name})
    energy = 0.76 if bar_index < 8 else 0.9 if bar_index < 24 else 1.0
    last_bar = bar_index == BAR_COUNT - 1 and not LOOP_MODE

    # Full backbeat from the beginning, with syncopation and varied phrase endings.
    kick_beats = [0, 2, 2.75] if bar_index % 2 else [0, 1.5, 2, 3.5]
    for beat_offset in ([0] if last_bar else kick_beats):
        hit("kick", bar_beat + beat_offset, 0.54 * energy)
    for beat_offset in ([] if last_bar else [1, 3]):
        hit("snare", bar_beat + beat_offset, 0.56 * energy, 0.07)
    if bar_index % 2 and not last_bar:
        hit("snare", bar_beat + 2.75, 0.12 * energy, 0.1)
    for eighth_index in range(1 if last_bar else 8):
        cymbal = "ride" if bar_index >= 32 and eighth_index % 2 == 0 else "hat"
        if eighth_index == 7 and bar_index % 2:
            cymbal = "open_hat"
        hit(cymbal, bar_beat + eighth_index / 2, (0.7 if eighth_index % 2 == 0 else 0.42) * energy, -0.32 if cymbal != "ride" else 0.4)
    if bar_index % 8 == 0 or last_bar:
        hit("crash", bar_beat, 0.82 * energy, 0.45)
    if bar_index % 4 == 3 and not last_bar:
        for fill_index, kind in enumerate(["snare", "tom_high", "tom_high", "tom_low"]):
            hit(kind, bar_beat + 3 + fill_index / 4, (0.16 + fill_index * 0.045) * energy, -0.35 + fill_index * 0.22)

    # Walking pickups and fifth/octave motion give the bass its own part.
    bass_intervals = [0, 0, 7, 12, 0, 7, 10 if "7" in chord_name else 12, -1 if bar_index % 2 else 7]
    for eighth_index in range(1 if last_bar else 8):
        bass_duration = 2.8 * BEAT_SECONDS if last_bar else 0.43 * BEAT_SECONDS
        add("bass", bass(root_note + bass_intervals[eighth_index], bass_duration),
            (bar_beat + eighth_index / 2) * BEAT_SECONDS, 0.25 * energy)

    # Two independently strummed guitar parts, with different voicings and attacks.
    for side_index, pan in enumerate([-0.7, 0.68]):
        rhythm_offsets = [0] if last_bar else ([0, 1.5, 2, 3.5] if side_index == 0 else [0.5, 1, 2.5, 3])
        for stroke_index, beat_offset in enumerate(rhythm_offsets):
            note_order = chord_notes if stroke_index % 2 == 0 else chord_notes[::-1]
            for note_index, note_number in enumerate(note_order):
                note_duration = 3.7 * BEAT_SECONDS if last_bar else (0.95 if stroke_index % 2 == 0 else 0.55) * BEAT_SECONDS
                add("guitars", guitar(note_number - (12 if side_index == 0 else 0), note_duration, not last_bar, -4 if side_index == 0 else 4),
                    (bar_beat + beat_offset) * BEAT_SECONDS + note_index * 0.008 + side_index * 0.012,
                    0.053 * energy, pan)

    # Sustained organ moves through the upper chord voices beneath the guitars.
    for voice_index, note_number in enumerate(chord_notes[1:]):
        add("organ", organ(note_number, BEAT_SECONDS * 4.4, bar_index + voice_index),
            bar_beat * BEAT_SECONDS, (0.019 if bar_index < 8 else 0.027) * energy,
            -0.45 + voice_index * 0.28)

    # A recognizable motif changes its ending with each chord, with tremolo bursts.
    lead_notes = [chord_notes[-2] + 12, chord_notes[-1] + 12,
                  chord_notes[-2] + 12, chord_notes[1] + 12,
                  chord_notes[2] + 12, chord_notes[1] + 12,
                  chord_notes[0] + 12, chord_notes[1] + 11]
    for eighth_index in range(1 if last_bar else 8):
        note_number = lead_notes[(eighth_index + (2 if bar_index % 4 == 2 else 0)) % 8]
        if last_bar:
            note_number = 81
        repetitions = 2 if not last_bar and (eighth_index < 2 or bar_index >= 32) else 1
        for repetition_index in range(repetitions):
            onset_seconds = (bar_beat + eighth_index / 2 + repetition_index / 4) * BEAT_SECONDS
            note_duration = BEAT_SECONDS * (3.5 if last_bar else 0.58 if repetitions == 1 else 0.32)
            add("lead", guitar(note_number, note_duration), onset_seconds,
                0.105 * energy * (1 if repetition_index == 0 else 0.8), -0.15)
    # Countermelody answers in the second half, avoiding a continuous unison wall.
    if bar_index >= 24 and not last_bar:
        for answer_index in range(4):
            add("lead", guitar(chord_notes[answer_index % len(chord_notes)] + 12, BEAT_SECONDS * 0.85, False, 3),
                (bar_beat + 0.75 + answer_index * 0.75) * BEAT_SECONDS, 0.049 * energy, 0.6)


def add_reflections(instrument, reflections):
    original = instrument_buses[instrument].copy()
    for delay_seconds, amplitude in reflections:
        delay_samples = int(delay_seconds * SAMPLE_RATE)
        if LOOP_MODE:
            instrument_buses[instrument] += np.roll(original[:, ::-1], delay_samples, axis=0) * amplitude
        else:
            instrument_buses[instrument][delay_samples:] += original[:-delay_samples, ::-1] * amplitude


add_reflections("lead", [(BEAT_SECONDS * 0.75, 0.27), (BEAT_SECONDS * 1.5, 0.13), (0.071, 0.16), (0.113, 0.10)])
add_reflections("guitars", [(0.037, 0.10), (0.079, 0.08), (0.137, 0.045)])
add_reflections("organ", [(0.093, 0.18), (0.181, 0.10)])
add_reflections("drums", [(0.029, 0.08), (0.067, 0.045)])
stereo_mix = sum(instrument_buses.values())
stereo_mix -= np.mean(stereo_mix, axis=0)
stereo_mix = np.tanh(stereo_mix * 1.15)
stereo_mix *= 0.89 / max(0.001, float(np.max(np.abs(stereo_mix))))
if not LOOP_MODE:
    stereo_mix[:160] *= np.linspace(0, 1, 160)[:, None]
    stereo_mix[-int(SAMPLE_RATE * 0.08):] *= np.linspace(1, 0, int(SAMPLE_RATE * 0.08))[:, None]
original_path = OUTPUT_DIRECTORY / "surf-original.wav"
if not original_path.exists() and (OUTPUT_DIRECTORY / "surf.wav").exists():
    shutil.copy2(OUTPUT_DIRECTORY / "surf.wav", original_path)
with wave.open(str(OUTPUT_DIRECTORY / ("surf-loop.wav" if LOOP_MODE else "surf.wav")), "wb") as audio_file:
    audio_file.setnchannels(2)
    audio_file.setsampwidth(2)
    audio_file.setframerate(SAMPLE_RATE)
    audio_file.writeframes((stereo_mix * 32767).astype("<i2").tobytes())
(OUTPUT_DIRECTORY / ("surf-loop-arrangement.json" if LOOP_MODE else "surf-arrangement.json")).write_text(json.dumps({
    "tempo": TEMPO, "duration": DURATION_SECONDS, "arrangement": arrangement,
    "instruments": list(instrument_buses), "source": "Original local synthesis; no sampled recordings"
}, indent=2))
print(f"Rendered rich gothic surf: {DURATION_SECONDS:.2f}s, {BAR_COUNT} bars, 5 layered instrument buses", flush=True)
