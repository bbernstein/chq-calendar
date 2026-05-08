import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DeleteCommand, GetCommand, PutCommand, QueryCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { ApplicationStatus, FetchStatus, PublisherRecord } from '../types/publisher';

// Name of the GSI defined in infrastructure/publisher-ingest.tf on the
// publishers table. Hash-only on contactEmail (lowercase + trimmed at write
// time). Used by getByEmail to avoid a full-table Scan once the publishers
// table grows past a few hundred rows.
const CONTACT_EMAIL_INDEX = 'by-contactEmail';

// Thrown by setApplicationStatus when the optional `expectedFromStatus` does
// not match the current row state. Caller should treat as "another writer
// got there first" — typical UX is to refetch and re-show the row.
export class ConcurrentApplicationUpdateError extends Error {
  constructor(public readonly expectedFromStatus: ApplicationStatus) {
    super(`application status was not '${expectedFromStatus}' at write time`);
    this.name = 'ConcurrentApplicationUpdateError';
  }
}

// Thrown by self-service mutation helpers (setPausedFlag, setSelfDisabled,
// bumpTokenVersion, updateProfile, commitEmailChange, setEmailChangeLock,
// clearEmailChangeLock) when the underlying UpdateItem fails its
// `attribute_exists(id)` guard — i.e. the publisher row was deleted between
// the caller's earlier read (typically requirePublisherSession) and this
// write. Without the guard, DDB UpdateItem with SET would CREATE a partial
// row containing only the fields the helper touched, silently resurrecting
// a deleted publisher in a malformed state. Handlers should map this to a
// 404 (the caller's session is no longer meaningful).
export class PublisherNotFoundError extends Error {
  constructor(public readonly publisherId: string, operation: string) {
    super(`publisher ${publisherId} not found during ${operation}`);
    this.name = 'PublisherNotFoundError';
  }
}

// DDB throws ValidationException with a message mentioning the missing
// index name when a Query targets a GSI that does not exist on the table.
// We require the message to mention CONTACT_EMAIL_INDEX specifically so a
// typo in the constant doesn't produce a permanent silent fall-back to
// Scan: a misspelled index name would Validation-fail with a different
// message that doesn't match this guard, so the error propagates as a
// proper failure instead of degrading getByEmail to O(n) scans forever.
// Match by name + message string rather than the SDK's error class so the
// recovery doesn't couple to the Dynamo SDK internals.
function isMissingIndexError(err: unknown): boolean {
  const e = err as { name?: string; message?: string } | undefined;
  if (!e) return false;
  if (e.name !== 'ValidationException') return false;
  const msg = e.message ?? '';
  if (!msg.includes(CONTACT_EMAIL_INDEX)) return false;
  return /specified index|index .* not (?:found|exist)/i.test(msg);
}

// Profile fields the publisher portal is allowed to clear (REMOVE) by passing
// an empty string. All other profile fields are required-non-empty in the
// PublisherRecord type — clearing them would produce rows that violate the
// type, so updateProfile throws if a caller tries. Module-level so it isn't
// re-allocated on every call.
const CLEARABLE_PROFILE_FIELDS: ReadonlySet<string> = new Set(['organization']);

export class PublisherRegistryService {
  constructor(
    private readonly db: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async get(id: string): Promise<PublisherRecord | null> {
    const r = await this.db.send(new GetCommand({ TableName: this.tableName, Key: { id } }));
    return (r.Item as PublisherRecord) ?? null;
  }

  async listEnabled(): Promise<PublisherRecord[]> {
    const out: PublisherRecord[] = [];
    let last: Record<string, unknown> | undefined;
    do {
      const r = await this.db.send(new ScanCommand({
        TableName: this.tableName,
        FilterExpression: 'enabled = :t',
        ExpressionAttributeValues: { ':t': true },
        ExclusiveStartKey: last,
      }));
      out.push(...((r.Items ?? []) as PublisherRecord[]));
      last = r.LastEvaluatedKey;
    } while (last);
    return out;
  }

  async listAll(): Promise<PublisherRecord[]> {
    const out: PublisherRecord[] = [];
    let last: Record<string, unknown> | undefined;
    do {
      const r = await this.db.send(new ScanCommand({
        TableName: this.tableName,
        ExclusiveStartKey: last,
      }));
      out.push(...((r.Items ?? []) as PublisherRecord[]));
      last = r.LastEvaluatedKey;
    } while (last);
    return out;
  }

  async upsert(rec: PublisherRecord): Promise<void> {
    // Normalize contactEmail at the registry boundary so every write path —
    // apply, admin create/update, smoke test, anything else that builds a
    // PublisherRecord — produces rows that match getByEmail's normalized
    // GSI Query. Previously each caller had to remember to normalize; the
    // admin POST/PATCH /publishers paths did not, so an admin who entered
    // 'Foo@Bar.COM' would write a row that getByEmail('foo@bar.com') would
    // miss. trim() handles paste-with-trailing-spaces; toLowerCase folds
    // casing variations.
    const normalized: PublisherRecord = {
      ...rec,
      contactEmail: rec.contactEmail.trim().toLowerCase(),
    };
    await this.db.send(new PutCommand({ TableName: this.tableName, Item: normalized }));
  }

  async delete(id: string): Promise<void> {
    await this.db.send(new DeleteCommand({ TableName: this.tableName, Key: { id } }));
  }

  async recordFetchOutcome(id: string, outcome: { status: FetchStatus; message?: string }): Promise<void> {
    // ConditionExpression `attribute_exists(id)` prevents an in-flight ingest
    // from resurrecting a publisher row that an admin deleted between the
    // listAll snapshot and this update — without the condition, DDB
    // UpdateItem with SET would create a partial row containing only the
    // fetch-outcome fields. Silently swallow the conditional-fail (the
    // publisher is gone; no outcome to record).
    try {
      await this.db.send(new UpdateCommand({
        TableName: this.tableName,
        Key: { id },
        ConditionExpression: 'attribute_exists(id)',
        UpdateExpression: 'SET lastFetchedAt = :now, lastFetchStatus = :status, lastFetchMessage = :msg',
        ExpressionAttributeValues: {
          ':now': new Date().toISOString(),
          ':status': outcome.status,
          ':msg': outcome.message ?? null,
        },
      }));
    } catch (err) {
      if ((err as { name?: string })?.name === 'ConditionalCheckFailedException') return;
      throw err;
    }
  }

  async setThresholdHalt(id: string, halt: PublisherRecord['pendingThresholdHalt']): Promise<void> {
    // Same delete-during-ingest race as recordFetchOutcome — see that method's
    // comment for rationale.
    try {
      await this.db.send(new UpdateCommand({
        TableName: this.tableName,
        Key: { id },
        ConditionExpression: 'attribute_exists(id)',
        UpdateExpression: 'SET pendingThresholdHalt = :h',
        ExpressionAttributeValues: { ':h': halt ?? null },
      }));
    } catch (err) {
      if ((err as { name?: string })?.name === 'ConditionalCheckFailedException') return;
      throw err;
    }
  }

  // ─── Phase B (publisher portal apply flow) ─────────────────────────────
  //
  // Email lookup queries the by-contactEmail GSI. Email comparison is
  // case-insensitive — we store lowercase + trimmed at write time, but
  // defensively normalize the query input here too so a caller passing a
  // mixed-case address still hits the right index entry.
  //
  // Fallback: if the index is not yet present (deploy-window race where the
  // Lambda code lands before the Terraform GSI apply completes), the SDK
  // throws ValidationException. Fall back to Scan once and log a warning so
  // the deploy doesn't fail user-facing flows. This branch can be removed
  // after the GSI has been live in production for one full release cycle.
  async getByEmail(email: string): Promise<PublisherRecord[]> {
    const normalized = email.trim().toLowerCase();
    try {
      const out: PublisherRecord[] = [];
      let last: Record<string, unknown> | undefined;
      do {
        const r = await this.db.send(new QueryCommand({
          TableName: this.tableName,
          IndexName: CONTACT_EMAIL_INDEX,
          KeyConditionExpression: 'contactEmail = :e',
          ExpressionAttributeValues: { ':e': normalized },
          ExclusiveStartKey: last,
        }));
        out.push(...((r.Items ?? []) as PublisherRecord[]));
        last = r.LastEvaluatedKey;
      } while (last);
      return out;
    } catch (err) {
      if (isMissingIndexError(err)) {
        console.warn(
          `[publishers] ${CONTACT_EMAIL_INDEX} GSI not yet live — falling back to Scan. ` +
          `Remove this branch after the GSI is live in production.`,
        );
        return this.getByEmailScan(normalized);
      }
      throw err;
    }
  }

  // Fallback path for getByEmail when the GSI is missing. Identical
  // semantics to the pre-GSI implementation — kept private so callers
  // don't accidentally take this slower path.
  private async getByEmailScan(normalized: string): Promise<PublisherRecord[]> {
    const out: PublisherRecord[] = [];
    let last: Record<string, unknown> | undefined;
    do {
      const r = await this.db.send(new ScanCommand({
        TableName: this.tableName,
        FilterExpression: 'contactEmail = :e',
        ExpressionAttributeValues: { ':e': normalized },
        ExclusiveStartKey: last,
      }));
      out.push(...((r.Items ?? []) as PublisherRecord[]));
      last = r.LastEvaluatedKey;
    } while (last);
    return out;
  }

  async listPending(): Promise<PublisherRecord[]> {
    const out: PublisherRecord[] = [];
    let last: Record<string, unknown> | undefined;
    do {
      const r = await this.db.send(new ScanCommand({
        TableName: this.tableName,
        FilterExpression: 'applicationStatus = :s',
        ExpressionAttributeValues: { ':s': 'pending' as ApplicationStatus },
        ExclusiveStartKey: last,
      }));
      out.push(...((r.Items ?? []) as PublisherRecord[]));
      last = r.LastEvaluatedKey;
    } while (last);
    return out;
  }

  // setApplicationStatus updates the row's review fields atomically. When
  // `expectedFromStatus` is supplied the write is conditioned on the row's
  // current applicationStatus equalling that value — this prevents two
  // admins from successfully approving/rejecting the same row at the same
  // time (only the first commit wins). The optional `enabled` flag lets the
  // approve/reject paths flip the ingest gate in the same write so we don't
  // leave the row in a half-updated state.
  //
  // ConcurrentApplicationUpdateError is thrown on condition fail.
  async setApplicationStatus(
    id: string,
    status: ApplicationStatus,
    opts: {
      reviewerEmail?: string;
      rejectionReason?: string;
      expectedFromStatus?: ApplicationStatus;
      enabled?: boolean;
    } = {},
  ): Promise<void> {
    const setParts = [
      'applicationStatus = :s',
      'reviewedAt = :now',
      'reviewerEmail = :r',
      'rejectionReason = :rr',
    ];
    const values: Record<string, unknown> = {
      ':s': status,
      ':now': new Date().toISOString(),
      ':r': opts.reviewerEmail ?? null,
      ':rr': opts.rejectionReason ?? null,
    };
    if (opts.enabled !== undefined) {
      setParts.push('enabled = :enabled');
      values[':enabled'] = opts.enabled;
    }
    if (opts.expectedFromStatus !== undefined) {
      values[':expected'] = opts.expectedFromStatus;
    }
    try {
      await this.db.send(new UpdateCommand({
        TableName: this.tableName,
        Key: { id },
        UpdateExpression: `SET ${setParts.join(', ')}`,
        ExpressionAttributeValues: values,
        ...(opts.expectedFromStatus !== undefined
          ? { ConditionExpression: 'applicationStatus = :expected' }
          : {}),
      }));
    } catch (err) {
      // SDK v3 throws ConditionalCheckFailedException by name; check by name
      // string to avoid coupling to the Dynamo SDK error class import.
      const name = (err as { name?: string } | undefined)?.name;
      if (name === 'ConditionalCheckFailedException' && opts.expectedFromStatus !== undefined) {
        throw new ConcurrentApplicationUpdateError(opts.expectedFromStatus);
      }
      throw err;
    }
  }

  // ─── Phase C (publisher portal self-service helpers) ──────────────────
  //
  // These helpers each express a single self-service mutation that the
  // publisher portal handler will issue from authenticated routes. Keeping
  // them here (vs inline UpdateCommands in the handler) makes the table
  // schema/keying private to the registry service and keeps the
  // expression-construction unit-testable in isolation.

  // Toggles the `paused` flag. When the publisher pauses themselves, the
  // selfPausedAt timestamp is also stamped so the admin dashboard can
  // distinguish "publisher paused themselves" from "admin paused them".
  // When unpausing (paused=false), selfPausedAt is REMOVEd whether or not
  // it was set — a no-op when absent, but defensive against admin-paused
  // rows being unpaused by a publisher and leaving stale state.
  async setPausedFlag(
    id: string,
    paused: boolean,
    opts: { selfInitiated?: boolean } = {},
  ): Promise<void> {
    const setParts = ['paused = :p'];
    const removeParts: string[] = [];
    const values: Record<string, unknown> = { ':p': paused };
    if (paused && opts.selfInitiated) {
      setParts.push('selfPausedAt = :now');
      values[':now'] = new Date().toISOString();
    } else if (!paused) {
      removeParts.push('selfPausedAt');
    }
    const expr =
      `SET ${setParts.join(', ')}` +
      (removeParts.length ? ` REMOVE ${removeParts.join(', ')}` : '');
    // ConditionExpression `attribute_exists(id)` prevents a deleted publisher
    // row from being resurrected as a partial row containing only the paused
    // flag — see the PublisherNotFoundError class comment for the broader
    // rationale. Maps the conditional-fail to a typed not-found error so
    // handlers can return a clean 404.
    try {
      await this.db.send(new UpdateCommand({
        TableName: this.tableName,
        Key: { id },
        ConditionExpression: 'attribute_exists(id)',
        UpdateExpression: expr,
        ExpressionAttributeValues: values,
      }));
    } catch (err) {
      if ((err as { name?: string })?.name === 'ConditionalCheckFailedException') {
        throw new PublisherNotFoundError(id, 'setPausedFlag');
      }
      throw err;
    }
  }

  // Self-disable: clears the ingest gate, stamps the timestamp, and bumps
  // tokenVersion in a single write so any already-issued JWT for this
  // publisher is invalidated immediately (see services/publisherSession.ts).
  // Reversible only by an admin (via setApplicationStatus or a separate
  // re-enable path). attribute_exists(id) guard — see PublisherNotFoundError.
  async setSelfDisabled(id: string): Promise<void> {
    try {
      await this.db.send(new UpdateCommand({
        TableName: this.tableName,
        Key: { id },
        ConditionExpression: 'attribute_exists(id)',
        UpdateExpression: 'SET enabled = :f, selfDisabledAt = :now ADD tokenVersion :one',
        ExpressionAttributeValues: {
          ':f': false,
          ':now': new Date().toISOString(),
          ':one': 1,
        },
      }));
    } catch (err) {
      if ((err as { name?: string })?.name === 'ConditionalCheckFailedException') {
        throw new PublisherNotFoundError(id, 'setSelfDisabled');
      }
      throw err;
    }
  }

  // Phase 4 (email change). Sets the email-change lock to the given ISO
  // timestamp. The lock is consulted at initiate time to bounce repeated
  // email-change attempts from a publisher whose old address just clicked
  // "this wasn't me". Auto-clears just by passing the timestamp.
  // attribute_exists(id) guard — see PublisherNotFoundError.
  async setEmailChangeLock(id: string, untilIso: string): Promise<void> {
    try {
      await this.db.send(new UpdateCommand({
        TableName: this.tableName,
        Key: { id },
        ConditionExpression: 'attribute_exists(id)',
        UpdateExpression: 'SET emailChangeLockedUntil = :u',
        ExpressionAttributeValues: { ':u': untilIso },
      }));
    } catch (err) {
      if ((err as { name?: string })?.name === 'ConditionalCheckFailedException') {
        throw new PublisherNotFoundError(id, 'setEmailChangeLock');
      }
      throw err;
    }
  }

  // Removes the email-change lock. Useful for an admin "unlock now" path,
  // and exercised by tests. Self-clears via the timestamp comparison in
  // normal operation, so this is a manual override.
  // attribute_exists(id) guard — see PublisherNotFoundError.
  async clearEmailChangeLock(id: string): Promise<void> {
    try {
      await this.db.send(new UpdateCommand({
        TableName: this.tableName,
        Key: { id },
        ConditionExpression: 'attribute_exists(id)',
        UpdateExpression: 'REMOVE emailChangeLockedUntil',
      }));
    } catch (err) {
      if ((err as { name?: string })?.name === 'ConditionalCheckFailedException') {
        throw new PublisherNotFoundError(id, 'clearEmailChangeLock');
      }
      throw err;
    }
  }

  // Email-change verify commits the new contactEmail and bumps tokenVersion
  // in a SINGLE write. Doing both atomically prevents the case where the
  // contactEmail flips but the JWT keeps validating against the old version
  // (or vice versa). The two-write alternative — updateProfile then
  // bumpTokenVersion — opens a window where the registry is internally
  // consistent but the publisher's already-issued JWT is now mismatched
  // against contactEmail rather than tokenVersion, causing them to fail
  // requirePublisherSession with the wrong reason.
  //
  // The email is normalized (trim + lowercase) before the write so the
  // value stored on the row matches the normalization performed by
  // getByEmail. Callers (PublisherEmailChangeService) already normalize
  // before invocation; this is defense-in-depth so a stray un-normalized
  // call site can't quietly desync the GSI lookup from the row state.
  //
  // attribute_exists(id) guard — see PublisherNotFoundError.
  async commitEmailChange(id: string, newEmail: string): Promise<void> {
    const normalized = newEmail.trim().toLowerCase();
    try {
      await this.db.send(new UpdateCommand({
        TableName: this.tableName,
        Key: { id },
        ConditionExpression: 'attribute_exists(id)',
        UpdateExpression: 'SET contactEmail = :e ADD tokenVersion :one',
        ExpressionAttributeValues: { ':e': normalized, ':one': 1 },
      }));
    } catch (err) {
      if ((err as { name?: string })?.name === 'ConditionalCheckFailedException') {
        throw new PublisherNotFoundError(id, 'commitEmailChange');
      }
      throw err;
    }
  }

  // Increments tokenVersion by 1 — used by email-change verify to invalidate
  // the old session's JWT once the new email is confirmed.
  // attribute_exists(id) guard — see PublisherNotFoundError.
  async bumpTokenVersion(id: string): Promise<void> {
    try {
      await this.db.send(new UpdateCommand({
        TableName: this.tableName,
        Key: { id },
        ConditionExpression: 'attribute_exists(id)',
        UpdateExpression: 'ADD tokenVersion :one',
        ExpressionAttributeValues: { ':one': 1 },
      }));
    } catch (err) {
      if ((err as { name?: string })?.name === 'ConditionalCheckFailedException') {
        throw new PublisherNotFoundError(id, 'bumpTokenVersion');
      }
      throw err;
    }
  }

  // Sparse profile update — writes only the keys present in `patch`. A
  // populated value SETs the field; an empty string clears (REMOVEs) it, but
  // ONLY for fields in CLEARABLE_PROFILE_FIELDS — every other field is
  // required-non-empty in the PublisherRecord type, so the helper throws
  // rather than silently producing a type-violating row. Empty patch is a
  // no-op (no DDB call).
  //
  // The patch type explicitly excludes contactEmail. Email changes must go
  // through commitEmailChange (which bumps tokenVersion in the same write —
  // critical for invalidating the JWT issued before the change). Including
  // contactEmail here would let a caller skip that flow with a single typo.
  async updateProfile(
    id: string,
    patch: Partial<Pick<PublisherRecord, 'name' | 'organization' | 'sourceUrl' | 'sourceType' | 'notificationsEnabled'>>,
  ): Promise<void> {
    if (Object.keys(patch).length === 0) return;
    const setParts: string[] = [];
    const removeParts: string[] = [];
    const values: Record<string, unknown> = {};
    const names: Record<string, string> = {};
    let i = 0;
    for (const [k, v] of Object.entries(patch)) {
      const placeholder = `:v${i}`;
      const namePlaceholder = `#k${i}`;
      names[namePlaceholder] = k;
      if (v === undefined || v === '') {
        if (!CLEARABLE_PROFILE_FIELDS.has(k)) {
          throw new Error(
            `updateProfile: cannot clear required field "${k}". Caller must validate inputs before calling this helper.`,
          );
        }
        removeParts.push(namePlaceholder);
      } else {
        setParts.push(`${namePlaceholder} = ${placeholder}`);
        values[placeholder] = v;
      }
      i += 1;
    }
    const expr =
      (setParts.length ? `SET ${setParts.join(', ')}` : '') +
      (removeParts.length ? ` REMOVE ${removeParts.join(', ')}` : '');
    // attribute_exists(id) guard — see PublisherNotFoundError. Without it,
    // a partial profile update on a deleted row would resurrect it as a
    // type-violating fragment.
    try {
      await this.db.send(new UpdateCommand({
        TableName: this.tableName,
        Key: { id },
        ConditionExpression: 'attribute_exists(id)',
        UpdateExpression: expr.trim(),
        ExpressionAttributeNames: names,
        ...(Object.keys(values).length ? { ExpressionAttributeValues: values } : {}),
      }));
    } catch (err) {
      if ((err as { name?: string })?.name === 'ConditionalCheckFailedException') {
        throw new PublisherNotFoundError(id, 'updateProfile');
      }
      throw err;
    }
  }
}
