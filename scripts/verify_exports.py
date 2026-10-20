"""Check completed projection deliverables and save compact QA evidence."""
import json
from pathlib import Path
import subprocess
import sys

import numpy as np
from PIL import Image

output_directory = Path(__file__).resolve().parent.parent / "exports"
orientations = sys.argv[1:] or ["portrait", "landscape"]
for orientation in orientations:
    assert orientation in ["portrait", "landscape", "preview"]
    video_path = output_directory / ("brick-ghosts-on-wall-preview.mp4" if orientation == "preview" else f"brick-ghosts-4k-{orientation}.mp4")
    metadata = json.loads(subprocess.check_output([
        "ffprobe", "-v", "error", "-show_streams", "-show_format",
        "-of", "json", str(video_path)
    ]))
    video_stream = next(stream for stream in metadata["streams"] if stream["codec_type"] == "video")
    audio_stream = next(stream for stream in metadata["streams"] if stream["codec_type"] == "audio")
    expected_dimensions = {"portrait": (2160, 3840), "landscape": (3840, 2160), "preview": (1162, 1334)}[orientation]
    assert (video_stream["width"], video_stream["height"]) == expected_dimensions
    assert video_stream["avg_frame_rate"] == "30/1"
    assert int(video_stream["nb_frames"]) == 2922
    assert abs(float(video_stream["duration"]) - 97.4) < 0.002
    assert abs(float(audio_stream["duration"]) - 97.4) < 0.002
    assert int(audio_stream["channels"]) == 2
    assert int(audio_stream["sample_rate"]) == 48000
    boundary_checks = {}
    preview_boundary_images = []
    for frame_index in [0, 2921]:
        if orientation == "preview":
            decoded_pixels = subprocess.check_output([
                "ffmpeg", "-v", "error", "-ss", str(frame_index / 30), "-i", str(video_path),
                "-frames:v", "1", "-vf", "scale=581:667", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"
            ])
            source_frame = np.frombuffer(decoded_pixels, dtype=np.uint8).reshape(667, 581, 3)
            preview_boundary_images.append(source_frame)
        else:
            source_frame = np.asarray(Image.open(output_directory / "support" / f"{orientation}-frame-{frame_index:04d}.jpg"))
        boundary_checks[str(frame_index)] = {"maximum": int(source_frame.max()), "mean": float(source_frame.mean())}
        if orientation != "preview":
            assert source_frame.max() == 0, "Loop boundary must emit black"
    if orientation == "preview":
        seam_difference = np.abs(preview_boundary_images[0].astype(float) - preview_boundary_images[1].astype(float))
        boundary_checks["mean_difference"] = float(seam_difference.mean())
        assert seam_difference.mean() < 1, "Preview loop must return to the same unlit wall"
    decode_result = subprocess.run([
        "ffmpeg", "-v", "error", "-xerror", "-i", str(video_path),
        "-map", "0:v:0", "-map", "0:a:0", "-f", "null", "-"
    ], capture_output=True, text=True)
    assert decode_result.returncode == 0, decode_result.stderr
    report = {
        "file": str(video_path), "bytes": video_path.stat().st_size,
        "width": video_stream["width"], "height": video_stream["height"],
        "frames": int(video_stream["nb_frames"]), "frame_rate": "30/1",
        "video_seconds": video_stream["duration"], "audio_seconds": audio_stream["duration"],
        "video_codec": video_stream["codec_name"], "audio_codec": audio_stream["codec_name"],
        "audio_channels": 2, "audio_sample_rate": 48000,
        "boundary_frames": boundary_checks, "full_decode": "passed",
        "decoder_messages": decode_result.stderr.strip()
    }
    (output_directory / "support" / f"{orientation}-verification.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report), flush=True)
