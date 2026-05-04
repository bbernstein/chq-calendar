# Plan — Migrate DynamoDB tables from `hash_key`/`range_key` to `key_schema`

**Status:** not started
**Filed:** 2026-05-04
**Trigger:** AWS provider v6 (introduced in PR #92) emits deprecation warnings on every `aws_dynamodb_table` resource. Old syntax keeps working through the v6 line; expected to be removed in v7. Migrating now is purely cleanup — no functional change.

## Background

After the AWS provider was bumped from `~> 5.0` to `~> 6.0` in PR #92 (to unlock `nodejs24.x` Lambda runtime), `terraform plan` prints, for each `aws_dynamodb_table` resource:

```
Warning: Argument is deprecated
  hash_key is deprecated. Use key_schema instead.
  (and 9 more similar warnings elsewhere)
```

The new syntax is a nested `key_schema` block — one block per key part, each with `attribute_name` and `key_type` set to `"HASH"` or `"RANGE"`. Verified against the AWS provider source docs (https://github.com/hashicorp/terraform-provider-aws/blob/main/website/docs/r/dynamodb_table.html.markdown). The same migration applies to `global_secondary_index { hash_key, range_key }` blocks — the provider docs explicitly state GSI `hash_key`/`range_key` is deprecated in favor of an inner `key_schema` block.

## CRITICAL safety note before touching ANY of this

DynamoDB **does not allow changing a table's key schema after creation**. If the migration is written incorrectly, Terraform will plan to **destroy and recreate** the table, which **deletes all data** (especially painful for `events`, `publishers`, `publisher_events`, `feedback`).

**Before applying any change, the plan output for each table MUST show only in-place updates** (`~` prefix) — no `-/+` (destroy + recreate). If `terraform plan` shows recreate intent on any DynamoDB table, abort and investigate. Likely fixes: a `moved` block, `terraform state` surgery, or a corrected HCL syntax. Do not apply through a destroy/recreate plan.

A safe dry-run sequence:
1. Migrate **one** low-risk table first (`data_sources` — single `hash_key = "id"`, no GSI, easiest to reason about, and re-creatable from CSV if something goes wrong).
2. Run `terraform plan` and confirm it shows `~ update in-place` only.
3. If plan looks right, `apply` and verify table data is intact (`aws dynamodb scan --table-name chautauqua-calendar-data-sources --max-items 5 --output json | jq '.Count'`).
4. Only then proceed with the rest.

## Pre-flight before starting

Before touching any HCL:

1. **Snapshot terraform state.** From `infrastructure/`:
   ```bash
   terraform state pull > terraform-state-backup-$(date +%Y%m%d-%H%M%S).json
   ```
   Keep that file out of git but not deleted until the migration is complete and verified. If a partial apply leaves state inconsistent, this is the recovery artifact.

2. **Verify PITR posture on high-stakes tables.** Tables `events`, `data_sources`, `sync_status`, and `feedback` currently have **no `point_in_time_recovery` block** in HCL (so PITR is off by default). `publishers` and `publisher_events` have it enabled. The two ephemeral publisher-portal tables (`publisher_magic_tokens`, `publisher_rate_limit`) explicitly disable it.

   For the highest-stakes tables without PITR (`events`, `feedback`), strongly consider enabling PITR as a separate, prior change before starting this migration:
   ```bash
   aws dynamodb describe-continuous-backups --table-name chautauqua-calendar-events
   aws dynamodb describe-continuous-backups --table-name chautauqua-calendar-feedback
   ```
   If PITR is off and you want a safety net during this migration, enable it via a small precursor PR (toggle adds a `point_in_time_recovery { enabled = true }` block on each table — that's an in-place update, no recreate). Then come back to this migration.

3. **Resolve `app_name`.** All deployed table names are prefixed `chautauqua-calendar-` (the default of `var.app_name` in `main.tf` line 57). Examples below use that literal prefix; if a future deploy ever overrides `app_name`, derive table names from terraform output instead of hard-coding.

## Scope — 8 tables across 3 files

| File | Resource | Hash | Range | GSIs |
|------|----------|------|-------|------|
| `infrastructure/main.tf` | `aws_dynamodb_table.events` | `id` | — | `WeekIndex` (week+startDate), `DateIndex` (startDate), `CategoryIndex` (category+startDate) |
| `infrastructure/main.tf` | `aws_dynamodb_table.data_sources` | `id` | — | none |
| `infrastructure/main.tf` | `aws_dynamodb_table.sync_status` | `id` | — | `TypeIndex` (type+timestamp) |
| `infrastructure/main.tf` | `aws_dynamodb_table.feedback` | `id` | — | `TimestampIndex` (timestamp) |
| `infrastructure/publisher-ingest.tf` | `aws_dynamodb_table.publishers` | `id` | — | none |
| `infrastructure/publisher-ingest.tf` | `aws_dynamodb_table.publisher_events` | `publisherId` | `eventId` | `by-state` (state+publisherId) |
| `infrastructure/publisher-portal.tf` | `aws_dynamodb_table.publisher_magic_tokens` | `tokenHash` | — | none (TTL only) |
| `infrastructure/publisher-portal.tf` | `aws_dynamodb_table.publisher_rate_limit` | `id` | — | none (TTL only) |

The "(and 9 more)" wording in the provider warning maps to ~10 total occurrences — the 8 table-level `hash_key` warnings plus the `range_key` on `publisher_events`. GSI-level warnings on the 6 GSIs above will likely surface once the table-level ones are fixed.

## Target syntax (verified against AWS provider source docs)

Single hash key (most tables):
```hcl
resource "aws_dynamodb_table" "events" {
  name         = "${var.app_name}-events"
  billing_mode = "PAY_PER_REQUEST"

  attribute {
    name = "id"
    type = "S"
  }
  # ... other attributes for GSIs ...

  key_schema {
    attribute_name = "id"
    key_type       = "HASH"
  }
}
```

Composite key (`publisher_events`):
```hcl
  key_schema {
    attribute_name = "publisherId"
    key_type       = "HASH"
  }
  key_schema {
    attribute_name = "eventId"
    key_type       = "RANGE"
  }
```

GSI with composite key (`WeekIndex`, `CategoryIndex`, `TypeIndex`, `by-state`):
```hcl
  global_secondary_index {
    name            = "WeekIndex"
    projection_type = "ALL"
    key_schema {
      attribute_name = "week"
      key_type       = "HASH"
    }
    key_schema {
      attribute_name = "startDate"
      key_type       = "RANGE"
    }
  }
```

GSI with hash-only key (`DateIndex`, `TimestampIndex`):
```hcl
  global_secondary_index {
    name            = "DateIndex"
    projection_type = "ALL"
    key_schema {
      attribute_name = "startDate"
      key_type       = "HASH"
    }
  }
```

Source: https://github.com/hashicorp/terraform-provider-aws/blob/main/website/docs/r/dynamodb_table.html.markdown.

## Step-by-step execution

1. **Branch.** `git checkout -b chore/infra-dynamodb-key-schema`.
2. **Run pre-flight** (state snapshot + PITR check) per the section above.
3. **Migrate `data_sources` first** (smallest, lowest-risk table). Edit `infrastructure/main.tf`. Run `terraform plan`. **Confirm `~ update in-place` only — no destroy/recreate.** If destroy/recreate shows up, stop and investigate; do not proceed.
4. **Apply just `data_sources`.** `terraform apply -target=aws_dynamodb_table.data_sources`. Verify the table still exists with its data:
   ```bash
   aws dynamodb describe-table --table-name chautauqua-calendar-data-sources --query 'Table.[TableArn,KeySchema]'
   aws dynamodb scan --table-name chautauqua-calendar-data-sources --max-items 5
   ```
5. **Migrate one table with a GSI to validate the GSI syntax.** `sync_status` is the simplest GSI case (single composite GSI, low traffic). Edit, plan-gate, `apply -target=aws_dynamodb_table.sync_status`, verify with `aws dynamodb describe-table` showing both the table KeySchema and the GSI KeySchema intact.
6. **Migrate the rest** in roughly increasing-risk order: `publisher_magic_tokens`, `publisher_rate_limit`, `feedback`, `publishers`, `publisher_events`, `events`. Last two are highest-stakes — `publisher_events` because it has the only composite key, `events` because it has 3 GSIs and the most production data. Each one: plan-gate first, apply with `-target=`, verify with `describe-table` + a small `scan`.
7. **Plan one final time** with no `-target` to confirm no warnings remain and no drift. Apply if anything moved.
8. **Smoke test the app** end-to-end: load https://www.chqcal.org, hit the publisher portal at `/publish/`, submit a feedback form, log into admin and check the feedback list. All read/write paths through DynamoDB should still work.
9. **Commit.** Suggested message: `chore(infra): migrate DynamoDB tables to key_schema syntax (AWS provider v6)`.
10. **PR & merge** following the standard PR-iteration loop in `CLAUDE.md` (root of repo).

## Verification checklist

- [ ] Pre-flight state snapshot saved.
- [ ] PITR verified (or enabled in a precursor change) for `events` and `feedback`.
- [ ] `terraform plan` shows only `~ update in-place` for every DynamoDB table change — never `-/+`.
- [ ] After apply, all 8 tables still exist with the same ARNs.
- [ ] `aws dynamodb scan --table-name <name> --max-items 1` returns rows for the populated tables (`events`, `publishers`, `publisher_events`, `feedback`).
- [ ] Production site loads events, admin/feedback work, publisher portal works.
- [ ] No deprecation warnings on the next `terraform plan`.
- [ ] State backup file deleted after a clean apply round confirms no recovery needed.

## Out of scope

- The `point_in_time_recovery` and `server_side_encryption` blocks may also have v6 deprecations (some providers moved them to top-level fields). If `terraform plan` shows additional warnings on those blocks, file a separate follow-up plan rather than bundling.
- Migrating other resources flagged by the v6 upgrade (none observed yet on the working `nodejs24.x` apply, but worth a clean `terraform plan` once this lands).

## References

- AWS provider dynamodb_table source docs: https://github.com/hashicorp/terraform-provider-aws/blob/main/website/docs/r/dynamodb_table.html.markdown
- AWS provider v5 → v6 upgrade guide: https://registry.terraform.io/providers/hashicorp/aws/latest/docs/guides/version-6-upgrade
- DynamoDB key schema constraints (cannot be changed in place): https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.CoreComponents.html#HowItWorks.CoreComponents.PrimaryKey
