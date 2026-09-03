# Classes ingest

The Special Studies pipeline: crawls `tickets.chq.org` and publishes
`cache/calendar-cache/classes-{year}.json` to the frontend bucket.

**The schedules ship disabled.** Applying the Terraform creates a function that
crawls a third party's ticketing site, and that should be someone's decision
rather than a side effect of a merge. Until they are turned on, the pipeline is
driven by hand — which is also how you would verify a first deploy.

## What it needs

| | |
| :--- | :--- |
| Handler | `dist/classesIngestHandler.scheduledHandler` |
| Runtime | nodejs24.x |
| Timeout | 900s — a full pass measured 259.5s; the headroom is for a slow day on the ticket site |
| Memory | 512 MB — measured peak 229 MB |
| Reserved concurrency | 1 — see "Why one at a time" below |
| `CACHE_S3_BUCKET` | **required**; the function throws without it |
| `CACHE_S3_KEY_PREFIX` | optional, defaults to `cache/calendar-cache` |

IAM: `s3:GetObject` and `s3:PutObject` on `classes-*.json` under that prefix,
plus `s3:ListBucket` scoped to the same prefix. `ListBucket` is not optional —
without it S3 answers 403 for a key that merely does not exist, and the first
run, when the catalog cannot exist yet, cannot tell "nothing published yet"
from a real failure and aborts. So does every run after it.

## Deploying

Three steps, in this order.

**Package the backend first.** Every Lambda in `infrastructure/` — this one and
its five siblings — points `filename` at `../backend/lambda-function.zip` and
hashes it with `filebase64sha256`. That file is a build output, not a checked-in
artifact, so in a fresh clone Terraform cannot even *parse* the config until it
exists: `terraform validate` fails with `no such file or directory` before it
gets as far as planning anything. `npm run build` alone does not produce it.

```bash
npm run package:terraform --workspace=chautauqua-backend
```

**Then apply**, which creates the function, its scoped role, the log group, and
both schedules — DISABLED:

```bash
cd infrastructure && terraform apply
```

**Then deploy the code.** Push to `main`, or re-run the production deploy
workflow. Before the first apply the deploy step skips cleanly with a notice
rather than failing, so the order is forgiving in one direction only: code
deploys are no-ops until the function exists.

## One-time runs

`full` walks the paginated search and fetches every class's detail page.
`spots` refetches only classes with a session starting within ten days. Both
publish; both are safe to repeat.

Start with `full` — `spots` patches an existing catalog, so it has nothing to
do until one has been published.

```bash
aws lambda invoke --function-name chautauqua-calendar-classes-ingest \
  --cli-read-timeout 900 --payload '{"mode":"full"}' \
  --cli-binary-format raw-in-base64-out /dev/stdout
```

```bash
aws lambda invoke --function-name chautauqua-calendar-classes-ingest \
  --payload '{"mode":"spots"}' --cli-binary-format raw-in-base64-out /dev/stdout
```

Add `"year": 2027` to target a season other than the current one.

A healthy full pass in season looks like this — roughly four minutes:

```json
{"mode":"full","classes":516,"sessions":49,"detailsFetched":466,
 "detailFailures":0,"published":true,"changed":true,
 "matched":441,"listedOnly":25,"unobserved":48,"cancelled":2}
```

`spots` is seconds rather than minutes, and `changed:false` simply means nobody
enrolled since the last pass — it still republishes so the page's "updated N
ago" stays honest.

Locally, without AWS at all:

```bash
npm run sync:classes --workspace=chautauqua-backend
npm run sync:classes --workspace=chautauqua-backend -- --mode=spots
```

That writes `frontend/public/data/classes-<year>.json`, where the dev server
looks for it.

## Turning the schedules on

```bash
terraform apply -var classes_schedules_enabled=true
```

`full` runs daily at 09:00 UTC and `spots` hourly. The cadences are deliberately
different: a full pass is ~513 requests against someone else's site, and what it
observes — classes entering and leaving the catalog — happens over days. Hourly
would be ~12,000 requests a day to watch almost nothing. Spot counts are the
only thing that moves in between, and the only number anyone acts on.

## Why one at a time

Each pass reads the whole catalog, works for minutes, then rewrites it. Two
overlapping runs would let the shorter one finish last and publish its stale
copy over the longer one's work. Reserved concurrency of 1 stops the overlap
happening; the publisher's conditional write is the proof rather than the
mechanism, since it fails the second write on a stale ETag.

A brand-new AWS account cannot reserve concurrency at all — the default limit is
10 and AWS refuses to let the unreserved pool drop below 10, so the setting is
rejected outright. Leave it unset there and rely on the conditional write; the
cost is losing a run to a 412, not corrupting the catalog.

## When something looks wrong

**An empty or much smaller catalog is never published over a good one.** The
runner refuses, because that is what off-season and an interposed queue page
both look like. Off-season is a no-op, not an error.

**`[classes] ... changed while this run was working`** — two passes overlapped
and the conditional write did its job. The run is lost, not the data. Check
whether reserved concurrency is actually set.

**Every class reports full.** The detail pages carry an inert waitlist modal and
nav JSON containing `SOLD OUT`; a parser that greps the page instead of the
session block will report that. `parseSessionAvailability` is scoped
deliberately.

**Zero sessions everywhere, in season.** Past sessions vanish from detail pages
entirely, so this is expected late in the season and normal after it ends. It is
also what a queue-it interstitial looks like, which is why the client aborts on
one rather than publishing what it received.
