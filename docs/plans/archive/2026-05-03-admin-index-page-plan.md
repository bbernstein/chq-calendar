# Admin index page — implementation plan

**Date:** 2026-05-03
**Status:** ready to implement
**Branch:** `feat/admin-index-and-publisher-portal`

## Problem

`https://www.chqcal.org/admin/` returns a 404. Admins must memorize sub-paths
(`/admin/feedback/`, `/admin/publishers/`, `/admin/publisher-events/`) — there is
no landing page that lists available admin tools. After OAuth login, the user is
also dropped at `/admin/feedback/` rather than a hub.

## Goal

Add `/admin/` as an authenticated landing page that lists every admin tool with
short descriptions and links. Make it auto-discoverable so adding a future admin
tool is one card.

## Non-goals

- No new admin functionality on the index page (e.g., dashboards, counts).
- No changes to existing admin sub-pages' internals.
- No changes to OAuth/JWT verification.

## Architectural fit

Each admin sub-page today is a Vite MPA entry: `frontend/admin/<name>/index.html`
+ `src/entries/admin-<name>.tsx` + `src/app/admin/<name>/page.tsx`, registered in
`vite.config.ts` `rollupOptions.input`. The new page mirrors that pattern at
the path `frontend/admin/index.html` (note: no subdirectory — sits at the
admin root).

Auth gating reuses `useAdminAuth()` (`frontend/src/hooks/useAdminAuth.ts`),
which already redirects unauthenticated users to `/admin/login/`.

## Files to create / modify

### Create
1. `frontend/admin/index.html` — HTML shell, mirrors `admin/feedback/index.html`,
   loads `/src/entries/admin.tsx`. Title: "Admin | Chautauqua Calendar".
2. `frontend/src/entries/admin.tsx` — entry that imports `globals.css` and
   renders `AdminIndexPage`.
3. `frontend/src/app/admin/page.tsx` — the landing page component.

### Modify
4. `frontend/vite.config.ts` — add `admin: resolve(__dirname, 'admin/index.html')`
   to `rollupOptions.input` between `'admin-login'` and `'admin-feedback'`.
5. `frontend/src/lib/auth.ts:50` — change `logout()` redirect from
   `/admin/login` → `/admin/login/` (fixes the trailing-slash inconsistency
   noted in the cleanup memo).
6. `frontend/src/app/admin/login/page.tsx` — after successful OAuth, redirect to
   `/admin/` instead of `/admin/feedback/` (find the post-login navigation and
   update it).

## Component design

```tsx
// frontend/src/app/admin/page.tsx
import { useAdminAuth } from '@/hooks/useAdminAuth';
import { logout } from '@/lib/auth';

interface AdminTool {
  href: string;
  title: string;
  description: string;
}

const TOOLS: AdminTool[] = [
  { href: '/admin/feedback/',         title: 'Feedback',          description: 'Review user feedback submissions and mark them resolved.' },
  { href: '/admin/publishers/',       title: 'Publishers',        description: 'Manage registered publishers, enable/disable feeds, monitor fetch status.' },
  { href: '/admin/publisher-events/', title: 'Publisher events',  description: 'Approve or reject pending events from review-tier publishers.' },
];

export default function AdminIndexPage() {
  const user = useAdminAuth();
  if (!user) return null; // useAdminAuth handles loading + redirect

  return (
    <div class="min-h-screen bg-white dark:bg-gray-900">
      <header class="border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        <div class="mx-auto max-w-5xl px-4 py-4 flex items-center justify-between">
          <div>
            <h1 class="text-xl font-semibold text-gray-900 dark:text-gray-100">Admin</h1>
            <p class="text-sm text-gray-600 dark:text-gray-400">Signed in as {user.email}</p>
          </div>
          <button onClick={() => logout()} class="text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100">
            Log out
          </button>
        </div>
      </header>
      <main class="mx-auto max-w-5xl px-4 py-8">
        <ul class="grid gap-4 sm:grid-cols-2">
          {TOOLS.map(t => (
            <li key={t.href}>
              <a href={t.href} class="block rounded-lg border border-gray-200 dark:border-gray-700 p-4 hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors">
                <h2 class="text-base font-semibold text-gray-900 dark:text-gray-100">{t.title}</h2>
                <p class="mt-1 text-sm text-gray-600 dark:text-gray-400">{t.description}</p>
              </a>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
```

The `TOOLS` array is the single source of truth — adding a future admin tool
means appending one entry.

## Steps

1. Create `frontend/admin/index.html`.
2. Create `frontend/src/entries/admin.tsx`.
3. Create `frontend/src/app/admin/page.tsx`.
4. Edit `frontend/vite.config.ts` to register the entry.
5. Edit `frontend/src/lib/auth.ts:50` for trailing-slash fix.
6. Edit `frontend/src/app/admin/login/page.tsx` post-login redirect.
7. `cd frontend && npm run build` — must pass.
8. `cd frontend && npm run dev`, visit `/admin/`, manually verify:
   - Unauthenticated → redirected to `/admin/login/`.
   - On localhost (dummy auth) → cards render, all 3 links navigate.
9. Commit: `feat(admin): add /admin/ landing page with links to admin tools`.

## Verification

- `npm run validate` (type-check + lint) passes.
- `npm run build` completes; `out/admin/index.html` exists.
- Dev-server smoke test of all three card links and logout button.
- 404 at `/admin/` is gone.

## Risks

- **Low.** Pure additive change. The trailing-slash fix is a one-character edit.
- The post-login redirect change could disorient regular admins for one session
  if they had `/admin/feedback/` bookmarked — they'll just see the index and
  click through. Acceptable.

## Estimate

~1–2 hours including verification.
