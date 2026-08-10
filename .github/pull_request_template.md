## What changed

<!-- One or two sentences. -->

## Why

<!-- The problem this solves. -->

## Verification

<!-- Commands run and their result. Paste output for anything non-obvious. -->

- [ ] `npm run build --workspace=frontend`
- [ ] `npm run validate --workspace=backend` (if backend changed)
- [ ] `cd ios && xcodebuild test ...` (if iOS changed)

## App Store listing

<!-- Only applies to PRs touching ios/ChqCalendar/Features, /App, or Assets.xcassets. -->

- [ ] Screenshots regenerated (`ios/Scripts/capture-screenshots.sh` + `compose-screenshots.py`) and the manifest committed
- [ ] `docs/app-store/listing-copy.md` re-read for claims this change invalidates
- [ ] Not applicable — no visual change (add `[skip-screenshots: reason]` above to satisfy CI)
