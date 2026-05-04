# Plan — Migrate DynamoDB tables from `hash_key`/`range_key` to `key_schema`

**Status:** executed (GSI-only scope) — see Execution notes below
**Filed:** 2026-05-04
**Trigger:** AWS provider v6 (introduced in PR #92) deprecates the inline `hash_key`/`range_key` arguments inside `global_secondary_index` blocks, so any table that defines a GSI emits warnings on `terraform plan`. Tables without GSIs are unaffected. Old syntax keeps working through the v6 line; expected to be removed in v7. Migrating now is purely cleanup — no functional change.

> ## Execution notes (added 2026-05-04, post-investigation)
>
> When this plan was filed it assumed `hash_key`/`range_key` was deprecated at **both** the table level and the GSI level, and that the v6 provider exposed a top-level `key_schema` block on `aws_dynamodb_table`. Verifying against the actual installed provider (**v6.43.0**) showed that's **wrong**: the v6 schema only adds a `key_schema` block inside `global_secondary_index`. Top-level `hash_key`/`range_key` are still the only way to declare the table's primary key, and they are **not** marked deprecated in `internal/service/dynamodb/table.go`.
>
> The `range_key is deprecated. Use key_schema instead.` warning that prompted this plan is fired solely from the **GSI-level** `hash_key`/`range_key` arguments. Terraform reports the warning's location as the resource block, which made it look like a table-level deprecation.
>
> Result: actual migration scope is just the 6 GSIs (3 on `events`, 1 each on `sync_status`, `feedback`, `publisher_events`). The `data_sources`, `publishers`, `publisher_magic_tokens`, and `publisher_rate_limit` tables have no GSIs and need no edits. No table-level key_schema rewrite, so the entire "destroy/recreate hazard" section below does **not** apply — converting GSI inline args to a nested block is a pure schema-layout change with no on-AWS effect.
>
> The remainder of this document has been rewritten to describe what actually shipped in PR #94 (GSI-only) rather than the original (and incorrect) table-level migration draft. Any future v7 bump that retires top-level `hash_key`/`range_key` will need a fresh plan.

## What actually shipped (executed scope)

The migration done in PR #94 only touches GSI key declarations. There is **no table-level key_schema rewrite**, so the destroy/recreate hazard the original plan worried about does not apply — switching an inline `hash_key`/`range_key` pair on a GSI to a nested `key_schema` block is a pure HCL-layout change with no on-AWS effect.

### Scope shipped — 6 GSIs in 4 tables

| File | Resource | GSI | Keys |
|------|----------|-----|------|
| `infrastructure/main.tf` | `aws_dynamodb_table.events` | `WeekIndex` | hash `week`, range `startDate` |
| `infrastructure/main.tf` | `aws_dynamodb_table.events` | `DateIndex` | hash `startDate` |
| `infrastructure/main.tf` | `aws_dynamodb_table.events` | `CategoryIndex` | hash `category`, range `startDate` |
| `infrastructure/main.tf` | `aws_dynamodb_table.sync_status` | `TypeIndex` | hash `type`, range `timestamp` |
| `infrastructure/main.tf` | `aws_dynamodb_table.feedback` | `TimestampIndex` | hash `timestamp` |
| `infrastructure/publisher-ingest.tf` | `aws_dynamodb_table.publisher_events` | `by-state` | hash `state`, range `publisherId` |

`data_sources`, `publishers`, `publisher_magic_tokens`, and `publisher_rate_limit` have no GSIs and were not touched.

### GSI target syntax used

Composite GSI (`WeekIndex`, `CategoryIndex`, `TypeIndex`, `by-state`):
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

Hash-only GSI (`DateIndex`, `TimestampIndex`):
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

### Apply procedure

`terraform plan` should show only attribute reshape diffs on the 4 tables with GSI changes — no destroy/recreate, no GSI replace. If the plan shows a GSI being recreated on AWS, abort: it almost certainly means the new HCL is reordering `key_schema` blocks against the live KeySchema list, which the provider isn't normalizing. The 6 GSIs in this repo all encode HASH first then RANGE, matching DynamoDB's KeySchema ordering.

Pre-flight state snapshot is still cheap insurance:
```bash
cd infrastructure
terraform state pull > terraform-state-backup-$(date +%Y%m%d-%H%M%S).json
```

If anything goes sideways, that file plus `terraform state push` is the recovery path.

### Verification checklist

- [ ] `terraform plan` shows no destroy/recreate on any DynamoDB resource (table or GSI).
- [ ] `terraform apply` succeeds.
- [ ] `terraform plan` after apply shows no drift and no deprecation warnings.
- [ ] Production site loads events, admin/feedback works, publisher portal works.

## Out of scope (future work)

- A future v7 bump may retire **table-level** `hash_key`/`range_key` (which v6.43.0 still accepts and does not flag deprecated). When that happens, file a fresh plan: that migration is the genuinely dangerous one, since DynamoDB does not allow changing a table's primary key in place. The original draft of this plan included safe-apply machinery (state snapshot, PITR precursor, one-table-at-a-time `-target=` applies, plan-gate on `~ update in-place`) — that machinery is the right starting point when v7 lands.
- The `point_in_time_recovery` and `server_side_encryption` blocks may have separate v6 deprecations. None observed in the post-#94 `terraform validate`, but worth re-checking on the next `terraform plan`.

## References

- AWS provider dynamodb_table source docs: https://github.com/hashicorp/terraform-provider-aws/blob/main/website/docs/r/dynamodb_table.html.markdown
- AWS provider v5 → v6 upgrade guide: https://registry.terraform.io/providers/hashicorp/aws/latest/docs/guides/version-6-upgrade
- DynamoDB key schema constraints (cannot be changed in place): https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.CoreComponents.html#HowItWorks.CoreComponents.PrimaryKey
