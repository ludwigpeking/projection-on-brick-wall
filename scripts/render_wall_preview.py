"""Map the finished projector feed onto the registered wall photograph."""
import json
from pathlib import Path
import subprocess
import sys

import numpy as np

project_directory = Path(__file__).resolve().parent.parent
output_directory = project_directory / "exports"
support_directory = output_directory / "support"
configuration = json.loads((support_directory / "portrait-settings.json").read_text())
wall_view = json.loads((support_directory / "wall-preview-settings.json").read_text())
assert configuration["settings"] == wall_view["settings"], "Source animation settings differ from selected preview"
assert wall_view["music"] == "surf"
settings = configuration["settings"]
output_width, output_height = 1162, 1334
source_width, source_height = 2160, 3840

angle_radians = np.deg2rad(settings["projector-angle"])
camera_position = np.array([np.sin(angle_radians) * settings["projector-distance"], settings["projector-height"], np.cos(angle_radians) * settings["projector-distance"]])
camera_forward = np.array([0, settings["wall-height"] / 2, 0]) - camera_position
camera_forward /= np.linalg.norm(camera_forward)
camera_right = np.cross(camera_forward, [0, 1, 0])
camera_right /= np.linalg.norm(camera_right)
camera_up = np.cross(camera_right, camera_forward)
half_wall_width = settings["wall-width"] / 2
wall_corners = np.array([[-half_wall_width, settings["wall-height"], 0], [half_wall_width, settings["wall-height"], 0], [half_wall_width, 0, 0], [-half_wall_width, 0, 0]])
relative_positions = wall_corners - camera_position
forward_distances = relative_positions @ camera_forward
screen_corners = np.column_stack((relative_positions @ camera_right, relative_positions @ camera_up)) / forward_distances[:, None]
screen_minimum, screen_maximum = screen_corners.min(axis=0), screen_corners.max(axis=0)
aspect_ratio = source_width / source_height
vertical_scale = min(1.96 / (screen_maximum[1] - screen_minimum[1]), 1.96 * aspect_ratio / (screen_maximum[0] - screen_minimum[0]))
screen_scale = np.array([vertical_scale / aspect_ratio, vertical_scale])
normalized_corners = (screen_corners - (screen_minimum + screen_maximum) / 2) * screen_scale
source_corners = np.column_stack(((normalized_corners[:, 0] + 1) * output_width / 2, (1 - normalized_corners[:, 1]) * output_height / 2))
destination_corners = np.array(wall_view["photoCorners"], dtype=float) * 2

equation_rows, equation_results = [], []
for (source_horizontal, source_vertical), (destination_horizontal, destination_vertical) in zip(source_corners, destination_corners):
    equation_rows.extend([[source_horizontal, source_vertical, 1, 0, 0, 0, -destination_horizontal * source_horizontal, -destination_horizontal * source_vertical], [0, 0, 0, source_horizontal, source_vertical, 1, -destination_vertical * source_horizontal, -destination_vertical * source_vertical]])
    equation_results.extend([destination_horizontal, destination_vertical])
homography = np.append(np.linalg.solve(equation_rows, equation_results), 1).reshape(3, 3)
mapped_corners = np.column_stack((source_corners, np.ones(4))) @ homography.T
assert np.max(np.abs(mapped_corners[:, :2] / mapped_corners[:, 2, None] - destination_corners)) < 1e-6
image_corners = np.array([[0, 0, 1], [output_width, 0, 1], [0, output_height, 1], [output_width, output_height, 1]]) @ homography.T
image_corners = image_corners[:, :2] / image_corners[:, 2, None]
perspective_parameters = ":".join(f"x{index}={point[0]:.9f}:y{index}={point[1]:.9f}" for index, point in enumerate(image_corners))
background_brightness = settings["ambient"] + 0.18
filter_graph = (
    f"[0:v]scale={output_width}:{output_height}:flags=lanczos,format=gbrp,lutrgb=r=val*{background_brightness}:g=val*{background_brightness}:b=val*{background_brightness},setsar=1[wall];"
    f"[1:v]scale={output_width}:{output_height}:flags=lanczos,format=gbrp,perspective={perspective_parameters}:sense=destination:interpolation=cubic,setsar=1[light];"
    "[wall][light]blend=all_mode=addition:shortest=1,format=yuv420p[composite]"
)
(support_directory / "wall-preview-filter.txt").write_text(filter_graph)
proof_mode = "--proof" in sys.argv
command = ["ffmpeg", "-hide_banner", "-y", "-filter_complex_threads", "4", "-loop", "1", "-framerate", "30", "-i", str(project_directory / "assets" / "wall-reference.png")]
if proof_mode:
    command.extend(["-ss", "8.8"])
command.extend(["-i", str(output_directory / "brick-ghosts-4k-portrait.mp4"), "-filter_complex", filter_graph, "-map", "[composite]"])
if proof_mode:
    command.extend(["-frames:v", "1", "-an", "-update", "1", str(support_directory / "wall-preview-proof.png")])
else:
    command.extend(["-map", "1:a:0", "-c:v", "h264_nvenc", "-preset", "p5", "-tune", "hq", "-rc", "vbr", "-cq", "18", "-b:v", "0", "-pix_fmt", "yuv420p", "-c:a", "copy", "-t", "97.4", "-movflags", "+faststart", str(output_directory / "brick-ghosts-on-wall-preview.mp4")])
with (support_directory / ("wall-preview-proof.log" if proof_mode else "wall-preview-encode.log")).open("w") as log_file:
    subprocess.run(command, stdout=log_file, stderr=log_file, check=True)
print("Wall preview proof ready" if proof_mode else "Wall preview video ready", flush=True)
