# Runbook — post-deploy publisher smoke failure

**Triggered by:** the "Post-deploy publisher-lifecycle smoke" step in
`.github/workflows/deploy-production.yml` going red.

**What it means:** the deploy itself succeeded (Lambda code + frontend
artifacts shipped) but the post-deploy verification couldn't drive the
bbtest publisher through its full lifecycle. Production may still be
serving correctly — the smoke is an end-to-end check of the publisher
ingest path, not a health check.

---

## Manual one-time setup (BEFORE the smoke can ever run green)

The smoke is gated by three GitHub repo secrets and two Lambda env vars.
Until ALL of these are populated, the smoke step exits with
`describe.skip` (the workflow stays green but the test never executes).

### 1. GitHub repo secrets

Set these in **Settings → Secrets and variables → Actions**:

| Secret name | Value |
|---|---|
| `SMOKE_BBTEST_EMAIL` | The email address of the existing `bbtest` publisher (per the cleanup-followups memo). |
| `SMOKE_ADMIN_SIGNING_KEY` | A 256-bit random value, e.g. `openssl rand -hex 32`. MUST match the Lambda env value below. |
| `SMOKE_CAPTCHA_BYPASS_TOKEN` | A separate 256-bit random value. MUST match the Lambda env value below. |

### 2. Terraform variables → Lambda env

Set these as terraform variables (e.g. via `terraform.tfvars` not checked
into git, or via `TF_VAR_*` env vars in your wrapper script):

```hcl
admin_smoke_signing_key = "<same value as SMOKE_ADMIN_SIGNING_KEY>"
captcha_bypass_token    = "<same value as SMOKE_CAPTCHA_BYPASS_TOKEN>"
smoke_bbtest_email      = "<same value as SMOKE_BBTEST_EMAIL>"
```

Then run `terraform apply` in `infrastructure/`. This wires the values
into the admin Lambda's environment as `ADMIN_SMOKE_SIGNING_KEY`,
`CAPTCHA_BYPASS_TOKEN`, and `SMOKE_BBTEST_EMAIL` (see
`aws_lambda_function.admin_handler` in `infrastructure/main.tf`). All
default to empty strings; while empty, the corresponding backend code
paths are inert (smoke admin auth refuses all tokens, CAPTCHA bypass
header is ignored, the email-keyed smoke routes return 403 for every
request).

### 3. Verify

After all 5 values are in place, the next deploy will execute the smoke.
You can also dry-run it locally against staging or a personal stack:

```bash
SMOKE_API_BASE=https://staging.chqcal.org \
SMOKE_BBTEST_EMAIL=<the-bbtest-email> \
SMOKE_ADMIN_SIGNING_KEY=<key> \
SMOKE_CAPTCHA_BYPASS_TOKEN=<token> \
npm run smoke:publisher
```

A green run prints `[smoke] reset cleaned N rows for <email>` twice
(beforeAll + afterAll) and `walks bbtest through apply → approve → ...`
in the test list.

---

## What the smoke does

The single test in `scripts/smoke/publisher-lifecycle.test.ts` walks
through:

| Step | Endpoint(s) | Asserts |
|---|---|---|
| 1. Apply | `POST /api/publisher-apply/request` (with `X-Smoke-Bypass` header) | `{ ok: true }` |
| 2. Consume | `POST /admin/api/smoke-magic-token-by-email` | publisher row materialized; JWT issued |
| 3. Approve | `POST /admin/api/publisher-applications/{id}/approve` | `enabled: true` |
| 4. Listed | `GET /admin/api/publishers` | bbtest row appears, `enabled: true` |
| 5. Ingest + publish | `POST /admin/api/publishers/run-ingest` + poll `events/count` | count > 0 within 90s |
| 6. Pause + ingest | `POST /api/publisher-pause` + `run-ingest` | count unchanged after 15s |
| 7. Resume + ingest | `POST /api/publisher-resume` + `run-ingest` | count > 0 |
| 8. Self-disable + ingest | `POST /api/publisher-disable` + `run-ingest` | count drops to 0 within 90s |

`beforeAll` and `afterAll` both call `POST /admin/api/smoke-reset-bbtest`
to ensure the journey starts and leaves bbtest in a baseline state
regardless of failures.

---

## Triage by failure point

### "fetch failed" / network errors

The smoke runner couldn't reach `https://www.chqcal.org`. Check:
- CloudFront distribution status (sometimes takes 5–10 min after a deploy
  to settle).
- Whether the deploy step itself produced a 200 from API Gateway in its
  smoke-test step (line ~360 of `deploy-production.yml`).

### Step 1 (apply) returns 400 or 401

- 400 with `Email already in use` → bbtest reset didn't run cleanly.
  Manually run reset (see "Manual reset" below) and retry.
- 401 → `CAPTCHA_BYPASS_TOKEN` Lambda env doesn't match the
  `SMOKE_CAPTCHA_BYPASS_TOKEN` GitHub secret. Check terraform.tfvars and
  re-apply.
- 403 with "Smoke route not permitted" → the route changed and isn't on
  `SMOKE_ADMIN_ROUTE_ALLOWLIST` in `backend/src/handlers/adminHandler.ts`.

### Step 2 (consume-by-email) returns 401

Same root cause as 401 in step 1, but for `ADMIN_SMOKE_SIGNING_KEY` /
`SMOKE_ADMIN_SIGNING_KEY`. The two values MUST be identical.

### Step 3 (approve) returns 409 `ApplicationStateError`

The publisher row is already in a non-pending state (probably approved
from a previous run that didn't clean up). Run reset; retry.

### Step 5 / 7 (publish) times out at 90s

The publisher-ingest Lambda didn't run, or ran but didn't write events.

- Check CloudWatch Logs for `chautauqua-calendar-publisher-ingest`. Look
  for the run triggered around the smoke's start time (the run-ingest
  payload includes `triggeredBy: 'smoke-bot@chqcal.invalid'` so it's
  greppable).
- Check the bbtest publisher's `lastFetchStatus` via the admin dashboard
  at `/admin/publishers/`. If it's `network_error` or `parse_error`,
  the bbtest feed source is unhealthy — fix the feed before retrying.

### Step 8 (retract after self-disable) times out at 90s

The reconciler isn't deleting events for self-disabled publishers, or
the ingest run isn't reaching the reconciler. This is the symptom that
PR #78 (`disable-publisher-retracts-events`) was meant to prevent — if
this regression is real, file a bug and roll back.

---

## Manual reset (when CI was killed mid-journey)

If a CI run was killed between `beforeAll` and `afterAll`, the bbtest
publisher may be left in a non-baseline state (paused, self-disabled,
half-processed events). To reset manually:

```bash
# 1. Sign a short-lived smoke admin token locally. The local-side env var
#    is SMOKE_ADMIN_SIGNING_KEY (matches the GitHub repo secret name and
#    the smoke runner under scripts/smoke/lib/adminAuth.ts). The Lambda
#    receives the same value under ADMIN_SMOKE_SIGNING_KEY (set via
#    terraform variable admin_smoke_signing_key).
TOKEN=$(node -e "console.log(require('jsonwebtoken').sign(\
  {sub:'smoke-bot',iss:'smoke'}, process.env.SMOKE_ADMIN_SIGNING_KEY, \
  {algorithm:'HS256', expiresIn:'5m'}))")

# 2. Hit the reset endpoint.
curl -fsSL -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$SMOKE_BBTEST_EMAIL\"}" \
  https://www.chqcal.org/admin/api/smoke-reset-bbtest
```

The response body contains `rowsAffected` — non-zero means there was
leftover state.

To find the most recent killed run:
```bash
gh run list --workflow=deploy-production.yml --limit 5
```

---

## Disabling the smoke temporarily

If the smoke is flaking and blocking deploys (rare — the polling loops
and idempotent reset are designed to make this hard):

1. Comment out the `Post-deploy publisher-lifecycle smoke` step in
   `.github/workflows/deploy-production.yml` (don't delete; we want to
   re-enable quickly).
2. Open a PR with an explanation; merge.
3. The next deploy will skip the smoke. Production behavior is
   unaffected — the smoke is verification, not a production dependency.
4. **File a bug** describing the flake. Don't leave the smoke disabled.

---

## Rotating the bypass token / signing key

If either secret leaks (e.g. accidentally pasted into a public chat):

1. Generate fresh values: `openssl rand -hex 32`.
2. Update `terraform.tfvars` and `terraform apply`. The Lambda env
   updates immediately on apply.
3. Update the GitHub repo secrets in **Settings → Secrets**.
4. Trigger a deploy or `workflow_dispatch` and confirm the smoke runs
   green.
5. Audit CloudWatch logs for any `adminSubject: 'smoke-bot'` entries
   that occurred outside the deploy windows — those are evidence of
   actual abuse before rotation.

The bypass token only works on `/api/publisher-apply/request`; the
signing key only admits routes on `SMOKE_ADMIN_ROUTE_ALLOWLIST`. A leak
of either still cannot drive arbitrary admin actions, but rotation is
the safe response.
