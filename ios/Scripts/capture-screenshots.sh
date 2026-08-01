#!/usr/bin/env bash
# Captures raw App Store screenshots from simulators.
#
# Drives the app's DEBUG-only launch hooks (see CalendarView.applyUITestHooks
# and EventDetailView's UI-test hooks section) so each shot lands in a
# deterministic state without a UI test target. Output is raw, unframed PNGs
# at native device resolution; compose-screenshots.py turns those into the
# captioned store images.
#
# Usage:  ios/Scripts/capture-screenshots.sh [device-key ...]
#         (no args = every device in screenshot-plan.json)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IOS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PLAN="$SCRIPT_DIR/screenshot-plan.json"
OUT_ROOT="$SCRIPT_DIR/out/raw"
DERIVED="$SCRIPT_DIR/out/DerivedData"
BUNDLE_ID="org.chqcal.app"

command -v jq >/dev/null || { echo "error: jq is required (brew install jq)" >&2; exit 1; }
# mapfile is a bash 4+ builtin; macOS still ships bash 3.2 at /bin/bash, so
# fail with a clear message rather than "mapfile: command not found".
if (( BASH_VERSINFO[0] < 4 )); then
  echo "error: bash 4+ required (found $BASH_VERSION). brew install bash" >&2
  exit 1
fi

device_keys=("$@")
if [ ${#device_keys[@]} -eq 0 ]; then
  mapfile -t device_keys < <(jq -r '.devices[].key' "$PLAN")
fi

# Resolves a simulator *name* (as written in screenshot-plan.json) to one
# concrete UDID. This machine has duplicate simulators sharing the same name
# (e.g. two "iPhone 17 Pro Max" — one booted, one shutdown, left over from
# other test runs); every simctl subcommand below targets the resolved UDID
# rather than the name, so boot/install/privacy/launch/screenshot can never
# silently split across two different device instances of the same name.
# Prefers an already-booted device so this doesn't fight a device the
# operator already has open.
resolve_udid() {
  local name="$1" udid
  udid=$(xcrun simctl list devices available -j \
    | jq -r --arg n "$name" '.devices[][] | select(.name==$n and .state=="Booted") | .udid' | head -1)
  if [ -z "$udid" ]; then
    udid=$(xcrun simctl list devices available -j \
      | jq -r --arg n "$name" '.devices[][] | select(.name==$n) | .udid' | head -1)
  fi
  echo "$udid"
}

for key in "${device_keys[@]}"; do
  sim=$(jq -r --arg k "$key" '.devices[] | select(.key==$k) | .simulator' "$PLAN")
  want_w=$(jq -r --arg k "$key" '.devices[] | select(.key==$k) | .width' "$PLAN")
  want_h=$(jq -r --arg k "$key" '.devices[] | select(.key==$k) | .height' "$PLAN")
  [ -n "$sim" ] || { echo "error: unknown device key '$key'" >&2; exit 1; }

  udid=$(resolve_udid "$sim")
  [ -n "$udid" ] || { echo "error: no simulator named '$sim' found (check 'xcrun simctl list devices available')" >&2; exit 1; }

  echo "==> $key ($sim, $udid)"
  out_dir="$OUT_ROOT/$key"
  mkdir -p "$out_dir"

  # Build for this exact simulator instance, then install once and relaunch
  # per shot. `id=` (not `name=`) pins xcodebuild to the same UDID resolved
  # above, so the build target and the simctl target can't drift apart.
  xcodebuild build \
    -project "$IOS_DIR/ChqCalendar.xcodeproj" -scheme ChqCalendar \
    -destination "platform=iOS Simulator,id=$udid" \
    -derivedDataPath "$DERIVED" \
    CODE_SIGNING_ALLOWED=NO -quiet

  app_path="$DERIVED/Build/Products/Debug-iphonesimulator/ChqCalendar.app"
  [ -d "$app_path" ] || { echo "error: build produced no app at $app_path" >&2; exit 1; }

  xcrun simctl boot "$udid" 2>/dev/null || true
  xcrun simctl bootstatus "$udid" -b
  # A clean, Apple-style status bar. Without this the shots carry a real
  # clock and a partial battery, which looks sloppy in the store listing.
  xcrun simctl status_bar "$udid" override \
    --time "9:41" --batteryState charged --batteryLevel 100 \
    --cellularMode active --cellularBars 4 --wifiMode active --wifiBars 3
  xcrun simctl install "$udid" "$app_path"
  # Pre-grant Calendar access so the 06-calendar shot captures the app's own
  # Add to Calendar sheet instead of the one-time system permission alert
  # (EventKit prompts on first write attempt on a fresh install/simulator).
  xcrun simctl privacy "$udid" grant calendar "$BUNDLE_ID"

  # Process substitution, NOT `jq ... | while`: a piped while loop runs in a
  # subshell, so the dimension check's `exit 1` below would abort only the
  # subshell and let the script report success on bad screenshots.
  while read -r shot; do
    id=$(jq -r '.id' <<<"$shot")
    settle=$(jq -r '.settleSeconds' <<<"$shot")
    mapfile -t args < <(jq -r '.launchArgs[]?' <<<"$shot")

    xcrun simctl terminate "$udid" "$BUNDLE_ID" 2>/dev/null || true
    xcrun simctl launch "$udid" "$BUNDLE_ID" "${args[@]+"${args[@]}"}" >/dev/null
    # The app fetches live data on launch; settle long enough for the list
    # to populate, otherwise shots capture the loading spinner.
    sleep "$settle"

    dest="$out_dir/$id.png"
    xcrun simctl io "$udid" screenshot --type png "$dest"

    got=$(sips -g pixelWidth -g pixelHeight "$dest" | awk '/pixel/ {print $2}' | paste -sd'x' -)
    echo "    $id.png  $got"
    if [ "$got" != "${want_w}x${want_h}" ]; then
      echo "error: $id.png is $got, expected ${want_w}x${want_h}" >&2
      echo "       App Store Connect rejects off-size screenshots." >&2
      exit 1
    fi
  done < <(jq -c '.shots[]' "$PLAN")

  xcrun simctl status_bar "$udid" clear
  echo "==> $key done: $out_dir"
done

# Every shot in the current plan is fully automated via DEBUG launch hooks
# (see CalendarView.applyUITestHooks / EventDetailView's UI-test hooks
# section) — there is no tap/scroll automation available in this
# environment, so any shot that still needed manual interaction would be
# marked `"manual": true` with a `"manualNote"` in screenshot-plan.json.
# This loop is what surfaces those notes at the end of a run so the next
# person isn't rediscovering them by re-opening every PNG.
manual_notes=$(jq -r '.shots[] | select(.manual == true) | "  - \(.id): \(.manualNote // "manual interaction required, no note recorded")"' "$PLAN")
if [ -n "$manual_notes" ]; then
  echo
  echo "MANUAL STEPS STILL REQUIRED before these shots are store-ready:"
  echo "$manual_notes"
fi

echo
echo "Raw captures written to $OUT_ROOT"
echo "Next: python3 $SCRIPT_DIR/compose-screenshots.py"
