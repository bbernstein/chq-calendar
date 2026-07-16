# PWA Auto-Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make installed iPhone home-screen users receive new frontend releases automatically, and guarantee it for every future release.

**Architecture:** Fix the deploy so the HTML shell / `manifest.json` / `version.json` are served `no-cache` (root cause: a year-long `immutable` header applied by an `aws s3 sync` two-pass skip bug). Bake a build version (`VITE_APP_VERSION`) into the bundle, emit a matching `version.json`, and add a small client module that fetches `version.json` on load and on app-reopen and silently reloads when the deployed version differs. No service worker.

**Tech Stack:** Vite 7, Preact 10, TypeScript 5, Vitest, AWS CLI (S3 + CloudFront) in GitHub Actions.

## Global Constraints

- Node.js `>=24.0.0`; do not use APIs unavailable in Node 24.
- Preact, not React. `@preact/preset-vite` aliases `react`→`preact/compat`. JSX-rendering files import hooks/types from `'react'`; pure `.ts` files need no `'react'` import. `versionCheck.ts` is pure `.ts` (no JSX) — import nothing from react/preact.
- Tests are colocated and matched by `src/**/*.test.{ts,tsx}` (vitest include). Coverage floor enforced via `.coverage-floor.json` — new module must be covered.
- `npm run build` (in `frontend/`) runs `validate` (type-check + lint) then `vitest run --coverage` then `vite build`. It must stay green.
- Production build substitutes `import.meta.env.VITE_APP_VERSION` at compile time via Vite `define`. Production code MUST reference that env var with the **exact** literal expression `import.meta.env.VITE_APP_VERSION` (no `as any` wrapping of `import.meta`) or the substitution will not fire.
- Never commit to `main`. Work on branch `fix/pwa-auto-update` (already created).

## File Structure

- `frontend/src/lib/versionCheck.ts` — **new.** Pure update-decision logic + fetch/reload orchestration + a `visibilitychange` watcher. Dependency-injected (fetch, storage, reload) for testability.
- `frontend/src/lib/versionCheck.test.ts` — **new.** Vitest unit tests.
- `frontend/src/vite-env.d.ts` — **modify.** Add `VITE_APP_VERSION` to `ImportMetaEnv`.
- `frontend/vite.config.ts` — **modify.** Compute app version from git, inject via `define`, and emit `version.json` into the build via a small plugin.
- `frontend/src/entries/main.tsx` — **modify.** Start the version watcher after render.
- `.github/workflows/deploy-production.yml` — **modify.** Restructure the frontend S3 upload so revalidate-always files get `no-cache` unconditionally.
- `scripts/deploy-frontend.sh` — **modify.** Mirror the same header fix for local/manual deploys.

---

### Task 1: `versionCheck.ts` — update-decision logic and orchestration

**Files:**
- Create: `frontend/src/lib/versionCheck.ts`
- Test: `frontend/src/lib/versionCheck.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces:
  - `shouldReload(current: string | undefined, fetched: unknown, alreadyTargeted: string | null): boolean`
  - `checkForUpdate(opts?: CheckOptions): Promise<void>` where
    `CheckOptions = { current?: string; storage?: Pick<Storage,'getItem'|'setItem'>; reload?: () => void; fetchImpl?: typeof fetch }`
  - `startVersionWatch(opts?: CheckOptions): void`
  - Constants `VERSION_URL = '/version.json'`, `STORAGE_KEY = 'chq:reloadedForVersion'` (exported for tests).

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/lib/versionCheck.test.ts`:

```ts
/// <reference types="vitest/globals" />
import {
  shouldReload,
  checkForUpdate,
  startVersionWatch,
  VERSION_URL,
  STORAGE_KEY,
} from '@/lib/versionCheck';

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    _map: map,
  };
}

function okJson(body: unknown) {
  return { ok: true, json: async () => body } as unknown as Response;
}

describe('shouldReload', () => {
  it('reloads when fetched differs from current and is not the guarded target', () => {
    expect(shouldReload('abc', 'def', null)).toBe(true);
  });
  it('does not reload when versions match', () => {
    expect(shouldReload('abc', 'abc', null)).toBe(false);
  });
  it('does not reload when fetched is missing/blank', () => {
    expect(shouldReload('abc', undefined, null)).toBe(false);
    expect(shouldReload('abc', '', null)).toBe(false);
  });
  it('does not reload twice for the same target (loop guard)', () => {
    expect(shouldReload('abc', 'def', 'def')).toBe(false);
  });
});

describe('checkForUpdate', () => {
  it('reloads and records the target when a newer version is deployed', async () => {
    const reload = vi.fn();
    const storage = fakeStorage();
    const fetchImpl = vi.fn().mockResolvedValue(okJson({ version: 'def' }));
    await checkForUpdate({ current: 'abc', storage, reload, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledWith(VERSION_URL, { cache: 'no-store' });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(storage.getItem(STORAGE_KEY)).toBe('def');
  });
  it('does not reload when versions match', async () => {
    const reload = vi.fn();
    const fetchImpl = vi.fn().mockResolvedValue(okJson({ version: 'abc' }));
    await checkForUpdate({ current: 'abc', storage: fakeStorage(), reload, fetchImpl });
    expect(reload).not.toHaveBeenCalled();
  });
  it('does not reload again for a version already targeted (loop guard)', async () => {
    const reload = vi.fn();
    const fetchImpl = vi.fn().mockResolvedValue(okJson({ version: 'def' }));
    await checkForUpdate({
      current: 'abc',
      storage: fakeStorage({ [STORAGE_KEY]: 'def' }),
      reload,
      fetchImpl,
    });
    expect(reload).not.toHaveBeenCalled();
  });
  it('swallows fetch rejection and does not reload', async () => {
    const reload = vi.fn();
    const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'));
    await checkForUpdate({ current: 'abc', storage: fakeStorage(), reload, fetchImpl });
    expect(reload).not.toHaveBeenCalled();
  });
  it('does nothing on a non-OK response', async () => {
    const reload = vi.fn();
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false } as Response);
    await checkForUpdate({ current: 'abc', storage: fakeStorage(), reload, fetchImpl });
    expect(reload).not.toHaveBeenCalled();
  });
  it('swallows malformed JSON and does not reload', async () => {
    const reload = vi.fn();
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => { throw new Error('bad json'); },
    } as unknown as Response);
    await checkForUpdate({ current: 'abc', storage: fakeStorage(), reload, fetchImpl });
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('startVersionWatch', () => {
  afterEach(() => vi.restoreAllMocks());

  it('checks once immediately and again when the app becomes visible', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okJson({ version: 'abc' }));
    const opts = { current: 'abc', storage: fakeStorage(), reload: vi.fn(), fetchImpl };
    startVersionWatch(opts);
    // initial check
    await Promise.resolve();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // simulate reopening the home-screen app
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/lib/versionCheck.test.ts`
Expected: FAIL — cannot resolve module `@/lib/versionCheck`.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/lib/versionCheck.ts`:

```ts
// Detects when a newer frontend build has been deployed and silently reloads
// so installed (home-screen) users pick it up. See
// docs/superpowers/specs/2026-07-15-pwa-auto-update-design.md.

export const VERSION_URL = '/version.json';
export const STORAGE_KEY = 'chq:reloadedForVersion';

type MinimalStorage = Pick<Storage, 'getItem' | 'setItem'>;

export interface CheckOptions {
  current?: string;
  storage?: MinimalStorage;
  reload?: () => void;
  fetchImpl?: typeof fetch;
}

// Pure decision: reload only when we have a fetched version that differs from
// what is running AND we have not already reloaded targeting that same version.
export function shouldReload(
  current: string | undefined,
  fetched: unknown,
  alreadyTargeted: string | null,
): boolean {
  if (typeof fetched !== 'string' || fetched.length === 0) return false;
  if (fetched === current) return false;
  if (fetched === alreadyTargeted) return false;
  return true;
}

export async function checkForUpdate(opts: CheckOptions = {}): Promise<void> {
  const {
    current = import.meta.env.VITE_APP_VERSION,
    storage = window.sessionStorage,
    reload = () => window.location.reload(),
    fetchImpl = fetch,
  } = opts;

  try {
    const res = await fetchImpl(VERSION_URL, { cache: 'no-store' });
    if (!res.ok) return;
    const data = (await res.json()) as { version?: unknown };
    const fetched = data?.version;
    const alreadyTargeted = storage.getItem(STORAGE_KEY);
    if (shouldReload(current, fetched, alreadyTargeted)) {
      storage.setItem(STORAGE_KEY, fetched as string);
      reload();
    }
  } catch {
    // Offline, non-OK, or malformed response — keep running the current version.
  }
}

// Checks now and every time the app regains visibility (iOS fires
// visibilitychange when a home-screen app is reopened).
export function startVersionWatch(opts: CheckOptions = {}): void {
  void checkForUpdate(opts);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void checkForUpdate(opts);
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/lib/versionCheck.test.ts`
Expected: PASS (all suites).

- [ ] **Step 5: Type-check and lint**

Run: `cd frontend && npm run validate`
Expected: no errors. (`import.meta.env.VITE_APP_VERSION` is typed in Task 2; if Task 1 is executed first and tsc flags it, do Task 2 Step 1 first — adding the env type — then re-run.)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/versionCheck.ts frontend/src/lib/versionCheck.test.ts
git commit -m "feat(pwa): version-check module with silent auto-reload"
```

---

### Task 2: Bake `VITE_APP_VERSION` into the build and emit `version.json`

**Files:**
- Modify: `frontend/src/vite-env.d.ts`
- Modify: `frontend/vite.config.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: a built `out/version.json` of shape `{ "version": string }`, and a compile-time value for `import.meta.env.VITE_APP_VERSION` equal to that same string. Task 1's `checkForUpdate` default and Task 3's wiring both rely on these.

- [ ] **Step 1: Add the env type**

Edit `frontend/src/vite-env.d.ts` — add one line inside `interface ImportMetaEnv`:

```ts
interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_RECAPTCHA_SITE_KEY: string;
  readonly VITE_ENABLE_PUBLISHER_FEEDS: string;
  readonly VITE_APP_VERSION: string;
}
```

- [ ] **Step 2: Compute the version and wire `define` + the emit plugin in `vite.config.ts`**

At the top of `frontend/vite.config.ts`, add to the existing imports:

```ts
import { execSync } from 'child_process';
```

Add these helpers below the imports (before `devServerMiddleware`):

```ts
// Build version stamp: short git SHA of the deployed commit, or a timestamp
// fallback for environments without git. Baked into the bundle via `define`
// and emitted as version.json so the client can detect new deploys.
function resolveAppVersion(): string {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return `build-${Date.now()}`;
  }
}

// Emits out/version.json at build time with the same value baked into the bundle.
function emitVersionJson(version: string): PluginOption {
  return {
    name: 'emit-version-json',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ version }),
      });
    },
  };
}

const APP_VERSION = resolveAppVersion();
```

In the `defineConfig({ ... })` object, add `emitVersionJson` to `plugins` and add a `define` block. Change:

```ts
  plugins: [devServerMiddleware(), preact()],
  resolve: {
```

to:

```ts
  plugins: [devServerMiddleware(), preact(), emitVersionJson(APP_VERSION)],
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(APP_VERSION),
  },
  resolve: {
```

- [ ] **Step 3: Build and verify the outputs**

Run: `cd frontend && npm run build`
Expected: build succeeds.

Run: `cat frontend/out/version.json`
Expected: `{"version":"<short-sha-or-build-timestamp>"}`

Run: `grep -roh "$(node -e "process.stdout.write(require('./out/version.json').version)" 2>/dev/null || echo __none__)" frontend/out/assets/*.js | head -1`
Expected: prints the same version string (proves `import.meta.env.VITE_APP_VERSION` was substituted into the bundle). If empty, the `define` expression does not match the code's literal — re-check the exact `import.meta.env.VITE_APP_VERSION` spelling in `versionCheck.ts`.

- [ ] **Step 4: Commit**

```bash
git add frontend/vite.config.ts frontend/src/vite-env.d.ts
git commit -m "feat(pwa): bake VITE_APP_VERSION and emit version.json at build"
```

---

### Task 3: Start the version watcher in the main entry

**Files:**
- Modify: `frontend/src/entries/main.tsx`

**Interfaces:**
- Consumes: `startVersionWatch` (Task 1), `import.meta.env.VITE_APP_VERSION` / `version.json` (Task 2).
- Produces: nothing consumed downstream.

- [ ] **Step 1: Wire it up**

Replace the entire contents of `frontend/src/entries/main.tsx` with:

```tsx
import { render } from 'preact';
import '@/app/globals.css';
import Home from '@/app/page';
import { startVersionWatch } from '@/lib/versionCheck';

render(<Home />, document.getElementById('root')!);

// Auto-reload installed/home-screen users onto new deploys.
startVersionWatch();
```

- [ ] **Step 2: Build to verify wiring compiles and bundles**

Run: `cd frontend && npm run build`
Expected: build succeeds (validate + tests + vite build all green).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/entries/main.tsx
git commit -m "feat(pwa): start version watcher on the main calendar entry"
```

---

### Task 4: Fix cache headers in the CI deploy (`deploy-production.yml`)

**Files:**
- Modify: `.github/workflows/deploy-production.yml:410-431` (the "Deploy frontend to S3 and CloudFront" step).

**Interfaces:**
- Consumes: `out/version.json` and `out/manifest.json` produced by the build (Task 2 emits `version.json`; `manifest.json` already ships from `public/`).
- Produces: correct production cache headers.

- [ ] **Step 1: Replace the upload commands**

In `.github/workflows/deploy-production.yml`, replace the body of the `run: |` block under `- name: Deploy frontend to S3 and CloudFront` (currently the two `aws s3 sync` calls + the invalidation, lines ~413-431) with:

```bash
BUCKET="${{ secrets.S3_BUCKET_NAME }}"

# Pass 1 — content-hashed, immutable assets. Exclude the files that must always
# revalidate so they never get the year-long immutable header. --delete removes
# stale hashed bundles; excluded files are neither uploaded nor deleted here.
aws s3 sync out/ "s3://$BUCKET/" \
  --delete \
  --exclude "*.map" \
  --exclude "cache/*" \
  --exclude "*.html" \
  --exclude "manifest.json" \
  --exclude "version.json" \
  --cache-control "public, max-age=31536000, immutable"

# Pass 2 — always-revalidate files. `cp` re-uploads unconditionally (unlike
# `sync`, which skips unchanged files and was the cause of the stale-shell bug),
# so the no-cache header is applied every time.
aws s3 cp out/ "s3://$BUCKET/" \
  --recursive \
  --exclude "*" \
  --include "*.html" \
  --content-type "text/html" \
  --cache-control "no-cache"

aws s3 cp out/manifest.json "s3://$BUCKET/manifest.json" \
  --content-type "application/json" \
  --cache-control "no-cache"

aws s3 cp out/version.json "s3://$BUCKET/version.json" \
  --content-type "application/json" \
  --cache-control "no-cache"

# Invalidate CloudFront cache
aws cloudfront create-invalidation \
  --distribution-id ${{ secrets.CLOUDFRONT_DISTRIBUTION_ID }} \
  --paths "/*"
```

- [ ] **Step 2: Lint the workflow YAML**

Run: `cd /Users/bernard/src/chq/chq-calendar && python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/deploy-production.yml')); print('YAML OK')"`
Expected: `YAML OK`

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/deploy-production.yml
git commit -m "fix(ci): serve HTML/manifest/version.json as no-cache (stop stale PWA shell)"
```

> **Post-deploy verification (run after this reaches production, not part of the plan's local run):**
> ```bash
> curl -sI https://www.chqcal.org/            | grep -i cache-control   # -> no-cache, NOT immutable
> curl -sI https://www.chqcal.org/manifest.json | grep -i cache-control # -> no-cache
> curl -sI https://www.chqcal.org/version.json  | grep -i cache-control # -> no-cache
> curl -sI "https://www.chqcal.org/$(curl -s https://www.chqcal.org/ | grep -oE 'assets/[^"]+\.js' | head -1)" | grep -i cache-control  # -> max-age=31536000, immutable
> ```

---

### Task 5: Mirror the header fix in `scripts/deploy-frontend.sh`

**Files:**
- Modify: `scripts/deploy-frontend.sh:90-127` (the S3 upload / content-type section).

**Interfaces:**
- Consumes: `out/version.json`, `out/manifest.json`, `out/*.html`.
- Produces: identical header behavior for local/manual deploys.

- [ ] **Step 1: Replace the upload block**

In `scripts/deploy-frontend.sh`, replace everything from the `# Sync files to S3` comment (line ~90) through the `error.html` content-type `aws s3 cp` (line ~127) — i.e. the four upload/content-type blocks — with:

```bash
# Sync files to S3
# Pass 1 — content-hashed, immutable assets. Exclude always-revalidate files.
echo "☁️  Uploading immutable assets to S3..."
aws s3 sync "$BUILD_DIR/" "s3://$S3_BUCKET/" \
    --delete \
    --exclude "*.map" \
    --exclude "cache/*" \
    --exclude "*.html" \
    --exclude "manifest.json" \
    --exclude "version.json" \
    --cache-control "public, max-age=31536000, immutable"

# Pass 2 — always-revalidate files. `cp` applies the header unconditionally
# (`sync` skips unchanged files, leaving stale headers behind).
echo "📄 Uploading HTML with no-cache..."
aws s3 cp "$BUILD_DIR/" "s3://$S3_BUCKET/" \
    --recursive \
    --exclude "*" \
    --include "*.html" \
    --content-type "text/html" \
    --cache-control "no-cache"

if [ -f "$BUILD_DIR/manifest.json" ]; then
    aws s3 cp "$BUILD_DIR/manifest.json" "s3://$S3_BUCKET/manifest.json" \
        --content-type "application/json" \
        --cache-control "no-cache"
fi

if [ -f "$BUILD_DIR/version.json" ]; then
    aws s3 cp "$BUILD_DIR/version.json" "s3://$S3_BUCKET/version.json" \
        --content-type "application/json" \
        --cache-control "no-cache"
fi
```

Leave the CloudFront invalidation block (lines ~129-138) unchanged.

- [ ] **Step 2: Shellcheck / syntax check**

Run: `bash -n scripts/deploy-frontend.sh`
Expected: no output (syntax OK).

- [ ] **Step 3: Commit**

```bash
git add scripts/deploy-frontend.sh
git commit -m "fix(deploy): mirror no-cache header fix in manual deploy script"
```

---

## Self-Review

**Spec coverage:**
- Part 1 (header fix) → Tasks 4 (CI) + 5 (shell script). ✓
- Part 2 (version stamp + `version.json`) → Task 2. ✓
- Part 3 (client check, silent reload on reopen, loop guard, swallow failures) → Task 1 + wiring in Task 3. ✓
- Testing (versionCheck unit tests; post-deploy curl assertions) → Task 1 tests; Task 4 post-deploy verification block. ✓
- Non-goals (no service worker; main entry only) → respected; only `main.tsx` wired. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"; all code shown in full. ✓

**Type consistency:** `shouldReload`, `checkForUpdate`, `startVersionWatch`, `CheckOptions`, `VERSION_URL`, `STORAGE_KEY` are used identically in the module, its tests, and the wiring. `version.json` shape `{ version: string }` matches between `emitVersionJson` (Task 2) and `checkForUpdate`'s parse (Task 1). `import.meta.env.VITE_APP_VERSION` literal matches the `define` key (Task 2) and the module default (Task 1). ✓
