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
#
# screenshot-plan.json shot schema (per shot):
#   "launchArgs"       - args passed on every device (required, may be []).
#   "deviceLaunchArgs" - optional map of { "<device key>": [extra args] },
#                        appended after "launchArgs" for that device only.
#                        Use this when the same shot id needs to differ by
#                        device — e.g. iPad's wider NavigationSplitView has
#                        a detail column that a plain iPhone-oriented launch
#                        leaves empty ("Select an event"/blank), so 01/02/03
#                        add "-uitest-select-linked-event" only under
#                        "ipad-13" to populate it, while iPhone (single
#                        column, nothing to populate) launches with just
#                        "launchArgs" as before. Order is launchArgs first,
#                        then deviceLaunchArgs[<key>] — matters if a hook
#                        reads "the argument that follows a flag" (e.g.
#                        "-uitest-search <term>" — keep such flag+value
#                        pairs together within whichever list they start in).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IOS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PLAN="$SCRIPT_DIR/screenshot-plan.json"
OUT_ROOT="$SCRIPT_DIR/out/raw"
DERIVED="$SCRIPT_DIR/out/DerivedData"
BUNDLE_ID="org.chqcal.app"

command -v jq >/dev/null || { echo "error: jq is required (brew install jq)" >&2; exit 1; }
command -v python3 >/dev/null || { echo "error: python3 is required for the post-capture quality check" >&2; exit 1; }
python3 -c "import PIL" 2>/dev/null || { echo "error: Pillow is required (pip3 install Pillow)" >&2; exit 1; }
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

  # Reset the simulator to a known-empty state before capturing anything.
  #
  # Why: iOS's system Calendar-consent alert (EKEventStore's write-only
  # tier, triggered by 06-calendar) is owned by SpringBoard, not by our app.
  # It survives `simctl terminate` + `simctl launch` of our app — once it's
  # up, it sits on screen over every subsequent shot in the run, and over
  # every subsequent run against the same simulator instance, until the
  # simulator is rebooted or the alert is answered by a human tap. Neither
  # a later `simctl privacy grant` nor `simctl privacy revoke` dismisses an
  # alert that's already being displayed — they only change the TCC state
  # that's consulted the *next* time the app asks (confirmed by direct
  # testing: a stuck alert survived repeated grant/revoke/terminate/launch
  # cycles and only cleared after erasing the simulator).
  #
  # `simctl erase` wipes this simulator instance back to first-boot state
  # (all apps, settings, and any stuck system UI) — the only way to
  # guarantee a run starts clean regardless of what a previous run (or a
  # developer poking at the simulator by hand) left behind. Cost: ~20-40s
  # per device and it discards anything else installed on that specific
  # simulator instance. Given these are dedicated screenshot-capture
  # simulators, that's the right trade — determinism over speed.
  xcrun simctl shutdown "$udid" 2>/dev/null || true
  xcrun simctl erase "$udid"
  xcrun simctl boot "$udid"
  xcrun simctl bootstatus "$udid" -b

  # A freshly-erased simulator's *first* boot is also SpringBoard's first
  # boot, and it occasionally surfaces a one-time onboarding banner (e.g.
  # "Ready for Apple Intelligence", Spotlight suggestions) some seconds
  # after `bootstatus -b` returns "booted" — observed directly: one capture
  # run's 01-season.png (the very first shot taken after erase) came back
  # with this banner overlaid across the top of the frame, on a run where
  # an identical repeat produced a clean shot. These banners are ephemeral
  # (SpringBoard auto-dismisses them after a few seconds) and there's no
  # simctl API to pre-answer or suppress them the way `privacy` does for
  # TCC prompts, and touch injection isn't available to swipe them away —
  # so the only lever is time: idle here long enough that whatever fires
  # has already appeared *and* auto-dismissed before the shot loop's first
  # screenshot. This is a best-effort mitigation, not a guarantee (no fixed
  # delay can be proven to outlast every future banner), but is (re-)caught
  # if it recurs by check-screenshots.py's boxed-region signal for the
  # non-modal shots it does cover; the top-band exemption in that check
  # exists because ordinary header chrome lives there, so this timing fix
  # is the primary defense for this specific failure mode.
  sleep 20

  # A clean, Apple-style status bar. Without this the shots carry a real
  # clock and a partial battery, which looks sloppy in the store listing.
  xcrun simctl status_bar "$udid" override \
    --time "9:41" --batteryState charged --batteryLevel 100 \
    --cellularMode active --cellularBars 4 --wifiMode active --wifiBars 3
  xcrun simctl install "$udid" "$app_path"

  # Explicitly *deny* Calendar access before any shot runs. An explicitly
  # denied authorization answers `requestWriteOnlyAccessToEvents()`
  # immediately with `.denied` — no system prompt — which is what keeps
  # 01-05 (none of which touch Calendar) deterministically clean even if a
  # future code change adds an incidental EventKit call. Right before the
  # one shot that actually needs the granted state (marked
  # `needsCalendarAccess` in the plan, below), we flip this to `grant`.
  xcrun simctl privacy "$udid" revoke calendar "$BUNDLE_ID"

  # Process substitution, NOT `jq ... | while`: a piped while loop runs in a
  # subshell, so the dimension check's `exit 1` below would abort only the
  # subshell and let the script report success on bad screenshots.
  while read -r shot; do
    id=$(jq -r '.id' <<<"$shot")
    settle=$(jq -r '.settleSeconds' <<<"$shot")
    needs_calendar=$(jq -r '.needsCalendarAccess // false' <<<"$shot")
    # Merge the device-agnostic launchArgs with this device's
    # deviceLaunchArgs[key] (if any) — see the schema note at the top of
    # this file. `--arg k "$key"` keys into the per-device map; `// []`
    # makes the field fully optional so shots that don't need it need not
    # mention it at all.
    mapfile -t args < <(jq -r --arg k "$key" \
      '(.launchArgs // []) + (.deviceLaunchArgs[$k] // []) | .[]' <<<"$shot")

    if [ "$needs_calendar" = "true" ]; then
      xcrun simctl privacy "$udid" grant calendar "$BUNDLE_ID"
    fi

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

    # Revoke immediately after the one shot that was granted access, back to
    # the deterministic "denied" default set before this loop started. Without
    # this, a shot inserted later in screenshot-plan.json (after the one
    # marked needsCalendarAccess) would silently inherit the granted TCC
    # state from this launch and could resurface the exact consent-alert bug
    # fixed above — better to re-assert "denied" every time than to rely on
    # ordering (today: needsCalendarAccess only fires on the last shot,
    # 06-calendar, but this makes that ordering non-load-bearing).
    if [ "$needs_calendar" = "true" ]; then
      xcrun simctl privacy "$udid" revoke calendar "$BUNDLE_ID"
    fi
  done < <(jq -c '.shots[]' "$PLAN")

  xcrun simctl status_bar "$udid" clear

  # Content sanity checks beyond pixel dimensions: no two shots in this set
  # may be byte-identical (a scroll/state hook that silently no-op'd), and
  # no shot may show the signature luminance drop of a system alert or
  # other screen-dimming overlay. See check-screenshots.py for the method
  # and thresholds. This is a hard gate — a run that produces unusable
  # screenshots must not report success.
  python3 "$SCRIPT_DIR/check-screenshots.py" --plan "$PLAN" "$out_dir"

  echo "==> $key done: $out_dir"
done

# Prints any shots still marked "manual": true in the plan, with their
# "manualNote", so a human bootstrapping a fresh checkout isn't stuck
# rediscovering an interaction that isn't automatable from the command
# line. Nothing in the current plan needs this (see screenshot-plan.json),
# but the mechanism is kept for whatever hits it next.
manual_notes=$(jq -r '.shots[] | select(.manual == true) | "  - \(.id): \(.manualNote // "manual interaction required, no note recorded")"' "$PLAN")
if [ -n "$manual_notes" ]; then
  echo
  echo "MANUAL STEPS STILL REQUIRED before these shots are store-ready:"
  echo "$manual_notes"
fi

echo
echo "Raw captures written to $OUT_ROOT"
echo "Next: python3 $SCRIPT_DIR/compose-screenshots.py"
