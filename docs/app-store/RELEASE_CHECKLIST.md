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

  **No App Preview has been recorded yet, as of this writing.** It is
  deliberately not scripted end-to-end: `ios/Scripts/record-preview.sh`
  produces the encoded video, but a human still has to drive the demo flow
  in the Simulator (or on a device, per Appendix B) while it captures —
  faking that step was considered and correctly rejected. The App Preview
  is optional; the listing is complete and submittable without one. Skip
  the re-record instruction above, and Step 7's preview upload, until
  someone actually records one.

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
  their respective device-size slots. If an App Preview video exists (see
  the note in Step 1 — none has been recorded as of this writing), upload
  it and choose a poster frame (the still image shown before the video
  plays) that reads clearly at thumbnail size. The App Preview is optional;
  skip this part of the step and submit with screenshots alone if no
  preview has been recorded.

- [ ] **8. Paste copy from `listing-fields.json`.**
  Fill in every App Store Connect text field from
  `docs/app-store/listing-fields.json`, using
  `docs/app-store/listing-copy.md` for the field-to-location mapping
  (name, subtitle, promotional text, keywords, description, what's new,
  copyright, categories, marketing URL). Copy values verbatim — do not
  paraphrase or re-type from memory.

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
