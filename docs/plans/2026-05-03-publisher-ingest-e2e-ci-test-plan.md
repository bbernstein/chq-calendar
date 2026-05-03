# Plan — Automated end-to-end test for publisher disable→retract in CI

**Status:** scoped, not started.
**Suggested branch:** `feat/publisher-ingest-e2e-ci-test`.
**Origin:** the disable→retract fix shipped in PR #78 had no automated post-deploy validation. The current `deploy-production.yml` post-deploy step only checks `/health`, calendar event count > 0, and frontend load — none of which would catch a regression in the publisher disable retraction flow.

## Problem this addresses

When PR #78 merged and auto-deployed, the publisher-ingest Lambda wasn't even being shipped (separate fix in `fix/deploy-publisher-ingest-lambda`). Even after that fix, the deploy workflow has no automated check that the disable→retract loop actually works against real DynamoDB + real S3 sidecar. Today the only way to validate is manual: `aws dynamodb` + `aws lambda invoke` + `curl` the sidecar.

A future regression — e.g. a refactor that re-introduces a separate `listDisabled()` Scan that fails silently, or a change to the sidecar publisher that drops the `data` array shape — would only be caught by a human running through the same manual sequence.

## Goal

After this PR, every production deploy runs an automated end-to-end test that:

1. Confirms the publisher-ingest Lambda is the just-deployed version.
2. Enables a dedicated CI test publisher.
3. Triggers ingest synchronously.
4. Asserts the publisher's events appear in the sidecar JSON within a bounded wait.
5. Disables the publisher.
6. Triggers ingest synchronously.
7. Asserts the publisher's events disappear from the sidecar JSON within a bounded wait.
8. Cleans up state on success **and** failure (publisher restored to a known baseline; orphaned events purged).

The test is gated behind a feature flag / env var so it can be skipped if the AWS account doesn't have the test publisher provisioned (e.g. local `act` runs, or future preview environments).

## Non-goals

- A test against the real `bbtest` publisher with its real-world feed. The test should own a dedicated `ci-e2e-test` publisher whose feed is a static JSON file under our control, so the test isn't subject to a third-party site going down.
- A unit-test rewrite. The 3 integration tests already in `publisherIngestHandler.integration.test.ts` cover the logic against mocks; this plan is about catching deploy-side regressions (Lambda version mismatch, IAM, Terraform drift, sidecar publisher errors, S3 cache TTLs).
- Replacing the manual smoke-test sequence the user is already comfortable running. The CI test runs alongside it.

## Design

### Test publisher resource

A dedicated publisher registered in `chautauqua-calendar-publishers`:

| Field | Value |
|-------|-------|
| `id` | `ci-e2e-test` |
| `name` | `[CI] End-to-end deploy test` |
| `contactEmail` | `bernard+ci-e2e@thebernsteins.com` (or similar — non-deliverable) |
| `sourceUrl` | `https://www.chqcal.org/cache/ci-e2e/feed.json` (a static file we control on S3) |
| `sourceType` | `json` |
| `trustLevel` | `auto` |
| `enabled` | `false` (default state — flipped by the test) |
| `createdAt` | set at provisioning time |

The `sourceUrl` points to a static JSON file deployed alongside the frontend (so we control its contents and don't depend on a third-party site). The feed declares 1 or 2 events with `[CI-E2E]` prefixes in their titles so they're visually distinct on the public calendar if the test ever leaks.

The publisher row should be provisioned via Terraform (so the test is self-contained and CI-account-portable) — likely a new `infrastructure/ci-e2e-publisher.tf` that's gated by a `var.enable_ci_e2e_publisher` flag (default `true` in prod tfvars).

### Where the test runs

Inline step in `.github/workflows/deploy-production.yml`, immediately after the existing `Run post-deployment tests` step. Justification: the existing post-deploy step is already production-side and uses AWS CLI; adding the publisher test here keeps the entire post-deploy validation in one place.

If we ever add a staging environment, the same step works there too — just point at a different account via the existing `AWS_ROLE_ARN` secret.

### Test sequence (bash)

Pseudo-code for the workflow step:

```bash
PUBLISHER_ID="ci-e2e-test"
PUBLISHERS_TABLE="chautauqua-calendar-publishers"
SIDECAR_URL="https://www.chqcal.org/cache/calendar-cache/publisher-events-2026.json"
LAMBDA="chautauqua-calendar-publisher-ingest"

set -euo pipefail

cleanup() {
  # Cleanup must never propagate a failure: if a real test step already
  # failed, surfacing a cleanup error on top of it loses the original
  # signal. Disable -e for the body and || true each AWS call.
  set +e
  echo "[ci-e2e] cleanup: disabling $PUBLISHER_ID and purging events"
  aws dynamodb update-item --table-name "$PUBLISHERS_TABLE" \
    --key "{\"id\":{\"S\":\"$PUBLISHER_ID\"}}" \
    --update-expression 'SET enabled = :f' \
    --expression-attribute-values '{":f":{"BOOL":false}}' || true
  # Final ingest to retract anything left
  aws lambda invoke --function-name "$LAMBDA" --invocation-type RequestResponse \
    --cli-binary-format raw-in-base64-out --payload '{}' /tmp/cleanup.json || true
}
trap cleanup EXIT

# 0. Verify Lambda was actually updated by this deploy (avoids the PR #78 trap).
LAST_MODIFIED=$(aws lambda get-function --function-name "$LAMBDA" \
  --query 'Configuration.LastModified' --output text)
DEPLOY_START="${{ github.event.head_commit.timestamp }}"
# Fail fast if Lambda's LastModified is older than the deploy commit.
# (Use a Python comparator in the workflow rather than bash date math to keep portability.)
python3 -c "
import sys; from datetime import datetime, timezone
lm = datetime.fromisoformat('$LAST_MODIFIED'.replace('Z','+00:00'))
ds = datetime.fromisoformat('$DEPLOY_START'.replace('Z','+00:00'))
sys.exit(0 if lm >= ds else 1)
" || { echo '::error::Lambda LastModified predates this deploy — code did not ship'; exit 1; }

# 1. Enable the test publisher
aws dynamodb update-item --table-name "$PUBLISHERS_TABLE" \
  --key "{\"id\":{\"S\":\"$PUBLISHER_ID\"}}" \
  --update-expression 'SET enabled = :t' \
  --expression-attribute-values '{":t":{"BOOL":true}}'

# 2. Trigger ingest, synchronously
aws lambda invoke --function-name "$LAMBDA" --invocation-type RequestResponse \
  --cli-binary-format raw-in-base64-out --payload '{}' /tmp/ingest1.json
cat /tmp/ingest1.json

# 3. Poll sidecar for the test events to appear (CloudFront cache busting via query string)
COUNT=0  # initialize so the post-loop check doesn't error if the loop body fails on iteration 1
for i in $(seq 1 30); do
  COUNT=$(curl -s "$SIDECAR_URL?cb=$(date +%s%N)" \
    | jq "[.data[]? | select(.sourcePublisherId==\"$PUBLISHER_ID\")] | length" || echo 0)
  if [ "$COUNT" -ge 1 ]; then
    echo "[ci-e2e] events present after ${i}s"
    break
  fi
  sleep 1
done
[ "$COUNT" -ge 1 ] || { echo '::error::Test events did not appear in sidecar'; exit 1; }

# 4. Disable the publisher
aws dynamodb update-item --table-name "$PUBLISHERS_TABLE" \
  --key "{\"id\":{\"S\":\"$PUBLISHER_ID\"}}" \
  --update-expression 'SET enabled = :f' \
  --expression-attribute-values '{":f":{"BOOL":false}}'

# 5. Trigger ingest again
aws lambda invoke --function-name "$LAMBDA" --invocation-type RequestResponse \
  --cli-binary-format raw-in-base64-out --payload '{}' /tmp/ingest2.json
cat /tmp/ingest2.json

# 6. Poll sidecar for the test events to disappear
COUNT=1  # initialize so the post-loop check fails-closed if the loop body errors on iteration 1
for i in $(seq 1 30); do
  COUNT=$(curl -s "$SIDECAR_URL?cb=$(date +%s%N)" \
    | jq "[.data[]? | select(.sourcePublisherId==\"$PUBLISHER_ID\")] | length" || echo 1)
  if [ "$COUNT" -eq 0 ]; then
    echo "[ci-e2e] events retracted after ${i}s"
    break
  fi
  sleep 1
done
[ "$COUNT" -eq 0 ] || { echo '::error::Test events were not retracted'; exit 1; }

echo "✅ Publisher disable→retract end-to-end test passed"
```

The `trap cleanup EXIT` ensures the publisher ends up `enabled: false` even if any step fails — important so a failed CI run doesn't leave `[CI-E2E]` events live on the public sidecar.

### Sidecar cache behavior

The sidecar JSON is served from CloudFront with a cache TTL. The test uses `?cb=$(date +%s%N)` query strings to bypass CloudFront cache, but **the underlying S3 object is what changes**. The publisher-ingest Lambda writes the new sidecar to S3 immediately at the end of `runIngest`, so the polling loop should see fresh content on the very first iteration in normal cases. If we observe sidecar lag in practice, the polling timeout (currently 30s) is the safety margin.

### Provisioning the test publisher

Two options:

1. **Terraform** — add `infrastructure/ci-e2e-publisher.tf` that creates the DynamoDB item and uploads the static feed JSON to S3. Pro: declarative, lives with infra. Con: a Terraform apply is required before the test can run; first deploy after this PR will fail until apply is done.

2. **Workflow-side bootstrap** — first invocation of the test step checks if `ci-e2e-test` exists and, if not, creates it (publisher row + S3 feed file). Pro: zero out-of-band setup. Con: the bootstrap path is itself untested code.

**Recommendation:** option 1 (Terraform). The bootstrap-side complexity isn't worth saving one apply.

## Tests for the test

The CI test is itself code that can have bugs. Add one local test:

- Add a `backend/src/__tests__/ci-e2e-test.shape.test.ts` that runs the test bash logic with mocked AWS CLI (using a wrapper function and `jest.spyOn`) to verify the call sequence (`update-item enabled=true → invoke → poll → update-item enabled=false → invoke → poll → cleanup`). This catches typos in the bash without needing a real AWS run.

Lower priority — the workflow-step itself is short enough that visual review covers most issues. Skip if the bash tests feel like overkill.

## Verification before merge

```bash
# Local: validate the workflow YAML is parseable
yq '.jobs.deploy.steps[].name' .github/workflows/deploy-production.yml

# CI dry run via act (if installed) — won't actually hit AWS
act -j deploy --dryrun
```

End-to-end verification happens on the next merge to `main` after this PR. Watch the Actions log for the `Publisher disable→retract end-to-end test` step.

## Open questions

- **Should the test publisher row live in production DynamoDB at all,** or only in a separate staging account? Today there's only one AWS account, so the test publisher will sit in prod. Mitigations: `enabled: false` baseline, `[CI-E2E]` title prefix, dedicated `ci-e2e-test` ID so it can never be confused with `bbtest` or a real third-party publisher.
- **Cleanup window if cleanup itself fails.** If the `trap cleanup EXIT` somehow doesn't run (e.g. CI runner killed), the publisher could be left enabled with `[CI-E2E]` events live. Add a daily / hourly EventBridge rule that disables `ci-e2e-test` if `lastFetchedAt` is older than 1h, as a belt-and-suspenders safety net?
- **Test feed mutation strategy.** Should the test feed have a fixed event ID, or should each CI run mutate the feed to a unique ID (so we're testing insert + delete every run, not "events that happen to match")? Lean: fixed IDs, simpler; `enabled` toggle is what we're really testing.
- **What to do if Lambda LastModified check fails.** The check correctly catches the PR #78 scenario. Should it `exit 1` and fail the deploy, or just emit a warning? Lean: fail. A deploy that didn't actually deploy is a defect, not a soft warning.

## Files touched (estimated)

- `.github/workflows/deploy-production.yml` — new step `Publisher disable→retract end-to-end test` (~80 lines).
- `infrastructure/ci-e2e-publisher.tf` — new file: DynamoDB item + S3 object for the test publisher (~40 lines).
- `infrastructure/ci-e2e-feed.json` — new file: static feed JSON the test publisher serves (~30 lines).
- `docs/plans/2026-05-03-publisher-ingest-e2e-ci-test-plan.md` — this doc.
- (Optional) `backend/src/__tests__/ci-e2e-test.shape.test.ts` — bash-call-shape test.

## Out of scope (capture as follow-ups, do not bundle)

- Multi-publisher concurrency tests (e.g. enabled and disabled publishers simultaneously). Existing integration tests cover the call sequencing.
- Sidecar JSON schema tests. Already covered by `publisherSidecarPublisher.test.ts`.
- A staging environment. Big architectural change; the open question above is the first step.
