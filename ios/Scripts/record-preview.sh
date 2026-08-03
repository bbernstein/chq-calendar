#!/usr/bin/env bash
# Records the iPhone App Store preview from the simulator.
#
# Recording is interactive: the script boots the sim, sets a clean status
# bar, starts recording, and waits for you to drive the demo flow by hand.
# Press Enter (NOT Ctrl-C, which would kill the script before it encodes)
# to stop, then it encodes to App Store spec.
#
# App Store preview requirements handled here:
#   - 1320x2868 (iPhone 6.9"), portrait
#   - 15-30 seconds
#   - H.264 video + an audio track (silent AAC; Transporter rejects
#     video-only files)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SIM="${SIM:-iPhone 17 Pro Max}"
OUT_DIR="$SCRIPT_DIR/out/preview"
RAW="$OUT_DIR/raw.mov"
FINAL="$OUT_DIR/iphone-6.9.mp4"
BUNDLE_ID="org.chqcal.app"

for dep in ffmpeg ffprobe bc jq; do
  command -v "$dep" >/dev/null || { echo "error: $dep is required" >&2; exit 1; }
done
mkdir -p "$OUT_DIR"

# Resolves a simulator *name* to one concrete UDID. This machine has
# duplicate simulators sharing the same name (e.g. two "iPhone 17 Pro
# Max" — one booted, one shutdown, left over from other test runs);
# every simctl subcommand below targets the resolved UDID rather than the
# name, so boot/install/privacy/launch/record can never silently split
# across two different device instances of the same name. Prefers an
# already-booted device so this doesn't fight a device the operator
# already has open. Same approach as capture-screenshots.sh's
# resolve_udid.
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

udid=$(resolve_udid "$SIM")
[ -n "$udid" ] || { echo "error: no simulator named '$SIM' found (check 'xcrun simctl list devices available')" >&2; exit 1; }
echo "==> using $SIM ($udid)"

# Recording/status-bar cleanup, reachable from every exit path.
#
# `read -r _` below returns non-zero on EOF (non-interactive invocation,
# closed pipe, disconnected terminal) — under `set -e` that would exit the
# script *before* the kill/wait line ever runs, orphaning the background
# `simctl io recordVideo` process with no owner and no cleanup. This trap
# makes stopping the recording (and clearing the status bar override)
# reachable no matter how the script exits. It is idempotent: the normal
# path below also stops the recording and clears the status bar, flips
# these flags to done, and the EXIT trap that fires afterward finds
# nothing left to do.
recording_active=0
status_bar_active=0
cleanup() {
  local rc=$?
  if [ "$recording_active" = 1 ]; then
    kill -INT "${RECORD_PID:-}" 2>/dev/null || true
    wait "${RECORD_PID:-}" 2>/dev/null || true
    recording_active=0
  fi
  if [ "$status_bar_active" = 1 ]; then
    xcrun simctl status_bar "$udid" clear 2>/dev/null || true
    status_bar_active=0
  fi
  return "$rc"
}
trap cleanup EXIT
# SIGINT/SIGTERM don't implicitly terminate a script that traps them, so
# turn them into an explicit exit — that in turn fires the EXIT trap above.
trap 'exit 130' INT
trap 'exit 143' TERM

xcrun simctl boot "$udid" 2>/dev/null || true
xcrun simctl bootstatus "$udid" -b
xcrun simctl status_bar "$udid" override \
  --time "9:41" --batteryState charged --batteryLevel 100 \
  --cellularMode active --cellularBars 4 --wifiMode active --wifiBars 3
status_bar_active=1

# Grant Calendar access *before* recording starts. The demo flow ends with
# Add to Calendar, and iOS's system consent alert (owned by SpringBoard,
# not our app — see capture-screenshots.sh for the same finding) would pop
# up mid-take and ruin the recording if access were still undetermined or
# denied. Granting up front means requestWriteOnlyAccessToEvents() is
# answered silently with .authorized and no alert ever appears.
xcrun simctl privacy "$udid" grant calendar "$BUNDLE_ID"

xcrun simctl terminate "$udid" "$BUNDLE_ID" 2>/dev/null || true
xcrun simctl launch "$udid" "$BUNDLE_ID" >/dev/null
sleep 6

cat <<'FLOW'

Recording starts now. Drive this flow in the simulator, unhurried:

  1. Scroll the season list a little                      (~3s)
  2. Tap "Venues" to expand it, tap a venue, then tap
     "Categories" and tap a category                       (~6s)
  3. Collapse the panel, then search for a presenter or
     event name                                            (~5s)
  4. Open an event's detail view, scroll to the article links (~5s)
  5. Tap Add to Calendar, show the sheet                   (~4s)

Calendar access has already been granted, so no system permission alert
should interrupt step 5.

Aim for 20-25 seconds of recorded footage. Press Enter here when done.
(Press Enter, NOT Ctrl-C — Ctrl-C kills the script before it can encode.)

FLOW

xcrun simctl io "$udid" recordVideo --codec h264 --force "$RAW" &
RECORD_PID=$!
recording_active=1
read -r _
kill -INT "$RECORD_PID" 2>/dev/null || true
wait "$RECORD_PID" 2>/dev/null || true
recording_active=0

xcrun simctl status_bar "$udid" clear
status_bar_active=0
xcrun simctl privacy "$udid" revoke calendar "$BUNDLE_ID"

duration=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$RAW")
echo "Recorded ${duration}s"

# Validate before handing anything to `bc`: ffprobe can exit 0 with an
# empty stdout (bc then sees `(( "" ))`, which is 0/false — the guard
# below would silently PASS a too-short or unreadable clip), and a
# malformed value like "N/A" only happens to be rejected on some bc
# builds by parsing stray letters as base-36 digits (bc 7.0.3 quirk) —
# not a real check. Require a well-formed non-negative number first.
if ! [[ "$duration" =~ ^[0-9]+(\.[0-9]+)?$ ]]; then
  echo "error: could not read a valid duration from the recording — the file may be truncated." >&2
  exit 1
fi

# Trim to 30s max; Apple rejects anything longer. Shorter than 15s is also
# rejected, so fail loudly rather than silently shipping a too-short clip.
if (( $(echo "$duration < 15" | bc -l) )); then
  echo "error: ${duration}s is under Apple's 15s minimum — re-record." >&2
  exit 1
fi

ffmpeg -y -i "$RAW" \
  -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100 \
  -t 30 \
  -vf "scale=1320:2868:force_original_aspect_ratio=decrease,pad=1320:2868:(ow-iw)/2:(oh-ih)/2,fps=30" \
  -c:v libx264 -profile:v high -pix_fmt yuv420p -crf 18 \
  -c:a aac -b:a 128k -shortest \
  -movflags +faststart \
  "$FINAL"

echo
ffprobe -v error -show_entries stream=codec_type,codec_name,width,height,duration \
  -of default=noprint_wrappers=1 "$FINAL"
echo
echo "Preview written to $FINAL"
echo "Upload it in App Store Connect and pick a poster frame."
