#!/usr/bin/env python3
"""Content sanity checks for a captured App Store screenshot set.

capture-screenshots.sh's only gate before this existed was pixel
dimensions, which happily reports "success" on a screenshot showing a
loading spinner, an empty state, a stuck system permission alert, or an
exact duplicate of another shot in the set. This script adds checks that
would have caught both real bugs found in this pipeline's first round:

1. Exact-duplicate detection (sha256 over the raw file bytes). Two shots
   in the same device set should never be byte-identical — if they are,
   whatever was supposed to differ between them (e.g. scroll position)
   didn't take effect. Applies to every shot, no exceptions.

2. A system-alert-overlay heuristic, combining two signals (either one
   flags a shot):

   a. Relative luminance drop. iOS system alerts dim the screen with a
      scrim. Directly measured on this app (same screen, alert vs. no
      alert): overall grayscale mean luminance dropped from 241.0 to
      198.9 (~17.5%). Ordinary shot-to-shot variation between genuinely
      different, alert-free screens in these 6 shots runs about 10-15%
      (e.g. a plain list vs. a photo-heavy detail view), so a shot whose
      mean luminance sits more than `LUMINANCE_DROP_THRESHOLD` below the
      median of its siblings is flagged.

   b. A large, centered, uniformly-bright "boxed" region. An alert's
      rounded-rect card is a wide island of near-uniform light gray
      (~225-248) that does *not* touch the frame's left/right edges — a
      shape ordinary list/detail content essentially never produces.
      Measured directly against this app: a reproduced stuck alert
      scored 0.69 (iPhone) / 0.31 (iPad) on this metric versus 0.00-0.04
      (iPhone) / 0.16-0.28 (iPad) for genuine alert-free shots.
      `BOXED_REGION_THRESHOLD` sits above the clean baseline on both
      devices with room to spare on iPhone; the margin on iPad is
      narrower (see Known limitations below).

   Both signals are skipped for shots the plan marks `"presentsModal":
   true` (currently `02-filters` and `06-calendar`) — those shots
   legitimately present their own system/app sheet (a bottom sheet, or
   `EKEventEditViewController`) over a dimmed backdrop as their *correct*,
   by-design appearance, which reads identically to a stray alert on both
   signals above. Confirmed by direct testing. Those shots need a human
   look (which the capture runbook already calls for) rather than a false
   "quality check passed" or a false failure on a correct capture.

Known limitations (this is a cheap heuristic, not a classifier):
   On iPad, natural brightness varies enough between the plain shots
   (e.g. a mostly-empty "select an event" pane vs. a dense list) that an
   alert landing on the single brightest shot in a set can produce a
   luminance ratio that narrowly avoids the threshold, and the boxed-
   region signal has less margin than on iPhone. In practice this is a
   partial mitigation: the real-world failure this guards against (a
   stuck alert bleeding into most or all of a run) still trips the check
   via whichever shots aren't already the brightest/least-boxed in the
   set, and is backstopped by the exact-duplicate check plus the human
   visual review the capture runbook already requires.

Usage:
    python3 check-screenshots.py [--plan screenshot-plan.json] <dir-of-pngs> [<dir-of-pngs> ...]

Exits 0 if every directory passes, non-zero (naming the offending
shot(s) and why) otherwise.
"""

from __future__ import annotations

import hashlib
import json
import statistics
import sys
from pathlib import Path

from PIL import Image

LUMINANCE_DROP_THRESHOLD = 0.85

# Fraction of row width a centered, edge-clear, near-uniform-bright run
# must reach to count as a "boxed region" hit. See module docstring for
# the real measurements this was calibrated against.
BOXED_REGION_THRESHOLD = 0.50
BOXED_REGION_BAND = (225, 248)
# Rows sampled as a fraction of image height, covering where a system
# alert or sheet has been observed to sit on both iPhone and iPad (0.40-0.65
# for the reproduced iPhone alert, 0.40-0.50 for iPad). Deliberately *not*
# widened all the way to the top/bottom of the frame: on this app's list
# screens, the header/status-bar area (roughly the top 20-25% on iPhone) is
# itself a wide, edge-clear, near-uniform-bright band with no alert
# present, which would otherwise false-positive.
BOXED_REGION_Y_FRACTIONS = (0.35, 0.40, 0.45, 0.50, 0.55, 0.60, 0.65, 0.70)


def mean_luminance(path: Path) -> float:
    with Image.open(path) as im:
        gray = im.convert("L")
        pixels = gray.getdata()
        return sum(pixels) / len(pixels)


def longest_edge_clear_run(row: list[int], lo: int, hi: int, margin: int = 6) -> int:
    """Longest run of values in [lo, hi] that has at least `margin` pixels
    of non-band values on both sides — i.e. an island, not a band that
    simply runs to the edge of the frame (which a plain light background
    would also produce)."""
    n = len(row)
    best = 0
    i = 0
    while i < n:
        if lo <= row[i] <= hi:
            j = i
            while j < n and lo <= row[j] <= hi:
                j += 1
            if i >= margin and (n - j) >= margin:
                best = max(best, j - i)
            i = j
        else:
            i += 1
    return best


def boxed_region_fraction(path: Path) -> float:
    with Image.open(path) as im:
        gray = im.convert("L")
        w, h = gray.size
        best = 0.0
        for yf in BOXED_REGION_Y_FRACTIONS:
            y = min(h - 1, int(h * yf))
            row = [gray.getpixel((x, y)) for x in range(w)]
            run = longest_edge_clear_run(row, *BOXED_REGION_BAND)
            best = max(best, run / w)
        return best


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def modal_shot_ids(plan_path: Path | None) -> set[str]:
    """Shot ids marked `"presentsModal": true` in the plan — excluded from
    both alert-overlay signals (see module docstring). Empty set if no
    plan was given."""
    if plan_path is None:
        return set()
    plan = json.loads(plan_path.read_text())
    return {shot["id"] for shot in plan.get("shots", []) if shot.get("presentsModal")}


def check_set(directory: Path, skip_ids: set[str]) -> list[str]:
    """Returns a list of human-readable problem descriptions, empty if clean."""
    problems: list[str] = []

    pngs = sorted(directory.glob("*.png"))
    if not pngs:
        return [f"{directory}: no PNGs found"]

    # --- Check 1: exact duplicates (applies to every shot, no exceptions) ---
    hashes: dict[str, list[str]] = {}
    for p in pngs:
        hashes.setdefault(sha256_of(p), []).append(p.name)
    for digest, names in hashes.items():
        if len(names) > 1:
            problems.append(
                f"{directory.name}: {', '.join(names)} are byte-identical "
                f"(sha256 {digest[:12]}...) — whatever should differ between "
                f"them didn't happen"
            )

    # --- Check 2: system-alert-overlay heuristic (luminance drop OR boxed region) ---
    skipped = {p for p in pngs if p.stem in skip_ids}
    evaluated = [p for p in pngs if p not in skipped]
    # Luminance baseline is built over *every* shot, including the
    # `presentsModal` ones. Being exempt from being *flagged* is not a
    # reason to be dropped from the *baseline population*: a modal shot's
    # brightness is legitimate data about what this app's screens look
    # like, and the thresholds in the docstring above were calibrated
    # across all six shots. Excluding them biased the median brighter (the
    # two modal shots are mid-dark), which squeezed the legitimately
    # darkest clean shot — the photo-heavy `04-detail` — from a 0.869
    # ratio to 0.849 and failed it against the 0.85 threshold with no
    # alert present. Only `evaluated` decides who gets flagged.
    luminances = {p.name: mean_luminance(p) for p in pngs}
    boxed = {p.name: boxed_region_fraction(p) for p in evaluated}

    for p in evaluated:
        reasons = []

        others = [v for name, v in luminances.items() if name != p.name]
        if others:
            sibling_median = statistics.median(others)
            if sibling_median > 0:
                ratio = luminances[p.name] / sibling_median
                if ratio < LUMINANCE_DROP_THRESHOLD:
                    reasons.append(
                        f"mean luminance {luminances[p.name]:.1f} is "
                        f"{(1 - ratio) * 100:.0f}% below the set's sibling "
                        f"median ({sibling_median:.1f})"
                    )

        if boxed[p.name] >= BOXED_REGION_THRESHOLD:
            reasons.append(
                f"a centered, edge-clear, near-uniform-bright region spans "
                f"{boxed[p.name] * 100:.0f}% of a row's width"
            )

        if reasons:
            problems.append(
                f"{directory.name}/{p.name}: looks like a system alert or "
                f"other screen-dimming overlay is present ({'; '.join(reasons)})"
            )

    if skipped:
        names = ", ".join(sorted(p.name for p in skipped))
        print(
            f"{directory.name}: skipped alert-overlay checks for {names} "
            f"(presentsModal — needs a human look, see script docs)"
        )

    return problems


def main(argv: list[str]) -> int:
    plan_path: Path | None = None
    dirs: list[str] = []
    i = 0
    while i < len(argv):
        if argv[i] == "--plan":
            i += 1
            if i >= len(argv):
                print("error: --plan requires a path", file=sys.stderr)
                return 2
            plan_path = Path(argv[i])
        else:
            dirs.append(argv[i])
        i += 1

    if not dirs:
        print(f"usage: {sys.argv[0]} [--plan screenshot-plan.json] <dir-of-pngs> [<dir-of-pngs> ...]", file=sys.stderr)
        return 2

    skip_ids = modal_shot_ids(plan_path)

    all_problems: list[str] = []
    for arg in dirs:
        directory = Path(arg)
        if not directory.is_dir():
            all_problems.append(f"{directory}: not a directory")
            continue
        all_problems.extend(check_set(directory, skip_ids))

    if all_problems:
        print("Screenshot quality check FAILED:", file=sys.stderr)
        for problem in all_problems:
            print(f"  - {problem}", file=sys.stderr)
        return 1

    print("Screenshot quality check passed: no duplicates, no alert-overlay signal.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
