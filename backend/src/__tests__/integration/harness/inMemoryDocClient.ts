/**
 * In-memory DynamoDBDocumentClient fake.
 *
 * Implements `.send(cmd)` for the subset of commands used by production
 * services in `backend/src/services/`. As of Task 1 (survey from
 * grep -rE '(Get|Put|Update|Delete|Query|Scan|BatchGet|BatchWrite|TransactWrite)Command'),
 * production code uses ALL of:
 *   BatchGetCommand, BatchWriteCommand, DeleteCommand, GetCommand,
 *   PutCommand, QueryCommand, ScanCommand, TransactWriteCommand,
 *   UpdateCommand
 *
 * The fake fails loudly on any unsupported command shape — better a missing
 * case break a test than silently produce wrong data.
 *
 * Storage shape: Map<tableName, Map<keyJson, item>> where keyJson is
 * JSON.stringify({ [hashKey]: ..., [sortKey]?: ... }).
 *
 * Condition / filter / key-condition expression support:
 *   - functions: attribute_exists(name), attribute_not_exists(name),
 *                begins_with(name, value)
 *   - binary ops: =, <>, <, >, <=, >=
 *   - boolean ops: AND, OR (left-assoc, AND tighter than OR), parentheses
 *   - dotted attribute paths: emailChangePayload.newEmail
 *   - ExpressionAttributeNames substitution (#name → real name)
 *   - ExpressionAttributeValues substitution (:val → real value)
 *
 * Conditional failures throw an error whose `name === 'ConditionalCheckFailedException'`
 * so production code that catches by name keeps working.
 *
 * TransactWrite atomicity: validate ALL conditions on a snapshot of the
 * tables, then if every condition passes, apply ALL writes; otherwise apply
 * nothing and throw a TransactionCanceledException with CancellationReasons.
 */

import {
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
  ScanCommand,
  BatchGetCommand,
  BatchWriteCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';

export interface GsiSpec {
  name: string;
  hashKey: string;
  sortKey?: string;
}
export interface TableSpec {
  name: string;
  hashKey: string;
  sortKey?: string;
  gsis?: GsiSpec[];
}

type Item = Record<string, unknown>;

class ConditionalCheckFailedException extends Error {
  constructor(message = 'The conditional request failed') {
    super(message);
    this.name = 'ConditionalCheckFailedException';
  }
}

class TransactionCanceledException extends Error {
  public CancellationReasons: Array<{ Code: string; Message?: string }>;
  constructor(reasons: Array<{ Code: string; Message?: string }>) {
    super('Transaction cancelled, please refer cancellation reasons for specific reasons');
    this.name = 'TransactionCanceledException';
    this.CancellationReasons = reasons;
  }
}

// ─── Expression evaluation ──────────────────────────────────────────────

type AttrNames = Record<string, string> | undefined;
type AttrValues = Record<string, unknown> | undefined;

function resolveName(token: string, names: AttrNames): string {
  if (token.startsWith('#')) {
    if (!names || !(token in names)) {
      throw new Error(`ExpressionAttributeName ${token} not found`);
    }
    return names[token];
  }
  return token;
}

function resolveValue(token: string, values: AttrValues): unknown {
  if (!token.startsWith(':')) {
    throw new Error(`Expected expression value placeholder, got ${token}`);
  }
  if (!values || !(token in values)) {
    throw new Error(`ExpressionAttributeValue ${token} not found`);
  }
  return values[token];
}

function getPath(item: Item, path: string, names: AttrNames): unknown {
  // Resolve dotted path with possible #-prefixed segments.
  const parts = path.split('.').map(p => resolveName(p, names));
  let cur: unknown = item;
  for (const p of parts) {
    if (cur === undefined || cur === null) return undefined;
    cur = (cur as Item)[p];
  }
  return cur;
}

function pathExists(item: Item, path: string, names: AttrNames): boolean {
  const parts = path.split('.').map(p => resolveName(p, names));
  let cur: unknown = item;
  for (const p of parts) {
    if (cur === undefined || cur === null) return false;
    if (typeof cur !== 'object') return false;
    if (!Object.prototype.hasOwnProperty.call(cur, p)) return false;
    cur = (cur as Item)[p];
  }
  return true;
}

// Tokenize a condition / filter / keyCondition expression.
function tokenize(expr: string): string[] {
  const toks: string[] = [];
  let i = 0;
  while (i < expr.length) {
    const c = expr[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '(' || c === ')' || c === ',') {
      toks.push(c);
      i++;
      continue;
    }
    // Two-char ops.
    if (i + 1 < expr.length) {
      const two = expr.slice(i, i + 2);
      if (two === '<>' || two === '<=' || two === '>=') {
        toks.push(two);
        i += 2;
        continue;
      }
    }
    if (c === '=' || c === '<' || c === '>') {
      toks.push(c);
      i++;
      continue;
    }
    // Identifier / placeholder / dotted path / number.
    let j = i;
    while (j < expr.length && /[A-Za-z0-9_#:.]/.test(expr[j])) j++;
    if (j === i) throw new Error(`Unexpected character '${c}' at ${i} in '${expr}'`);
    toks.push(expr.slice(i, j));
    i = j;
  }
  return toks;
}

interface ExprCtx {
  item: Item;
  names: AttrNames;
  values: AttrValues;
}

// Recursive-descent parser/evaluator. Grammar:
//   expr   := orExpr
//   orExpr := andExpr ( 'OR' andExpr )*
//   andExpr:= notExpr ( 'AND' notExpr )*
//   notExpr:= primary
//   primary:= '(' expr ')' | func '(' args ')' | comparison
//   comparison := operand op operand
//   operand := IDENT | :value
class ExprParser {
  private idx = 0;
  constructor(private readonly toks: string[]) {}

  evalExpr(ctx: ExprCtx): boolean {
    const r = this.parseOr(ctx);
    if (this.idx !== this.toks.length) {
      throw new Error(`Unexpected trailing tokens in expression: ${this.toks.slice(this.idx).join(' ')}`);
    }
    return r;
  }
  private parseOr(ctx: ExprCtx): boolean {
    let left = this.parseAnd(ctx);
    while (this.peek()?.toUpperCase() === 'OR') {
      this.idx++;
      const right = this.parseAnd(ctx);
      left = left || right;
    }
    return left;
  }
  private parseAnd(ctx: ExprCtx): boolean {
    let left = this.parsePrimary(ctx);
    while (this.peek()?.toUpperCase() === 'AND') {
      this.idx++;
      const right = this.parsePrimary(ctx);
      left = left && right;
    }
    return left;
  }
  private parsePrimary(ctx: ExprCtx): boolean {
    const tok = this.peek();
    if (tok === '(') {
      this.idx++;
      const r = this.parseOr(ctx);
      if (this.peek() !== ')') throw new Error(`Expected ')'`);
      this.idx++;
      return r;
    }
    // function call?
    const next = this.toks[this.idx + 1];
    if (next === '(' && tok && /^[A-Za-z_]/.test(tok)) {
      const fn = tok.toLowerCase();
      this.idx += 2; // consume name + '('
      const args: string[] = [];
      while (this.peek() !== ')') {
        args.push(this.toks[this.idx++]);
        if (this.peek() === ',') this.idx++;
      }
      this.idx++; // consume ')'
      return this.evalFunc(fn, args, ctx);
    }
    // comparison.
    const left = this.toks[this.idx++];
    const op = this.toks[this.idx++];
    const right = this.toks[this.idx++];
    return this.evalComparison(left, op, right, ctx);
  }

  private peek(): string | undefined { return this.toks[this.idx]; }

  private evalFunc(fn: string, args: string[], ctx: ExprCtx): boolean {
    switch (fn) {
      case 'attribute_exists': {
        return pathExists(ctx.item, args[0], ctx.names);
      }
      case 'attribute_not_exists': {
        return !pathExists(ctx.item, args[0], ctx.names);
      }
      case 'begins_with': {
        const v = getPath(ctx.item, args[0], ctx.names);
        const prefix = resolveValue(args[1], ctx.values);
        if (typeof v !== 'string' || typeof prefix !== 'string') return false;
        return v.startsWith(prefix);
      }
      default:
        throw new Error(`Unsupported function: ${fn}`);
    }
  }

  private evalComparison(leftTok: string, op: string, rightTok: string, ctx: ExprCtx): boolean {
    const lv = leftTok.startsWith(':')
      ? resolveValue(leftTok, ctx.values)
      : getPath(ctx.item, leftTok, ctx.names);
    const rv = rightTok.startsWith(':')
      ? resolveValue(rightTok, ctx.values)
      : getPath(ctx.item, rightTok, ctx.names);
    return compare(lv, rv, op);
  }
}

function compare(a: unknown, b: unknown, op: string): boolean {
  if (op === '=') return deepEq(a, b);
  if (op === '<>') return !deepEq(a, b);
  if (a === undefined || b === undefined) return false;
  if (a === null || b === null) return false;
  // Numeric / string comparison.
  if (typeof a === 'number' && typeof b === 'number') {
    if (op === '<') return a < b;
    if (op === '>') return a > b;
    if (op === '<=') return a <= b;
    if (op === '>=') return a >= b;
  }
  if (typeof a === 'string' && typeof b === 'string') {
    if (op === '<') return a < b;
    if (op === '>') return a > b;
    if (op === '<=') return a <= b;
    if (op === '>=') return a >= b;
  }
  throw new Error(`Unsupported comparison ${op} between ${typeof a} and ${typeof b}`);
}

function deepEq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (typeof a === 'object') {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

function evalCondition(expr: string, ctx: ExprCtx): boolean {
  const parser = new ExprParser(tokenize(expr));
  return parser.evalExpr(ctx);
}

// ─── Update expression ──────────────────────────────────────────────────
//
// Supports:
//   SET path = :v, path = path + :v, path = path - :v
//   ADD path :n
//   REMOVE path
// Multiple clauses comma-separated. Clause keywords (SET/ADD/REMOVE) split
// the expression. Sufficient for production usage in this repo.

function applyUpdateExpression(
  item: Item,
  expr: string,
  names: AttrNames,
  values: AttrValues,
): Item {
  const out: Item = JSON.parse(JSON.stringify(item));
  // Tokenize by capturing keyword regions.
  const re = /(SET|ADD|REMOVE|DELETE)\s+/gi;
  const matches = [...expr.matchAll(re)];
  for (let i = 0; i < matches.length; i++) {
    const kw = matches[i][1].toUpperCase();
    const start = matches[i].index! + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index! : expr.length;
    const body = expr.slice(start, end).trim();
    const clauses = splitTopLevelCommas(body);
    for (const clause of clauses) {
      applyUpdateClause(out, kw, clause.trim(), names, values);
    }
  }
  return out;
}

function splitTopLevelCommas(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const c of s) {
    if (c === '(') depth++;
    else if (c === ')') depth--;
    if (c === ',' && depth === 0) {
      if (cur.trim()) out.push(cur);
      cur = '';
    } else cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

function applyUpdateClause(
  item: Item,
  keyword: string,
  clause: string,
  names: AttrNames,
  values: AttrValues,
): void {
  if (keyword === 'SET') {
    // path = expr
    const eqIdx = clause.indexOf('=');
    if (eqIdx === -1) throw new Error(`SET clause missing '=': ${clause}`);
    const path = clause.slice(0, eqIdx).trim();
    const rhs = clause.slice(eqIdx + 1).trim();
    setPath(item, path, evalRhs(item, rhs, names, values), names);
    return;
  }
  if (keyword === 'ADD') {
    // path :n
    const m = clause.match(/^(\S+)\s+(:\S+)$/);
    if (!m) throw new Error(`ADD clause invalid: ${clause}`);
    const path = m[1];
    const incr = resolveValue(m[2], values);
    const cur = getPath(item, path, names);
    if (cur === undefined) {
      setPath(item, path, incr, names);
    } else {
      if (typeof cur !== 'number' || typeof incr !== 'number') {
        throw new Error(`ADD requires numeric on both sides: ${clause}`);
      }
      setPath(item, path, cur + incr, names);
    }
    return;
  }
  if (keyword === 'REMOVE') {
    removePath(item, clause.trim(), names);
    return;
  }
  if (keyword === 'DELETE') {
    throw new Error(`DELETE update keyword not supported in fake`);
  }
}

function evalRhs(item: Item, rhs: string, names: AttrNames, values: AttrValues): unknown {
  // Support `:v`, `path`, `path + :v`, `path - :v`, `:v + :v2` (rare).
  const plusM = rhs.match(/^(\S+)\s*([+-])\s*(\S+)$/);
  if (plusM) {
    const lv = plusM[1].startsWith(':')
      ? resolveValue(plusM[1], values)
      : getPath(item, plusM[1], names);
    const rv = plusM[3].startsWith(':')
      ? resolveValue(plusM[3], values)
      : getPath(item, plusM[3], names);
    if (typeof lv !== 'number' || typeof rv !== 'number') {
      throw new Error(`+/- requires numbers in update expr: ${rhs}`);
    }
    return plusM[2] === '+' ? lv + rv : lv - rv;
  }
  if (rhs.startsWith(':')) return resolveValue(rhs, values);
  return getPath(item, rhs, names);
}

function setPath(item: Item, path: string, value: unknown, names: AttrNames): void {
  const parts = path.split('.').map(p => resolveName(p, names));
  let cur: Item = item;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (cur[k] === undefined || cur[k] === null || typeof cur[k] !== 'object') {
      cur[k] = {};
    }
    cur = cur[k] as Item;
  }
  cur[parts[parts.length - 1]] = value;
}

function removePath(item: Item, path: string, names: AttrNames): void {
  const parts = path.split('.').map(p => resolveName(p, names));
  let cur: Item = item;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (cur[k] === undefined || typeof cur[k] !== 'object') return;
    cur = cur[k] as Item;
  }
  delete cur[parts[parts.length - 1]];
}

// ─── Main client ────────────────────────────────────────────────────────

interface TableState {
  spec: TableSpec;
  items: Map<string, Item>;
}

function keyJsonFromItem(spec: TableSpec, item: Item): string {
  const k: Record<string, unknown> = { [spec.hashKey]: item[spec.hashKey] };
  if (spec.sortKey !== undefined) k[spec.sortKey] = item[spec.sortKey];
  return JSON.stringify(k);
}
function keyJsonFromKey(spec: TableSpec, key: Record<string, unknown>): string {
  const k: Record<string, unknown> = { [spec.hashKey]: key[spec.hashKey] };
  if (spec.sortKey !== undefined) k[spec.sortKey] = key[spec.sortKey];
  return JSON.stringify(k);
}

export class InMemoryDocClient {
  private readonly tables = new Map<string, TableState>();
  // Hooks for tests that want to assert specific commands were sent.
  public readonly commandLog: Array<{ type: string; input: unknown }> = [];

  constructor(specs: TableSpec[]) {
    for (const spec of specs) {
      this.tables.set(spec.name, { spec, items: new Map() });
    }
  }

  /** Register additional table specs after construction (e.g. on-the-fly tests). */
  addTable(spec: TableSpec): void {
    if (!this.tables.has(spec.name)) {
      this.tables.set(spec.name, { spec, items: new Map() });
    }
  }

  dump(table: string): Item[] {
    const t = this.requireTable(table);
    return Array.from(t.items.values()).map(i => JSON.parse(JSON.stringify(i)));
  }

  seed(table: string, items: Item[]): void {
    const t = this.requireTable(table);
    for (const it of items) {
      t.items.set(keyJsonFromItem(t.spec, it), JSON.parse(JSON.stringify(it)));
    }
  }

  clear(): void {
    for (const t of this.tables.values()) t.items.clear();
    this.commandLog.length = 0;
  }

  private requireTable(name: string): TableState {
    const t = this.tables.get(name);
    if (!t) throw new Error(`InMemoryDocClient: unknown table '${name}'`);
    return t;
  }

  async send(cmd: unknown): Promise<unknown> {
    if (cmd instanceof GetCommand) {
      return this.doGet((cmd as GetCommand).input);
    }
    if (cmd instanceof PutCommand) {
      return this.doPut((cmd as PutCommand).input);
    }
    if (cmd instanceof UpdateCommand) {
      return this.doUpdate((cmd as UpdateCommand).input);
    }
    if (cmd instanceof DeleteCommand) {
      return this.doDelete((cmd as DeleteCommand).input);
    }
    if (cmd instanceof QueryCommand) {
      return this.doQuery((cmd as QueryCommand).input);
    }
    if (cmd instanceof ScanCommand) {
      return this.doScan((cmd as ScanCommand).input);
    }
    if (cmd instanceof BatchGetCommand) {
      return this.doBatchGet((cmd as BatchGetCommand).input);
    }
    if (cmd instanceof BatchWriteCommand) {
      return this.doBatchWrite((cmd as BatchWriteCommand).input);
    }
    if (cmd instanceof TransactWriteCommand) {
      return this.doTransactWrite((cmd as TransactWriteCommand).input);
    }
    const ctorName = (cmd as { constructor?: { name?: string } })?.constructor?.name ?? 'unknown';
    throw new Error(
      `InMemoryDocClient: unsupported command shape '${ctorName}'. ` +
      `Add a handler in inMemoryDocClient.ts or switch the test to use a supported command.`,
    );
  }

  // ─── GetCommand ────────────────────────────────────────────────────────
  private doGet(input: any): { Item?: Item } {
    this.commandLog.push({ type: 'Get', input });
    const t = this.requireTable(input.TableName);
    const key = input.Key as Record<string, unknown>;
    const stored = t.items.get(keyJsonFromKey(t.spec, key));
    return stored ? { Item: JSON.parse(JSON.stringify(stored)) } : {};
  }

  // ─── PutCommand ────────────────────────────────────────────────────────
  private doPut(input: any): { Attributes?: Item } {
    this.commandLog.push({ type: 'Put', input });
    const t = this.requireTable(input.TableName);
    const item = input.Item as Item;
    const keyJson = keyJsonFromItem(t.spec, item);
    if (input.ConditionExpression) {
      const existing = t.items.get(keyJson) ?? {};
      const ok = evalCondition(input.ConditionExpression, {
        item: existing,
        names: input.ExpressionAttributeNames,
        values: input.ExpressionAttributeValues,
      });
      if (!ok) throw new ConditionalCheckFailedException();
    }
    t.items.set(keyJson, JSON.parse(JSON.stringify(item)));
    return {};
  }

  // ─── UpdateCommand ─────────────────────────────────────────────────────
  private doUpdate(input: any): { Attributes?: Item } {
    this.commandLog.push({ type: 'Update', input });
    const t = this.requireTable(input.TableName);
    const key = input.Key as Record<string, unknown>;
    const keyJson = keyJsonFromKey(t.spec, key);
    const isCreate = !t.items.has(keyJson);
    const existing: Item = t.items.get(keyJson) ?? { ...key };
    if (input.ConditionExpression) {
      // For an upsert (UpdateItem on a missing row), conditions evaluate
      // against an EMPTY item — DDB's contract is "attribute_exists(id)
      // returns false on a missing row" regardless of the Key fields.
      const ctx: ExprCtx = {
        item: isCreate ? {} : existing,
        names: input.ExpressionAttributeNames,
        values: input.ExpressionAttributeValues,
      };
      const ok = evalCondition(input.ConditionExpression, ctx);
      if (!ok) throw new ConditionalCheckFailedException();
    }
    let updated = existing;
    if (input.UpdateExpression) {
      // For a create-via-update (no row yet) seed with the key fields.
      if (isCreate) updated = { ...key };
      updated = applyUpdateExpression(
        updated,
        input.UpdateExpression,
        input.ExpressionAttributeNames,
        input.ExpressionAttributeValues,
      );
    }
    t.items.set(keyJson, JSON.parse(JSON.stringify(updated)));
    if (input.ReturnValues === 'ALL_OLD') {
      return { Attributes: existing && !isCreate ? JSON.parse(JSON.stringify(existing)) : undefined };
    }
    if (input.ReturnValues === 'ALL_NEW') {
      return { Attributes: JSON.parse(JSON.stringify(updated)) };
    }
    return {};
  }

  // ─── DeleteCommand ─────────────────────────────────────────────────────
  private doDelete(input: any): { Attributes?: Item } {
    this.commandLog.push({ type: 'Delete', input });
    const t = this.requireTable(input.TableName);
    const key = input.Key as Record<string, unknown>;
    const keyJson = keyJsonFromKey(t.spec, key);
    const existing = t.items.get(keyJson);
    if (input.ConditionExpression) {
      const ctx: ExprCtx = {
        item: existing ?? {},
        names: input.ExpressionAttributeNames,
        values: input.ExpressionAttributeValues,
      };
      const ok = evalCondition(input.ConditionExpression, ctx);
      if (!ok) throw new ConditionalCheckFailedException();
    }
    if (existing) t.items.delete(keyJson);
    if (input.ReturnValues === 'ALL_OLD' && existing) {
      return { Attributes: JSON.parse(JSON.stringify(existing)) };
    }
    return {};
  }

  // ─── QueryCommand ──────────────────────────────────────────────────────
  private doQuery(input: any): { Items?: Item[]; Count?: number; LastEvaluatedKey?: Record<string, unknown> } {
    this.commandLog.push({ type: 'Query', input });
    const t = this.requireTable(input.TableName);
    let sortKey = t.spec.sortKey;
    if (input.IndexName) {
      const gsi = (t.spec.gsis ?? []).find(g => g.name === input.IndexName);
      if (!gsi) throw new Error(`Unknown index '${input.IndexName}' on table '${t.spec.name}'`);
      sortKey = gsi.sortKey;
    }
    const all = Array.from(t.items.values());
    // Evaluate KeyConditionExpression against each item (treating it as a
    // filter; it's a simple AND of comparisons in production usage).
    let candidates = all.filter(item =>
      evalCondition(input.KeyConditionExpression, {
        item,
        names: input.ExpressionAttributeNames,
        values: input.ExpressionAttributeValues,
      }),
    );
    if (input.FilterExpression) {
      candidates = candidates.filter(item =>
        evalCondition(input.FilterExpression, {
          item,
          names: input.ExpressionAttributeNames,
          values: input.ExpressionAttributeValues,
        }),
      );
    }
    // Sort by sort key ascending (when present). DDB makes no ordering
    // promise without a sort key; we leave hash-only results in insertion
    // order to match what production code would actually rely on.
    if (sortKey) {
      candidates.sort((a, b) => {
        const av = a[sortKey!] as string | number | undefined;
        const bv = b[sortKey!] as string | number | undefined;
        if (av === undefined || bv === undefined) return 0;
        if (av < bv) return input.ScanIndexForward === false ? 1 : -1;
        if (av > bv) return input.ScanIndexForward === false ? -1 : 1;
        return 0;
      });
    }
    return this.applyPagination(candidates, t.spec, input);
  }

  // ─── ScanCommand ───────────────────────────────────────────────────────
  private doScan(input: any): { Items?: Item[]; Count?: number; LastEvaluatedKey?: Record<string, unknown> } {
    this.commandLog.push({ type: 'Scan', input });
    const t = this.requireTable(input.TableName);
    let candidates = Array.from(t.items.values());
    if (input.FilterExpression) {
      candidates = candidates.filter(item =>
        evalCondition(input.FilterExpression, {
          item,
          names: input.ExpressionAttributeNames,
          values: input.ExpressionAttributeValues,
        }),
      );
    }
    return this.applyPagination(candidates, t.spec, input);
  }

  // Apply ExclusiveStartKey + Limit semantics:
  //   - resume: drop items up to and including the one whose hash+sort match
  //     ExclusiveStartKey (matches DDB behaviour where the start key is the
  //     last *returned* item from the previous page).
  //   - Limit is applied AFTER filtering, mirroring DDB's contract for
  //     filtered queries — we don't model the page-before-filter behaviour
  //     because production code paginates with `while (LastEvaluatedKey)` loops
  //     that drain all pages, and what matters there is total convergence.
  //   - LastEvaluatedKey is built from the table's hash+sort attributes of the
  //     last returned item, but only when there are more items beyond it.
  private applyPagination(
    candidates: Item[],
    spec: TableSpec,
    input: { Limit?: number; ExclusiveStartKey?: Record<string, unknown> },
  ): { Items: Item[]; Count: number; LastEvaluatedKey?: Record<string, unknown> } {
    let working = candidates;
    if (input.ExclusiveStartKey) {
      const startJson = keyJsonFromKey(spec, input.ExclusiveStartKey);
      const idx = working.findIndex(i => keyJsonFromItem(spec, i) === startJson);
      if (idx >= 0) working = working.slice(idx + 1);
      // If the start key is no longer present (e.g. deleted between pages),
      // we conservatively return the full remaining slice — DDB's actual
      // behaviour is undefined here and production code does not rely on it.
    }
    const limit = typeof input.Limit === 'number' && input.Limit > 0 ? input.Limit : undefined;
    let returned = working;
    let lastEvaluatedKey: Record<string, unknown> | undefined;
    if (limit !== undefined && working.length > limit) {
      returned = working.slice(0, limit);
      const last = returned[returned.length - 1];
      const lek: Record<string, unknown> = { [spec.hashKey]: last[spec.hashKey] };
      if (spec.sortKey !== undefined) lek[spec.sortKey] = last[spec.sortKey];
      lastEvaluatedKey = lek;
    }
    const out: { Items: Item[]; Count: number; LastEvaluatedKey?: Record<string, unknown> } = {
      Items: returned.map(i => JSON.parse(JSON.stringify(i))),
      Count: returned.length,
    };
    if (lastEvaluatedKey) out.LastEvaluatedKey = lastEvaluatedKey;
    return out;
  }

  // ─── BatchGetCommand ───────────────────────────────────────────────────
  private doBatchGet(input: any): { Responses?: Record<string, Item[]> } {
    this.commandLog.push({ type: 'BatchGet', input });
    const responses: Record<string, Item[]> = {};
    for (const [tableName, req] of Object.entries(input.RequestItems as Record<string, { Keys: Array<Record<string, unknown>> }>)) {
      const t = this.requireTable(tableName);
      const out: Item[] = [];
      for (const key of req.Keys) {
        const stored = t.items.get(keyJsonFromKey(t.spec, key));
        if (stored) out.push(JSON.parse(JSON.stringify(stored)));
      }
      responses[tableName] = out;
    }
    return { Responses: responses };
  }

  // ─── BatchWriteCommand ─────────────────────────────────────────────────
  private doBatchWrite(input: any): Record<string, never> {
    this.commandLog.push({ type: 'BatchWrite', input });
    for (const [tableName, ops] of Object.entries(input.RequestItems as Record<string, Array<any>>)) {
      const t = this.requireTable(tableName);
      for (const op of ops) {
        if (op.PutRequest) {
          const item = op.PutRequest.Item as Item;
          t.items.set(keyJsonFromItem(t.spec, item), JSON.parse(JSON.stringify(item)));
        } else if (op.DeleteRequest) {
          const key = op.DeleteRequest.Key as Record<string, unknown>;
          t.items.delete(keyJsonFromKey(t.spec, key));
        }
      }
    }
    return {};
  }

  // ─── TransactWriteCommand ─────────────────────────────────────────────
  private doTransactWrite(input: any): Record<string, never> {
    this.commandLog.push({ type: 'TransactWrite', input });
    const items = (input.TransactItems as Array<any>) ?? [];
    // Snapshot all involved tables for atomicity.
    const snapshots = new Map<string, Map<string, Item>>();
    const snapshotTable = (name: string) => {
      if (!snapshots.has(name)) {
        const t = this.requireTable(name);
        const copy = new Map<string, Item>();
        for (const [k, v] of t.items) copy.set(k, JSON.parse(JSON.stringify(v)));
        snapshots.set(name, copy);
      }
    };
    for (const it of items) {
      const which = it.Put ?? it.Update ?? it.Delete ?? it.ConditionCheck;
      snapshotTable(which.TableName);
    }

    // Validate every item against snapshot. If any fails, throw with
    // CancellationReasons for each item — succeeds get { Code: 'None' };
    // failures get the appropriate code.
    const reasons: Array<{ Code: string; Message?: string }> = [];
    let anyFailed = false;
    // We also build the would-be effects in a parallel snapshot so that
    // sequential ops within the txn see each other's pending effects (for
    // condition checks against fresh state — DDB doesn't actually do this,
    // but it's close enough for our test usage).
    const pending = new Map<string, Map<string, Item | null /* deleted */>>();
    const pendingTable = (name: string) => {
      if (!pending.has(name)) pending.set(name, new Map());
      return pending.get(name)!;
    };
    const lookup = (tableName: string, keyJson: string): Item | undefined => {
      const ptbl = pending.get(tableName);
      if (ptbl?.has(keyJson)) {
        const v = ptbl.get(keyJson);
        return v === null ? undefined : (v as Item);
      }
      return snapshots.get(tableName)?.get(keyJson);
    };

    for (const it of items) {
      try {
        if (it.ConditionCheck) {
          const cc = it.ConditionCheck;
          const t = this.requireTable(cc.TableName);
          const keyJson = keyJsonFromKey(t.spec, cc.Key);
          const existing = lookup(cc.TableName, keyJson) ?? {};
          const ok = evalCondition(cc.ConditionExpression, {
            item: existing,
            names: cc.ExpressionAttributeNames,
            values: cc.ExpressionAttributeValues,
          });
          if (!ok) throw new ConditionalCheckFailedException();
          reasons.push({ Code: 'None' });
        } else if (it.Put) {
          const op = it.Put;
          const t = this.requireTable(op.TableName);
          const keyJson = keyJsonFromItem(t.spec, op.Item);
          if (op.ConditionExpression) {
            const existing = lookup(op.TableName, keyJson) ?? {};
            const ok = evalCondition(op.ConditionExpression, {
              item: existing,
              names: op.ExpressionAttributeNames,
              values: op.ExpressionAttributeValues,
            });
            if (!ok) throw new ConditionalCheckFailedException();
          }
          pendingTable(op.TableName).set(keyJson, JSON.parse(JSON.stringify(op.Item)));
          reasons.push({ Code: 'None' });
        } else if (it.Update) {
          const op = it.Update;
          const t = this.requireTable(op.TableName);
          const keyJson = keyJsonFromKey(t.spec, op.Key);
          const existed = lookup(op.TableName, keyJson) !== undefined;
          const existing = lookup(op.TableName, keyJson) ?? { ...op.Key };
          if (op.ConditionExpression) {
            const ok = evalCondition(op.ConditionExpression, {
              item: existed ? existing : {},
              names: op.ExpressionAttributeNames,
              values: op.ExpressionAttributeValues,
            });
            if (!ok) throw new ConditionalCheckFailedException();
          }
          const updated = applyUpdateExpression(
            existing,
            op.UpdateExpression,
            op.ExpressionAttributeNames,
            op.ExpressionAttributeValues,
          );
          pendingTable(op.TableName).set(keyJson, JSON.parse(JSON.stringify(updated)));
          reasons.push({ Code: 'None' });
        } else if (it.Delete) {
          const op = it.Delete;
          const t = this.requireTable(op.TableName);
          const keyJson = keyJsonFromKey(t.spec, op.Key);
          const existing = lookup(op.TableName, keyJson);
          if (op.ConditionExpression) {
            const ok = evalCondition(op.ConditionExpression, {
              item: existing ?? {},
              names: op.ExpressionAttributeNames,
              values: op.ExpressionAttributeValues,
            });
            if (!ok) throw new ConditionalCheckFailedException();
          }
          pendingTable(op.TableName).set(keyJson, null);
          reasons.push({ Code: 'None' });
        }
      } catch (err) {
        anyFailed = true;
        const name = (err as { name?: string } | null)?.name;
        if (name === 'ConditionalCheckFailedException') {
          reasons.push({ Code: 'ConditionalCheckFailed' });
        } else {
          reasons.push({ Code: 'TransactionConflict', Message: (err as Error).message });
        }
      }
    }
    if (anyFailed) {
      throw new TransactionCanceledException(reasons);
    }
    // Commit all pending effects.
    for (const [tableName, ptbl] of pending) {
      const t = this.requireTable(tableName);
      for (const [keyJson, value] of ptbl) {
        if (value === null) t.items.delete(keyJson);
        else t.items.set(keyJson, value);
      }
    }
    return {};
  }
}
