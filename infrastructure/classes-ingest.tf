# infrastructure/classes-ingest.tf
#
# Special Studies class catalog (issue #246). Mirrors program-ingest.tf:
# EventBridge → Lambda → scrape tickets.chq.org → catalog JSON on the frontend
# bucket's calendar-cache path.
#
# Two differences from its siblings, both deliberate.
#
# No private state. Everything this pipeline learns is published, so the
# catalog file is also the record of what the last run saw — and the spots
# pass has to read it back anyway to patch into it. A second state object on
# the cache bucket would only be a copy to keep in step, so this role never
# touches that bucket.
#
# Two schedules against one function, distinguished by a `mode` input. A full
# crawl is 47 paginated listing POSTs plus a detail GET for all ~466 classes;
# a spots pass re-reads only the ~105 running soon. Measured at 258s and 23s
# respectively, which is why they are not on the same clock.

resource "aws_iam_role" "classes_ingest_role" {
  name = "${var.app_name}-classes-ingest-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17",
    Statement = [{
      Effect    = "Allow",
      Principal = { Service = "lambda.amazonaws.com" },
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "classes_ingest_basic" {
  role       = aws_iam_role.classes_ingest_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "classes_ingest_scoped" {
  name = "${var.app_name}-classes-ingest-scoped"
  role = aws_iam_role.classes_ingest_role.id
  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        # Round-trip the published catalog: read the previous run's copy to
        # diff against, write the new one when it differs.
        Effect   = "Allow",
        Action   = ["s3:GetObject", "s3:PutObject"],
        Resource = "${aws_s3_bucket.frontend_bucket.arn}/cache/calendar-cache/classes-*.json"
      },
      {
        # S3 GetObject on a missing key returns 403 AccessDenied rather than
        # 404 NoSuchKey when the caller cannot ListBucket, and
        # ClassesPublisher.loadCatalog() discriminates "no catalog yet" from
        # "real error" on err.name === 'NoSuchKey'. Without this the very
        # first run — the one where the catalog cannot exist — aborts, and so
        # does every run after it. See article-ingest.tf and program-ingest.tf
        # for the same grant and the same reason.
        Effect   = "Allow",
        Action   = ["s3:ListBucket"],
        Resource = aws_s3_bucket.frontend_bucket.arn,
        Condition = {
          StringLike = {
            "s3:prefix" = ["cache/calendar-cache/classes-*"]
          }
        }
      }
    ]
  })
}

resource "aws_cloudwatch_log_group" "classes_ingest" {
  name              = "/aws/lambda/${var.app_name}-classes-ingest"
  retention_in_days = 14
}

resource "aws_lambda_function" "classes_ingest" {
  filename      = "../backend/lambda-function.zip"
  function_name = "${var.app_name}-classes-ingest"
  role          = aws_iam_role.classes_ingest_role.arn
  handler       = "dist/classesIngestHandler.scheduledHandler"
  runtime       = "nodejs24.x"

  # 900s, not the 300s its siblings use. A full crawl is 258s once the
  # catalog's subjects are known, but the first run of a season also has to
  # learn them — one listing crawl per subject — which measured 605s. That
  # run happens once and must not be the one that times out.
  timeout     = 900
  memory_size = 512

  # One at a time. Two schedules drive this function — a daily full crawl of
  # 258s and an hourly spots pass — and each reads the catalog, works, then
  # rewrites the whole file. Overlapping, the shorter pass finishes last and
  # publishes its stale copy over the longer one's work.
  #
  # The publisher's conditional write already refuses that, but refusing means
  # losing the run. This stops the overlap happening at all; the precondition
  # stays as the check that proves it, since a cap is a claim about the
  # platform and the ETag is a fact about the object.
  reserved_concurrent_executions = 1

  environment {
    variables = {
      CACHE_S3_BUCKET     = aws_s3_bucket.frontend_bucket.bucket
      CACHE_S3_KEY_PREFIX = "cache/calendar-cache"
    }
  }

  depends_on = [
    aws_iam_role_policy_attachment.classes_ingest_basic,
    aws_iam_role_policy.classes_ingest_scoped,
    aws_cloudwatch_log_group.classes_ingest,
  ]

  source_code_hash = filebase64sha256("../backend/lambda-function.zip")
}

# Daily, not hourly. The full crawl exists to notice classes entering or
# leaving the catalog, which happens over days; running it hourly would put
# ~12,000 requests a day on someone else's ticketing site to observe almost
# nothing. Its siblings run hourly because they fetch two pages, not 513 —
# matching their cadence while doing 250x the work is not matching anything.
# Both schedules are off until someone turns them on.
#
# Applying this file creates a function that crawls a third party's ticketing
# site. That should be a decision someone makes deliberately, not a side
# effect of a merge — so the rules are created DISABLED by default and the
# pipeline is driven by hand until an operator sets this to true. See
# docs/runbooks/classes-ingest.md for the one-time invocations.
variable "classes_schedules_enabled" {
  description = "Enable the daily full crawl and hourly spots refresh"
  type        = bool
  default     = false
}

resource "aws_cloudwatch_event_rule" "classes_full_schedule" {
  state               = var.classes_schedules_enabled ? "ENABLED" : "DISABLED"
  name                = "${var.app_name}-classes-full-daily"
  description         = "Daily full crawl of the Special Studies catalog"
  schedule_expression = "cron(0 9 * * ? *)" # 09:00 UTC — early morning Eastern
}

resource "aws_cloudwatch_event_target" "classes_full_target" {
  rule      = aws_cloudwatch_event_rule.classes_full_schedule.name
  target_id = "classes-ingest-full"
  arn       = aws_lambda_function.classes_ingest.arn
  input     = jsonencode({ mode = "full" })
}

resource "aws_lambda_permission" "classes_full_allow_events" {
  statement_id  = "AllowExecutionFromEventBridgeClassesFull"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.classes_ingest.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.classes_full_schedule.arn
}

# Spot counts are the only thing that moves between full crawls, and the only
# number anyone acts on. This pass re-reads just the classes running within
# ten days — about 105 of 466 in season, and none at all once it ends.
resource "aws_cloudwatch_event_rule" "classes_spots_schedule" {
  state               = var.classes_schedules_enabled ? "ENABLED" : "DISABLED"
  name                = "${var.app_name}-classes-spots-hourly"
  description         = "Hourly refresh of spot counts for classes running soon"
  schedule_expression = "rate(1 hour)"
}

resource "aws_cloudwatch_event_target" "classes_spots_target" {
  rule      = aws_cloudwatch_event_rule.classes_spots_schedule.name
  target_id = "classes-ingest-spots"
  arn       = aws_lambda_function.classes_ingest.arn
  input     = jsonencode({ mode = "spots" })
}

resource "aws_lambda_permission" "classes_spots_allow_events" {
  statement_id  = "AllowExecutionFromEventBridgeClassesSpots"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.classes_ingest.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.classes_spots_schedule.arn
}
