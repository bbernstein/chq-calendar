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
# screenshot-plan.json top-level "capture" block (run-wide, #222):
#   "frozenNow"        - "yyyy-MM-dd HH:mm:ss" NY wall-clock the whole run is
#                        pinned to, via the app's DEBUG-only
#                        -uitest-freeze-now hook. THIS IS THE ONE KNOB for
#                        "what day do the screenshots show" — change it here
#                        and every shot moves together.
#   "pinYear"          - dataset year the whole run is pinned to, via the
#                        DEBUG-only -uitest-pin-year hook. Necessary as well
#                        as frozenNow, not instead of it: the app takes its
#                        year from the server's years.json manifest, not from
#                        the clock, so once that manifest names a later
#                        default season a clock-only pin would render the
#                        *next* season's events under a summer-2026 clock.
#                        Only useful while all-events-<pinYear>.json is still
#                        being served from CloudFront.
#   Both are prepended to every automated shot's args, EXCEPT where the shot
#   already passes that same flag itself (see 01-season and 07-my-day, whose
#   dates are coupled to specific event data and are documented in their
#   "note"). Omit either key to disable that pin run-wide.
#
# screenshot-plan.json shot schema (per shot):
#   "note"             - optional operational caveat, printed for this shot
#                        regardless of whether it's automated or manual (e.g.
#                        01-season's live-production-data dependency). Not
#                        instructions to follow — just something a future
#                        operator should know when looking at the result.
#   "manualNote"        - optional, manual shots only (see "manual" below):
#                        capture instructions, since simctl can't drive them.
#   "launchArgs"       - args passed on every device (required, may be []).
#   "deviceLaunchArgs" - optional map of { "<device key>": [extra args] },
#                        appended after "launchArgs" for that device only.
#                        Use this when the same shot id needs to differ by
#                        device — e.g. iPad's wider NavigationSplitView has
#                        a detail column that a plain iPhone-oriented launch
#                        leaves empty ("Select an event"/blank), so 01/02/03
#                        populate it only under "ipad-13", while iPhone
#                        (single column, nothing to populate) launches with
#                        just "launchArgs" as before. 02/03 use
#                        "-uitest-select-linked-event"; 01 uses
#                        "-uitest-select-event-index 1" instead, because
#                        04-detail already selects index 0 and on iPad both
#                        columns are always visible — sharing the flag made
#                        01 and 04 byte-identical captures. Order is
#                        launchArgs first,
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

# Run-wide launch pins (see the "capture" block notes at the top of this
# file). `// empty` leaves the variable empty when the key is absent, which
# the merge below reads as "don't inject this pin."
FROZEN_NOW=$(jq -r '.capture.frozenNow // empty' "$PLAN")
PIN_YEAR=$(jq -r '.capture.pinYear // empty' "$PLAN")

# Validate every pin value in the plan before touching a simulator.
#
# This is a hard gate rather than a nicety because of how the app fails, in
# either of two ways, neither of them loud:
#   - A value the app's parser rejects makes
#     `AppModel.launchNow()`/`launchPinnedYear()` fall back to the real clock
#     and the server's default season *exactly as if the flag were never
#     passed*. The run completes, the dimension and quality checks pass, and
#     it silently produces screenshots of "now" — the precise failure this
#     whole mechanism exists to prevent, in its least visible form.
#   - Worse, the app's parsers are not the backstop they look like. Swift's
#     `Int("-5")` *succeeds*, so `-uitest-pin-year -5` pins year -5 and the
#     app goes looking for `all-events--5.json`. Nothing downstream of the
#     flag has an opinion about whether a year is plausible.
# Either way a typo has to stop the run here, where there is somewhere to
# print an error to. These regexes are the only plausibility check in the
# system, not a second one.
#
# The date pattern is deliberately stricter than `ChqTime.parse`, which
# accepts variable-width numeric fields (see that function's doc comment:
# "2026-8-9" parses as August 9th, and "26-08-09" as year *26*). Ambiguous
# input that would parse to something other than what it looks like is
# rejected here rather than captured. It is a shape check, not a calendar
# check — "2026-02-31 09:41:00" passes this and is left to the app.
FROZEN_NOW_PATTERN='^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$'

# Every value following `$1` in the plan's shots.
#
# Scans exactly what a launch receives: `launchArgs + deviceLaunchArgs[key]`,
# once per device key (or the bare `launchArgs` for a shot that declares no
# per-device args). Scanning the two lists *separately* would be both too
# strict and too loose — it would reject a pair that happens to straddle the
# join (which the app reads fine, since it only ever sees the concatenation)
# while still needing its own answer for a flag left dangling at the very
# end. A value appearing in `launchArgs` is therefore checked once per
# device; re-checking a good value costs nothing.
#
# A flag with nothing after it in the merged list yields the sentinel below,
# so it fails the format check with a message rather than reading as `null`.
plan_values_after() {
  jq -r --arg flag "$1" '
    [ (.shots // [])[]
      | (.launchArgs // []) as $base
      | ((.deviceLaunchArgs // {}) | [ .[] ]) as $devs
      | (if ($devs | length) == 0 then [$base] else ($devs | map($base + .)) end)
      | .[]
    ]
    | map(. as $a | [ range(0; ($a|length))
                      | select($a[.] == $flag)
                      | ($a[.+1] // "<nothing follows the flag>") ]) | add // []
    | .[]' "$PLAN"
}

check_frozen_now() {
  local value="$1" where="$2"
  [[ "$value" =~ $FROZEN_NOW_PATTERN ]] && return 0
  echo "error: $where is not \"yyyy-MM-dd HH:mm:ss\": '$value'" >&2
  echo "       The app would reject it and silently capture the REAL clock." >&2
  exit 1
}

check_pin_year() {
  local value="$1" where="$2"
  [[ "$value" =~ ^[0-9]{4}$ ]] && return 0
  echo "error: $where is not a 4-digit year: '$value'" >&2
  echo "       The app would ignore it and silently capture the server's default season." >&2
  exit 1
}

[ -z "$FROZEN_NOW" ] || check_frozen_now "$FROZEN_NOW" "capture.frozenNow"
[ -z "$PIN_YEAR" ] || check_pin_year "$PIN_YEAR" "capture.pinYear"
while read -r value; do
  check_frozen_now "$value" "a shot's own -uitest-freeze-now"
done < <(plan_values_after "-uitest-freeze-now")
while read -r value; do
  check_pin_year "$value" "a shot's own -uitest-pin-year"
done < <(plan_values_after "-uitest-pin-year")

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
  echo "    clock pinned to ${FROZEN_NOW:-<real clock>}, dataset year pinned to ${PIN_YEAR:-<server default>}"
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
    # Merge the run-wide capture pins with the device-agnostic launchArgs
    # and this device's deviceLaunchArgs[key] (if any) — see the schema
    # notes at the top of this file. `--arg k "$key"` keys into the
    # per-device map; `// []` makes the field fully optional so shots that
    # don't need it need not mention it at all.
    #
    # A pin is injected only when the shot does not already carry that flag
    # itself, in EITHER list — `$explicit` is the concatenation of both, so
    # a per-device override suppresses the run-wide default just as a
    # per-shot one does. That is what keeps 01-season's and 07-my-day's own
    # `-uitest-freeze-now` values (each tied to specific event data — see
    # their notes in the plan) authoritative while every other shot follows
    # the single run-wide knob.
    mapfile -t args < <(jq -r --arg k "$key" --arg frozen "$FROZEN_NOW" --arg pin "$PIN_YEAR" '
        ((.launchArgs // []) + (.deviceLaunchArgs[$k] // [])) as $explicit
      | (if $frozen != "" and ($explicit | index("-uitest-freeze-now")) == null
         then ["-uitest-freeze-now", $frozen] else [] end)
      + (if $pin != "" and ($explicit | index("-uitest-pin-year")) == null
         then ["-uitest-pin-year", $pin] else [] end)
      + $explicit
      | .[]' <<<"$shot")

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
  done < <(jq -c '.shots[] | select(.manual != true)' "$PLAN")

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

# Prints "note" (operational caveats — not instructions) for every shot
# that has one, automated or manual alike. This is what surfaces
# 01-season's live-production-data caveat: it's an automated shot (no
# "manual" key), so it would otherwise never reach the manual-only block
# below.
notes=$(jq -r '.shots[] | select(.note != null) | "  - \(.id): \(.note)"' "$PLAN")
if [ -n "$notes" ]; then
  echo
  echo "NOTES on the shots just captured:"
  echo "$notes"
fi

# Prints any shots marked "manual": true in the plan, with their
# "manualNote", so a human bootstrapping a fresh checkout isn't stuck
# rediscovering an interaction that isn't automatable from the command
# line. The capture loop above skips these (there's nothing `simctl
# launch` can do for them — e.g. 10-widget lives on SpringBoard, not in
# the app); their raw PNGs are taken by hand into out/raw/<key>/<id>.png,
# after which compose-screenshots.py picks them up like any other shot.
manual_notes=$(jq -r '.shots[] | select(.manual == true) | "  - \(.id): \(.manualNote // "manual interaction required, no note recorded")"' "$PLAN")
if [ -n "$manual_notes" ]; then
  echo
  echo "MANUAL STEPS STILL REQUIRED before these shots are store-ready:"
  echo "$manual_notes"
fi

echo
echo "Raw captures written to $OUT_ROOT"
echo "Next: python3 $SCRIPT_DIR/compose-screenshots.py"
