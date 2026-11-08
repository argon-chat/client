"""Compare GPU-only and readback fixture evidence (requires Pillow)."""
import argparse
import json
from pathlib import Path
from PIL import Image, ImageChops


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def compare(native, baseline):
    result = read_json(native / "result.json")
    previous = read_json(baseline / "result.json")
    assert result["ok"] and result["gpuOnly"] and previous["ok"]
    assert not previous["gpuOnly"]
    assert result["sharedDevice"] and previous["sharedDevice"]
    counters = result["presentation"]
    assert counters["nativeDisplayFrames"] > 0 and counters["atlasGpuCopies"] > 0
    assert counters["readbackDisplayFrames"] == counters["atlasCpuFallbacks"] == 0
    frames = sorted(native.glob("*-pixels.json"))
    assert len(frames) == 14, "all baseline and annotation states must be captured"
    compared = []
    for pixels in frames:
        state = pixels.name.replace("-pixels.json", "-annotations.json")
        assert read_json(native / state) == read_json(baseline / state), state
        assert read_json(pixels) == read_json(baseline / pixels.name), pixels.name
        name = pixels.name.replace("-pixels.json", ".png")
        left = Image.open(native / name).convert("RGBA")
        right = Image.open(baseline / name).convert("RGBA")
        assert left.size == right.size
        maximum = max(high for _, high in ImageChops.difference(left, right).getextrema())
        # Core GPU hashes and source annotation rasters above are exact. The
        # outer UI's SVG/atlas compositing can differ by one 8-bit level; the
        # qualification pair showed only 18 debug-toggle icon pixels, outside
        # the editor canvas. Retain the measured difference in the report.
        assert maximum <= 1, (name, "screenshot pixels differ", maximum)
        compared.append({"frame": name, "gpuPixelsExact": True, "screenshotDifference": maximum})
    for name, dimensions in [("avatar-export.png", (240, 240)), ("sticker-export.png", (512, 384)), ("annotated-export.png", (240, 240))]:
        left = Image.open(native / name).convert("RGBA")
        right = Image.open(baseline / name).convert("RGBA")
        assert left.size == right.size == dimensions
        assert left.tobytes() == right.tobytes(), (name, "export pixels differ")
        compared.append({"export": name, "rgbaExact": True, "size": dimensions})
    for directory in (native, baseline):
        assert read_json(directory / "cleanup.json")["terminated"]
        for mode in ("avatar", "sticker", "reopened", "large"):
            state = read_json(directory / (mode + "-closed.json"))
            assert state["lost"] and state["canvasCount"] == 0 and not state["errors"]
    return {"ok": True, "presentation": counters, "comparisons": compared}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("native", type=Path)
    parser.add_argument("baseline", type=Path)
    parser.add_argument("--output", type=Path)
    arguments = parser.parse_args()
    report = json.dumps(compare(arguments.native, arguments.baseline), indent=2)
    if arguments.output:
        arguments.output.write_text(report, encoding="utf-8")
    print(report)
