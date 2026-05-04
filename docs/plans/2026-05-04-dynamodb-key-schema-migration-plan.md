# Plan — Migrate DynamoDB tables from `hash_key`/`range_key` to `key_schema`

**Status:** not started
**Filed:** 2026-05-04
**Trigger:** AWS provider v6 (introduced in PR #92) emits deprecation warnings on every `aws_dynamodb_table` resource. Old syntax keeps working through the v6 line; expected to be removed in v7. Migrating now is purely cleanup — no functional change.

## Background

After the AWS provider was bumped from `~> 5.0` to `~> 6.0` in PR #92 (to unlock `nodejs24.x` Lambda runtime), `terraform plan` prints:

```
Warning: Argument is deprecated
  hash_key is deprecated. Use key_schema instead.
  (and 9 more similar warnings elsewhere)
```

The new syntax is a nested `key_schema` block (one block per key part) instead of the top-level `hash_key`/`range_key` arguments. The same migration likely applies to `global_secondary_index { hash_key, range_key }` — that needs verification on the first table converted.

## CRITICAL safety note before touching ANY of this

DynamoDB **does not allow changing a table's key schema after creation**. If the migration is written incorrectly, Terraform will plan to **destroy and recreate** the table, which **deletes all data** (especially painful for `events`, `publishers`, `publisher_events`, `feedback`).

**Before applying any change, the plan output for each table MUST show only in-place updates** (`~` prefix) — no `-/+` (destroy + recreate) and no `+ key_schema` paired with `- hash_key` that the provider couldn't reconcile. If `terraform plan` shows recreate intent on any DynamoDB table, abort and investigate. Likely fixes:
- Provider migration is incomplete — the v6 docs may show a subtly different syntax than expected.
- May need `moved` blocks or `terraform state` surgery.
- Worst case: skip migration on that table until v7 forces our hand.

A safe dry-run sequence:
1. Migrate **one** low-risk table first (`data_sources` — single `hash_key = "id"`, no GSI, easiest to reason about, and re-creatable from CSV if something goes wrong).
2. Run `terraform plan` and confirm it shows `~ update in-place` only.
3. If plan looks right, `apply` and verify table data is intact (`aws dynamodb scan --table-name chq-calendar-data-sources --max-items 5`).
4. Only then proceed with the rest.

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

The "(and 9 more)" wording in the warning maps to ~10 total occurrences — likely 8 table-level `hash_key` warnings plus 1–2 `range_key` warnings on `publisher_events`. GSI `hash_key`/`range_key` may or may not be in the deprecation set — verify on the first table.

## Target syntax

Old:
```hcl
resource "aws_dynamodb_table" "events" {
  name         = "${var.app_name}-events"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"

  attribute { name = "id"; type = "S" }
  # ...
}
```

New (per AWS provider v6 docs — confirm exact syntax against
https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/dynamodb_table
before starting):
```hcl
resource "aws_dynamodb_table" "events" {
  name         = "${var.app_name}-events"
  billing_mode = "PAY_PER_REQUEST"

  attribute { name = "id"; type = "S" }
  # ... other attributes ...

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

GSIs — needs verification. If GSI `hash_key`/`range_key` is also deprecated, it likely becomes:
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

## Step-by-step execution

1. **Branch.** `git checkout -b chore/infra-dynamodb-key-schema`.
2. **Verify syntax.** Open the AWS provider v6 dynamodb_table resource docs and confirm the exact `key_schema` block shape. Update the "Target syntax" section above if it differs.
3. **Migrate `data_sources` first** (smallest, lowest-risk table). Edit `infrastructure/main.tf`. Run `terraform plan`. **Confirm `~ update in-place` only — no destroy/recreate.** If destroy/recreate shows up, stop and investigate; do not proceed.
4. **Apply just `data_sources`.** `terraform apply -target=aws_dynamodb_table.data_sources`. Verify the table still exists and has its data: `aws dynamodb describe-table --table-name chq-calendar-data-sources` and a sample `scan`.
5. **If step 4 succeeds**, decide whether GSIs also need migrating based on whether deprecation warnings remain. Migrate one table with a GSI next (`feedback` is simplest — single hash-only GSI). Same plan-then-apply gating.
6. **Migrate the rest.** In rough risk order (lowest first): `sync_status`, `publisher_magic_tokens`, `publisher_rate_limit`, `feedback`, `publishers`, `publisher_events`, `events`. The last two are highest-stakes — `publisher_events` because it has the only composite key, `events` because it has 3 GSIs and the most production data.
7. **Plan one final time** with no `-target` to confirm no warnings remain and no drift. Apply if anything moved.
8. **Smoke test the app** end-to-end: load https://www.chqcal.org, hit the publisher portal at /publish/, submit a feedback form. All read/write paths through DynamoDB should still work.
9. **Commit.** One commit per file is fine, or one commit total if the diff stays tidy. Suggested message: `chore(infra): migrate DynamoDB tables to key_schema syntax (AWS provider v6)`.
10. **PR & merge** following the standard PR-iteration loop in `~/.claude/CLAUDE.md`.

## Verification checklist

- [ ] `terraform plan` shows only `~ update in-place` for every DynamoDB table change — never `-/+`.
- [ ] After apply, all 8 tables still exist with the same ARNs.
- [ ] `aws dynamodb scan --table-name <name> --max-items 1` returns rows for the populated tables (`events`, `publishers`, `publisher_events`, `feedback`).
- [ ] Production site loads events, admin/feedback work, publisher portal works.
- [ ] No deprecation warnings on the next `terraform plan`.

## Out of scope

- The `point_in_time_recovery` and `server_side_encryption` blocks may also have v6 deprecations (some providers moved them to top-level fields). If `terraform plan` shows additional warnings on those blocks, file a separate follow-up plan rather than bundling.
- Migrating other resources flagged by the v6 upgrade (none observed yet on the working `nodejs24.x` apply, but worth a clean `terraform plan` once this lands).

## References

- AWS provider v6 dynamodb_table docs: https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/dynamodb_table
- AWS provider v5 → v6 upgrade guide: https://registry.terraform.io/providers/hashicorp/aws/latest/docs/guides/version-6-upgrade
- DynamoDB key schema constraints (cannot be changed in place): https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.CoreComponents.html#HowItWorks.CoreComponents.PrimaryKey
