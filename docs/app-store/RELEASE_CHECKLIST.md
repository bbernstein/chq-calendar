# App Store release checklist — CHQ Calendar (iOS)

Ordered, one-shot procedure for taking a build from source to "Submitted for
Review" in App Store Connect. Work through the steps in order — later steps
assume earlier ones are done. Each step has a checkbox; do not check it off
until its verification (where one is given) actually passes.

Related documents:
- `docs/app-store/listing-fields.json` — single source of truth for all
  App Store Connect text fields.
- `docs/app-store/listing-copy.md` — explains the JSON and where each field
  goes in App Store Connect.
- `docs/app-store/privacy-nutrition-label.md` — the App Privacy
  questionnaire answer key, with evidence.

---

## Procedure

- [ ] **1. Regenerate assets.**
  Run `ios/Scripts/capture-screenshots.sh` to capture fresh device
  screenshots, then `ios/Scripts/compose-screenshots.py` to compose them into
  the framed/captioned images used for the listing. If any flow shown in the
  App Preview video changed since it was last recorded, re-record it with
  `ios/Scripts/record-preview.sh`. Do not reuse stale assets from a prior
  build number — screenshots and previews should reflect what the submitted
  build actually looks like.

  **A preview was recorded on 2026-08-01** and lives at
  `ios/Scripts/out/preview/`. Recording is deliberately not scripted
  end-to-end: `record-preview.sh` handles the capture and the encode, but
  a human has to drive the demo flow in the Simulator (or on a device,
  per Appendix B) while it runs. The App Preview is optional — the
  listing is complete and submittable without one.

  **Upload `iphone-6.9-safe.mp4`, not `iphone-6.9.mp4`.** The original
  encode came out at a container duration of 30.024s. Apple's hard limit
  is 30s, and the overshoot is an artifact of AAC frame granularity —
  audio frames are ~23ms, so the last one spills past the video's exact
  30.000s. `iphone-6.9-safe.mp4` is the same footage re-encoded to 29.5s
  with identical stream properties (1320×2868, H.264, yuv420p, 30fps,
  AAC). If you re-record, check the container duration with
  `ffprobe -show_entries format=duration` and trim if it lands at or
  above 30.

  `raw.mov` in that directory is the uncompressed intermediate (~119 MB).
  Safe to delete once the encode looks right.

- [ ] **2. Bump the build number.**
  In `ios/ChqCalendar.xcodeproj/project.pbxproj`, increment
  `CURRENT_PROJECT_VERSION` in **both** app-target configuration blocks
  (Debug and Release for the `ChqCalendar` app target — not the test target
  blocks, which version independently). Every TestFlight or App Store
  upload requires a build number that has never been used before for this
  app; App Store Connect rejects a duplicate. Confirm both blocks were
  changed:
  ```bash
  grep -n "CURRENT_PROJECT_VERSION" ios/ChqCalendar.xcodeproj/project.pbxproj
  ```
  Both app-target lines should show the new, matching value.

- [ ] **3. Verify the copy.**
  ```bash
  npm run test --workspace=frontend -- appStoreListing
  ```
  This runs `frontend/src/__tests__/appStoreListing.test.ts`, which checks
  `listing-fields.json` against Apple's character limits (subtitle,
  promotional text, keywords, description), required-field presence, keyword
  formatting, and that the description opens with the canonical disclaimer.
  Confirm it passes before continuing — do not paste copy into App Store
  Connect from a JSON that fails this test.

- [ ] **4. Archive and upload.**
  In Xcode: **Product → Archive**, then from the Organizer, **Distribute
  App → App Store Connect → Upload**. Wait for the archive to build cleanly
  (no signing errors) before distributing.

- [ ] **5. Create the version in App Store Connect and attach the processed
  build.**
  In App Store Connect, create the new version (e.g. "1.0") under the iOS
  App, then wait for the uploaded build to finish processing and attach it
  to that version via **Build → Add Build**.

  App Store Connect's layout shifts between redesigns, so treat the
  labels below as "look for something like this" rather than exact
  strings. The sequence has been stable for years even when the wording
  has not.

  **5a. Wait for processing to finish.** After the Step 4 upload, the
  build is unusable until Apple finishes processing it. Go to
  **appstoreconnect.apple.com → Apps → CHQ Calendar → TestFlight** and
  watch the build's status. It moves through *Processing* → *Ready to
  Submit* (or *Ready to Test*). This usually takes 10–60 minutes. Apple
  emails you when it completes — subject line resembles *"Version 1.0
  (2) for CHQ Calendar has completed processing."* **Do not continue
  until this finishes**; a still-processing build simply will not appear
  in the picker in 5d, which is the single most common reason people
  think this step is broken.

  **5b. Open or create the version.** In the left sidebar of the app's
  page there is a **iOS App** section listing versions.

  - For a **first release**, App Store Connect usually pre-creates
    **"1.0 Prepare for Submission"** as soon as the app record exists.
    If you see it, click it and skip to 5c.
  - If it is not there, click the **+** beside *iOS App* (labelled
    something like **Add Version or Platform**), choose **iOS**, enter
    the version number **1.0**, and confirm.

  The version number here must match the build's `MARKETING_VERSION`
  (currently `1.0`). A build whose marketing version is `1.0` can only
  be attached to a `1.0` version — this is why 5d sometimes shows an
  empty list even for a fully processed build.

  **5c. Fill the metadata first (optional but easier).** Steps 7 and 8
  populate screenshots and copy on this same page. Doing them before
  attaching the build is fine and avoids scrolling past a half-filled
  form later. The page saves independently of the build attachment.

  **5d. Attach the build.** Scroll down the version page to the
  **Build** section. Before any build is attached it shows a prompt
  along the lines of *"Add the build that you want to submit"* with a
  **+** or **Add Build** control.

  1. Click it. A panel lists every processed build whose marketing
     version matches this version.
  2. **Pick build 2, not build 1.** Both are marketing version `1.0`,
     so both may appear. Build 1 is the original TestFlight upload and
     predates the sRGB icon profile, the export-compliance flag, the
     Travel category, and the About screen. Build 2 is the one this
     work produced. The picker shows the build number in parentheses:
     `1.0 (2)`.
  3. Confirm (**Done** / **Select**).
  4. Click **Save** at the top right of the version page. The
     attachment is not persisted until you save.

  **5e. Verify it took.** The Build section should now show `1.0 (2)`
  with the app icon beside it instead of the add-a-build prompt. That
  icon appearing here is the first confirmation that Step 6 will pass.

  **If the build list is empty in 5d**, work through these in order:
  processing not finished (5a); marketing version mismatch between the
  build and the version you created (5b); or the upload silently failed
  — re-check Xcode's Organizer, where a failed distribution shows an
  error rather than a delivered status. Export compliance is *not* a
  cause here: `ITSAppUsesNonExemptEncryption = NO` is set in the
  Info.plist, so no compliance prompt should block the build.

- [ ] **6. Confirm the icon renders on the App Store tab.**
  After attaching the build, check that the app icon appears correctly on
  the version's App Store tab (not just in TestFlight). **A TestFlight-only
  upload will NOT populate the App Store product-page icon** — the
  App Store tab's icon is derived specifically from a build that has been
  attached to a version, not merely uploaded. If the icon is blank or shows
  a placeholder here, see Appendix A before assuming something is wrong with
  the binary.

- [ ] **7. Upload screenshots and the preview; choose a poster frame.**
  Upload the iPhone 6.9" and iPad 13" screenshot sets produced in Step 1 to
  their respective device-size slots. The full-resolution files are in
  `ios/Scripts/out/final/{iphone-6.9,ipad-13}/` — **not** the ~400px
  copies in `docs/app-store/screenshots/review/`, which exist for PR
  review and would be rejected as undersized.

  Then upload the App Preview from `ios/Scripts/out/preview/` — see
  Step 1 for which file — and choose a poster frame (the still shown
  before the video plays) that reads clearly at thumbnail size. The
  preview is optional; screenshots alone are a complete submission.

- [ ] **8. Paste copy from `listing-fields.json`.**

  **Render it to plain text first — do not paste out of the JSON.**

  ```bash
  python3 ios/Scripts/render-listing-copy.py
  ```

  `listing-fields.json` is machine-readable, so its three multi-line
  values (`description`, `whatsNew`, `reviewNotes`) carry `\n` escapes.
  Those are JSON syntax, not content: pasting them straight into an App
  Store Connect text area puts a literal backslash-n on screen. The
  other twelve fields are single-line and would paste fine, but render
  them anyway so every field comes from one place.

  The renderer writes one file per field to
  `ios/Scripts/out/listing/` (gitignored, regenerated every run) with
  real newlines, and re-checks Apple's character limits before writing.
  Open each file and copy its whole contents. Start with the generated
  `README.txt`; use `docs/app-store/listing-copy.md` for the
  field-to-location mapping. Copy values verbatim — do not paraphrase or
  re-type from memory.

  Note that `reviewNotes` belongs in the **App Review Information**
  section, not the localisation fields, and that categories and age
  rating are pickers rather than text fields (their values are listed in
  the generated `README.txt`).

  The output directory matches fastlane `deliver`'s metadata layout, so
  the same files can drive an automated upload later — see
  Appendix C.

- [ ] **9. Verify the copyright string matches the Apple Developer account
  holder name exactly.**
  The repo value in `listing-fields.json` is `© 2026 Bernard Bernstein`.
  Compare this against the legal entity/individual name registered on the
  Apple Developer account (Account → Membership details in App Store
  Connect / Apple Developer). **App Store Connect's registered name is the
  system of record here** — if the account is registered under a different
  legal form (e.g. a company name, or a differently formatted personal
  name), correct `listing-fields.json` to match the account, not the other
  way around, then re-run Step 3 before pasting.

- [ ] **10. Answer the questionnaires.**
  - **App Privacy**: answer exactly per
    `docs/app-store/privacy-nutrition-label.md` — declare Usage Data →
    Product Interaction, Not Linked to You, Not Used for Tracking; nothing
    else collected. Do not answer "Data Not Collected" for this app.
  - **Age Rating**: 4+.
  - **Export Compliance**: no prompt should appear — this is already
    declared in the Info.plist via
    `INFOPLIST_KEY_ITSAppUsesNonExemptEncryption = NO` in the app-target
    build settings. If App Store Connect does prompt for export compliance
    information despite this, stop and check the build setting before
    answering ad hoc; it should not need a manual answer.

- [ ] **11. Paste App Review Notes** from `listing-fields.json` →
  `reviewNotes` into **App Review Information → Notes**.

- [ ] **12. Submit for review.**

---

## Release notes for the next version

Track user-visible changes here as they land, then fold the accepted
bullets into `whatsNew` in `listing-fields.json` (Step 8) when preparing
the next submission.

- Filtering moved to the bottom of the screen: two controls — the date
  range and a filter count — beside the search field, each opening a
  sheet. About a third more of the screen is now event list.

**Pending, not yet shipped** (do not fold into `whatsNew` until the PR
that makes this change actually lands):

- Tapping the star on a row will no longer toggle a favorite; the action
  moves to swipe-right or press-and-hold. Event rows are unchanged in the
  filtering-chrome PR — this lands with a later PR.

## Appendix A — Icon troubleshooting

Verified facts about the current build (checked independently of any single
review pass): the binary's icon asset is compliant — 1024×1024, opaque,
sRGB colorspace, present in `Assets.car` for both the `phone` and `pad`
idioms, with `CFBundleIconName` set.

Verification command, run against a built `.app`:

```bash
APP=<path to built .app>
xcrun --sdk iphoneos assetutil --info "$APP/Assets.car" 2>/dev/null \
  | grep -E '"AssetType"|"Colorspace"|"Opaque"|"PixelWidth"'
```

Expect `"AssetType" : "Icon Image"` entries at `"PixelWidth" : 1024`,
`"Colorspace" : "srgb"`, `"Opaque" : true`, for both idioms.

**Escalation:** if the App Store product-page icon is still missing 24
hours after a build carrying this sRGB profile has finished processing
**and** has been attached to a version (Step 5/6 above — not merely
uploaded to TestFlight), open an App Store Connect support ticket and
attach the `assetutil` output above as evidence that the uploaded binary is
compliant. Do not re-upload or re-archive speculatively before escalating —
the binary is already known-good; a missing icon at that point is an App
Store Connect processing issue, not a build defect.

## Appendix B — Preview video fallback

If the App Preview video is rejected for appearing simulator-captured,
re-record it from a physically connected iPhone instead of the simulator:

1. Connect the iPhone via cable.
2. Open **QuickTime Player → File → New Movie Recording**.
3. Click the dropdown next to the record button and select the connected
   iPhone as the camera (and its microphone, if audio is wanted).
4. Record the same flows the rejected preview showed, trimmed to
   **15-30 seconds**.
5. Run the resulting recording through the same `ffmpeg` encode step used
   inside `ios/Scripts/record-preview.sh` (matching resolution/codec/bitrate
   expectations) rather than uploading the QuickTime capture directly.

## Appendix C — Automating the metadata upload (optional)

Everything above assumes manual pasting, which is fine for one or two
releases a year. If that becomes tedious, the listing text can be pushed
to App Store Connect programmatically. Nothing here is required to ship.

**What is already in place.** `ios/Scripts/render-listing-copy.py` writes
`ios/Scripts/out/listing/` in fastlane `deliver`'s metadata layout —
`en-US/description.txt`, `en-US/keywords.txt`,
`review_information/notes.txt`, and so on. That directory is a valid
`--metadata_path` as-is.

**What is missing.**

1. **fastlane.** Not installed. The system Ruby is 2.6.10, which fastlane
   supports, but installing gems against the system Ruby needs `sudo` and
   is generally regretted. Prefer a version manager (`rbenv`, `asdf`) or
   Homebrew's Ruby, then `gem install fastlane`.
2. **An App Store Connect API key.** In App Store Connect: **Users and
   Access → Integrations → App Store Connect API → +**. Give it the
   *App Manager* role. You get three things: an **Issuer ID**, a **Key
   ID**, and a **`.p8` private key file that downloads exactly once**.
   Store the `.p8` outside the repository and never commit it — it grants
   write access to the developer account. Add it to `.gitignore` before
   it lands anywhere near the tree.
3. **A `Deliverfile`** for the settings that are not text files —
   primary/secondary category, age-rating questionnaire answers, and the
   app's bundle identifier.

**Roughly what the run looks like:**

```bash
fastlane deliver \
  --api_key_path /path/outside/repo/asc-key.json \
  --metadata_path ios/Scripts/out/listing \
  --screenshots_path ios/Scripts/out/final \
  --skip_binary_upload
```

**Worth knowing before committing to this.** The App Privacy
questionnaire (the nutrition label in
`docs/app-store/privacy-nutrition-label.md`) is **not** covered by
`deliver` and stays manual. Neither is the final "Submit for Review"
click, which is deliberate. So automation removes the copy-pasting and
the screenshot uploads, not the whole submission.

**Also worth knowing:** the screenshot directory layout `deliver`
expects is not identical to `ios/Scripts/out/final/<device-key>/`. It
keys directories by its own device names. That mapping would need adding
to `render-listing-copy.py` or handled by a `Deliverfile`, and has not
been done — do not assume `--screenshots_path` works untouched.
