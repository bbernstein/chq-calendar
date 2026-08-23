#!/usr/bin/env python3
"""Composite raw simulator captures into captioned App Store screenshots.

Reads screenshot-plan.json and the raw PNGs written by capture-screenshots.sh,
draws each caption above the device image on the brand's pale-indigo field,
and writes:

  ios/Scripts/out/final/<device>/<id>.png      full resolution (gitignored)
  docs/app-store/screenshots/review/*.png      ~400px review copies (committed)
  docs/app-store/screenshots.manifest.json     committed; watched by CI

Output dimensions exactly match the plan's per-device width/height, because
App Store Connect rejects off-size screenshots.
"""
from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from datetime import date
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[1]
PLAN_PATH = SCRIPT_DIR / "screenshot-plan.json"
RAW_ROOT = SCRIPT_DIR / "out" / "raw"
FINAL_ROOT = SCRIPT_DIR / "out" / "final"
REVIEW_ROOT = REPO_ROOT / "docs" / "app-store" / "screenshots" / "review"
MANIFEST_PATH = REPO_ROOT / "docs" / "app-store" / "screenshots.manifest.json"

BACKGROUND = (238, 242, 255)   # #EEF2FF — matches the app icon's field
CAPTION_COLOR = (30, 41, 59)   # #1E293B — slate, high contrast on the field
SHADOW_COLOR = (148, 163, 184, 90)

# Layout as fractions of canvas height, so both device classes share one recipe.
CAPTION_TOP_FRAC = 0.052
CAPTION_BLOCK_FRAC = 0.135      # space reserved for up to two caption lines
DEVICE_BOTTOM_MARGIN_FRAC = 0.035
CORNER_RADIUS_FRAC = 0.022

FONT_CANDIDATES = [
    ("/System/Library/Fonts/SFNS.ttf", "Bold"),
    ("/System/Library/Fonts/Supplemental/Arial Bold.ttf", None),
    ("/Library/Fonts/Arial Bold.ttf", None),
]


def load_font(size: int) -> ImageFont.FreeTypeFont:
    """Prefer San Francisco Bold (matches iOS); fall back to Arial Bold."""
    last_error: Exception | None = None
    for path, variation in FONT_CANDIDATES:
        if not Path(path).exists():
            continue
        try:
            font = ImageFont.truetype(path, size)
            if variation:
                try:
                    font.set_variation_by_name(variation)
                except Exception:
                    # SFNS is variable; older FreeType builds can't select a
                    # named instance. Regular weight is an acceptable result.
                    pass
            return font
        except Exception as exc:  # pragma: no cover - environment dependent
            last_error = exc
    raise RuntimeError(f"No usable TTF font found. Tried: {FONT_CANDIDATES}. Last error: {last_error}")


def wrap(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont, max_width: int) -> list[str]:
    words, lines, current = text.split(), [], ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if draw.textlength(candidate, font=font) <= max_width or not current:
            current = candidate
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def rounded(image: Image.Image, radius: int) -> Image.Image:
    mask = Image.new("L", image.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([(0, 0), image.size], radius=radius, fill=255)
    out = image.convert("RGBA")
    out.putalpha(mask)
    return out


def compose(raw_path: Path, caption: str, width: int, height: int) -> Image.Image:
    canvas = Image.new("RGB", (width, height), BACKGROUND)
    draw = ImageDraw.Draw(canvas)

    caption_top = int(height * CAPTION_TOP_FRAC)
    caption_block = int(height * CAPTION_BLOCK_FRAC)
    side_pad = int(width * 0.085)

    font = load_font(int(height * 0.026))
    lines = wrap(draw, caption, font, width - 2 * side_pad)
    if len(lines) > 2:
        raise ValueError(f"Caption wraps to {len(lines)} lines (max 2): {caption!r}")

    line_height = int(font.size * 1.25)
    y = caption_top + (caption_block - len(lines) * line_height) // 2
    for line in lines:
        x = (width - draw.textlength(line, font=font)) // 2
        draw.text((x, y), line, font=font, fill=CAPTION_COLOR)
        y += line_height

    device = Image.open(raw_path).convert("RGB")
    avail_top = caption_top + caption_block
    avail_height = height - avail_top - int(height * DEVICE_BOTTOM_MARGIN_FRAC)
    avail_width = width - 2 * side_pad

    scale = min(avail_width / device.width, avail_height / device.height)
    new_size = (int(device.width * scale), int(device.height * scale))
    device = device.resize(new_size, Image.LANCZOS)
    device = rounded(device, int(height * CORNER_RADIUS_FRAC))

    dx = (width - device.width) // 2
    dy = avail_top + (avail_height - device.height) // 2

    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle(
        [(dx, dy + int(height * 0.004)), (dx + device.width, dy + device.height + int(height * 0.004))],
        radius=int(height * CORNER_RADIUS_FRAC),
        fill=SHADOW_COLOR,
    )
    canvas = Image.alpha_composite(canvas.convert("RGBA"), shadow)
    canvas.paste(device, (dx, dy), device)
    return canvas.convert("RGB")


def git_sha() -> str:
    try:
        return subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=REPO_ROOT, capture_output=True, text=True, check=True,
        ).stdout.strip()
    except Exception as exc:
        print(f"warning: git_sha() failed, recording appCommit as 'unknown': {exc}", file=sys.stderr)
        return "unknown"


CONTENT_FIELDS = ("device", "id", "caption", "file", "width", "height", "sha256")


def content_fingerprint(entries: list[dict]) -> list[tuple]:
    """The subset of manifest fields that describe actual screenshot content,
    order-insensitive, so metadata-only fields (capturedOn, appCommit) never
    factor into whether the manifest is considered "changed"."""
    return sorted(tuple(entry[field] for field in CONTENT_FIELDS) for entry in entries)


def depicted_pins(plan: dict) -> dict:
    """The run-wide clock/dataset-year pins the captures were taken under
    (screenshot-plan.json's "capture" block, #222), recorded into the
    manifest so a later reader can tell *what date these shots show* without
    re-deriving it from the pixels. Metadata about the run, not about any one
    file — note that 01-season and 07-my-day override the clock locally, so
    this is the run-wide default, not a promise about every frame.

    Tolerates a missing or malformed "capture" block rather than raising:
    capture-screenshots.sh is where a plan that cannot pin a run is rejected
    (loudly, before a simulator boots), and composition runs over raw PNGs
    that may well have been captured by an older plan. Aborting a
    composition over metadata would trade a complete set of images for a
    traceback."""
    capture = plan.get("capture")
    if not isinstance(capture, dict):
        return {}
    return {key: capture[key] for key in ("frozenNow", "pinYear") if key in capture}


def main() -> int:
    plan = json.loads(PLAN_PATH.read_text())
    pins = depicted_pins(plan)
    REVIEW_ROOT.mkdir(parents=True, exist_ok=True)
    entries, missing = [], []

    for device in plan["devices"]:
        key, width, height = device["key"], device["width"], device["height"]
        out_dir = FINAL_ROOT / key
        out_dir.mkdir(parents=True, exist_ok=True)

        for shot in plan["shots"]:
            note = shot.get("note")
            raw_path = RAW_ROOT / key / f"{shot['id']}.png"
            if not raw_path.exists():
                if shot.get("manual"):
                    # Manual shots (e.g. 10-widget, which lives on
                    # SpringBoard) can't be captured by
                    # capture-screenshots.sh; a missing raw is expected
                    # until a human takes it per the shot's manualNote.
                    # When the raw IS present, it flows through composition
                    # and the manifest exactly like an automated shot.
                    print(f"  {key}/{shot['id']}.png  SKIPPED (manual shot, raw not taken yet — see manualNote in screenshot-plan.json)")
                    continue
                missing.append(str(raw_path.relative_to(REPO_ROOT)))
                continue

            image = compose(raw_path, shot["caption"], width, height)
            if image.size != (width, height):
                raise AssertionError(f"{key}/{shot['id']} composed to {image.size}, expected {(width, height)}")

            final_path = out_dir / f"{shot['id']}.png"
            image.save(final_path, "PNG")

            review = image.copy()
            review.thumbnail((400, 400 * height // width), Image.LANCZOS)
            review.save(REVIEW_ROOT / f"{key}-{shot['id']}.png", "PNG", optimize=True)

            entries.append({
                "device": key,
                "id": shot["id"],
                "caption": shot["caption"],
                "file": str(final_path.relative_to(REPO_ROOT)),
                "width": width,
                "height": height,
                "sha256": hashlib.sha256(final_path.read_bytes()).hexdigest(),
            })
            print(f"  {key}/{shot['id']}.png  {width}x{height}")
            if note:
                # "note" is an operational caveat (e.g. 01-season's
                # live-production-data dependency), distinct from
                # "manualNote" above — it applies to automated shots too,
                # so it's printed here on every composition rather than
                # only when a shot is missing/manual.
                print(f"    NOTE: {note}")

    if missing:
        print("\nerror: missing raw captures:", file=sys.stderr)
        for path in missing:
            print(f"  {path}", file=sys.stderr)
        print("Run ios/Scripts/capture-screenshots.sh first.", file=sys.stderr)
        return 1

    existing = None
    if MANIFEST_PATH.exists():
        try:
            existing = json.loads(MANIFEST_PATH.read_text())
        except Exception as exc:
            print(f"warning: could not parse existing manifest, will rewrite: {exc}", file=sys.stderr)

    # `depicts` joins the fingerprint check even though it is metadata: it
    # describes the *inputs* the shots were taken under, so it going stale
    # while the images stay byte-identical would be a lie rather than a
    # harmless omission.
    if (existing is not None
            and content_fingerprint(existing.get("screenshots", [])) == content_fingerprint(entries)
            and existing.get("depicts", {}) == pins):
        print(f"\nManifest unchanged ({len(entries)} screenshots identical): {MANIFEST_PATH.relative_to(REPO_ROOT)}")
        return 0

    MANIFEST_PATH.write_text(json.dumps({
        "capturedOn": date.today().isoformat(),
        "appCommit": git_sha(),
        "depicts": pins,
        "screenshots": entries,
    }, indent=2) + "\n")
    print(f"\nManifest: {MANIFEST_PATH.relative_to(REPO_ROOT)} ({len(entries)} screenshots)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
