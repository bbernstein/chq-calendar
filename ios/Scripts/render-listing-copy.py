#!/usr/bin/env python3
"""Render docs/app-store/listing-fields.json into paste-ready plain text.

`listing-fields.json` is the machine-readable source of truth, so its
multi-line values (`description`, `whatsNew`, `reviewNotes`) carry `\\n`
escapes. Those are JSON syntax, not content — pasting them straight into
an App Store Connect text area would put a literal backslash-n on screen.

This writes one file per field with real newlines, laid out to match
fastlane's `deliver` metadata convention. That means the output is
immediately useful two ways:

  * paste each file's contents into the matching App Store Connect field
  * or, later, point `fastlane deliver` at the directory and skip the
    pasting entirely (see the README this script emits)

Output goes to ios/Scripts/out/listing/ which is gitignored — the JSON
stays the single source of truth and these files are always regenerated,
never edited by hand.

Usage:  python3 ios/Scripts/render-listing-copy.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[1]
FIELDS_PATH = REPO_ROOT / "docs" / "app-store" / "listing-fields.json"
OUT_ROOT = SCRIPT_DIR / "out" / "listing"
LOCALE = "en-US"

# JSON key -> path relative to the metadata root, following fastlane
# deliver's layout. Anything not listed here is either a non-text setting
# (category, age rating) or is configured elsewhere in App Store Connect.
FIELD_FILES: dict[str, str] = {
    "appName": f"{LOCALE}/name.txt",
    "subtitle": f"{LOCALE}/subtitle.txt",
    "description": f"{LOCALE}/description.txt",
    "keywords": f"{LOCALE}/keywords.txt",
    "promotionalText": f"{LOCALE}/promotional_text.txt",
    "whatsNew": f"{LOCALE}/release_notes.txt",
    "supportUrl": f"{LOCALE}/support_url.txt",
    "marketingUrl": f"{LOCALE}/marketing_url.txt",
    "privacyPolicyUrl": f"{LOCALE}/privacy_url.txt",
    "reviewNotes": "review_information/notes.txt",
    "copyright": "copyright.txt",
}

# Apple's documented maximums. Mirrors the assertions in
# frontend/src/__tests__/appStoreListing.test.ts — duplicated here so the
# renderer fails loudly on its own rather than trusting an upstream check.
LIMITS: dict[str, int] = {
    "appName": 30,
    "subtitle": 30,
    "promotionalText": 170,
    "keywords": 100,
    "description": 4000,
    "whatsNew": 4000,
}

# Set manually in App Store Connect; emitted into the README for reference
# rather than written as metadata files.
MANUAL_FIELDS = ("primaryCategory", "secondaryCategory", "ageRating")


def main() -> int:
    if not FIELDS_PATH.exists():
        print(f"error: {FIELDS_PATH} not found", file=sys.stderr)
        return 1

    fields = json.loads(FIELDS_PATH.read_text())

    for key, limit in LIMITS.items():
        value = fields.get(key, "")
        if len(value) > limit:
            print(
                f"error: {key} is {len(value)} chars, over Apple's {limit} limit",
                file=sys.stderr,
            )
            return 1

    written = []
    for key, rel in FIELD_FILES.items():
        if key not in fields:
            print(f"error: {key} missing from listing-fields.json", file=sys.stderr)
            return 1

        dest = OUT_ROOT / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        text = fields[key]
        dest.write_text(text if text.endswith("\n") else text + "\n")

        # Round-trip check: what we wrote must re-encode to exactly the
        # JSON value. Catches an escaping mistake here rather than after
        # it has been pasted into a live listing.
        readback = dest.read_text().rstrip("\n")
        if readback != text.rstrip("\n"):
            print(f"error: round-trip mismatch for {key}", file=sys.stderr)
            return 1

        lines = text.count("\n") + 1
        written.append((key, rel, len(text), lines))
        print(f"  {rel:42} {len(text):5} chars  {lines:2} line(s)")

    readme = OUT_ROOT / "README.txt"
    readme.write_text(
        "App Store Connect listing copy — GENERATED, DO NOT EDIT\n"
        "=======================================================\n\n"
        "Source of truth: docs/app-store/listing-fields.json\n"
        "Regenerate:      python3 ios/Scripts/render-listing-copy.py\n\n"
        "Edit the JSON, never these files. They are gitignored and are\n"
        "overwritten on every run.\n\n"
        "MANUAL PASTE\n"
        "------------\n"
        "Each file holds exactly one App Store Connect field, with real\n"
        "newlines. Open it and copy the whole contents. Field-to-location\n"
        "mapping is in docs/app-store/listing-copy.md.\n\n"
        "Review notes go in the App Review Information section, not the\n"
        "localisation fields.\n\n"
        "SET MANUALLY IN APP STORE CONNECT (not text fields)\n"
        "---------------------------------------------------\n"
        + "".join(f"  {k:20} {fields[k]}\n" for k in MANUAL_FIELDS if k in fields)
        + "\nFASTLANE\n"
        "--------\n"
        "This directory matches fastlane deliver's metadata layout, so\n"
        "once fastlane and an App Store Connect API key are set up:\n\n"
        "  fastlane deliver --metadata_path ios/Scripts/out/listing \\\n"
        "                   --skip_binary_upload --skip_screenshots\n\n"
        "Categories and age rating are Deliverfile settings, not files.\n"
    )

    print(f"\n{len(written)} field(s) written to {OUT_ROOT.relative_to(REPO_ROOT)}")
    print(f"Read {readme.relative_to(REPO_ROOT)} first.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
