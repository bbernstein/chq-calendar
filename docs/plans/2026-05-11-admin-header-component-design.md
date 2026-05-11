# AdminHeader component — design

**Date**: 2026-05-11
**Branch**: `refactor/admin-header-component`
**Origin**: Open follow-up from PR #119 ("wrap header so long emails don't collide"). Three admin pages — `/admin/feedback`, `/admin/publishers`, `/admin/publisher-events` — currently inline near-identical header markup, including the responsive-wrap classes added in #119. Drift risk is real: PR #119 had to fan the same fix across three files.

## Goals

1. One shared component that renders the admin top-of-page header.
2. Eliminate the ~25–35 lines of duplicated JSX per page.
3. Keep all three pages visually and behaviorally identical to today's `main` (post-#120).
4. Resolve the open `break-all` vs `break-words` preference on the email span.

## Non-goals

- No changes to `/admin/` index page header (different layout — stacked, has the "Signed in as" row already).
- No changes to `/admin/login/`.
- No new features. Pure refactor + the one CSS tweak.
- No prop changes to per-page widgets that move into `children` — they stay as-is, just relocated.

## Component API

`frontend/src/components/admin/AdminHeader.tsx`:

```tsx
interface AdminHeaderProps {
  title: string;
  siblingLink?: {
    href: string;
    label: string;         // e.g. "Publisher events →" or "← Publishers"
    ariaLabel?: string;    // defaults to label
  };
  user: { email: string } | null;
  onLogout: () => void;
  children?: ComponentChildren; // optional right-side extras rendered before email/logout
}
```

Behavior:
- Renders the `← Admin` breadcrumb back-link (always; matches current).
- Renders the logo + title block (always).
- Renders the optional sibling link inside the left group, after the title block — exactly where the three pages put it today.
- Dev-mode pill: internalized. Component checks `window.location.hostname === 'localhost' || '127.0.0.1'` (matches existing `isLocalhost` pattern). The per-page `isLocalhost` constants in `publishers/page.tsx` and `publisher-events/page.tsx` are only used for this pill (verified: 2 refs each = definition + pill), so both definitions get removed. `feedback/page.tsx` defines its own `isLocalhost` inside a callback for auth-bypass logic; that one is untouched.
- Right-side `children` slot renders between the dev-mode pill and the email/logout pair, mirroring the current order.
- Email span uses `break-words` (decision: nicer for typical emails; min-w-0 on the wrapper + shrink-0 on the button still prevent layout blowout for pathological tokens).
- All Tailwind classes preserved verbatim from the post-#119 markup so no visual regression.

## Call sites

```tsx
// feedback/page.tsx
<AdminHeader title="Feedback Management" user={user} onLogout={logout}>
  <div className="text-sm text-gray-600 dark:text-gray-300">
    {filteredFeedbacks.length} feedback item(s)
  </div>
</AdminHeader>

// publishers/page.tsx
<AdminHeader
  title="Publishers Management"
  siblingLink={{ href: '/admin/publisher-events/', label: 'Publisher events →' }}
  user={user}
  onLogout={logout}
>
  {/* existing total/enabled/disabled counts block, unchanged */}
</AdminHeader>

// publisher-events/page.tsx
<AdminHeader
  title="Publisher Events"
  siblingLink={{ href: '/admin/publishers/', label: '← Publishers' }}
  user={user}
  onLogout={logout}
/>
```

## Testing

`frontend/src/components/__tests__/AdminHeader.test.tsx` (matches Modal.test.tsx convention):

- renders title + back-to-admin link
- renders optional sibling link when provided; omits it when not
- renders `children` between dev-mode pill and email/logout
- renders email and logout button when `user` is non-null
- omits the email/logout block when `user` is null
- calls `onLogout` when the logout button is clicked
- Dev-mode pill: skip browser-dependent assertion in jsdom (current pages do the same `typeof window` check; we just match behavior, no need to test).

Existing admin page tests (`adminFeedback.test.tsx`, `adminPublishers.test.tsx`, `PublishersPage.runIngest.test.tsx`) should continue to pass without modification — same DOM output.

## Risks

- DOM shape might shift slightly enough to break a brittle test selector. Mitigation: keep exact class strings; if a test breaks, prefer adjusting the test selector to a more robust one rather than reshaping the component.
- `break-words` is a behavior change vs current `break-all`. Single ugly-long token would now overflow visually instead of breaking mid-character. Mitigation: `min-w-0` on the parent and `shrink-0` on the logout button stay; pathological case is "email with no `@` and no `.`" which isn't a real email. Acceptable.

## Out of scope (follow-ups, not this PR)

- No move of `/admin/` index header into the component — different shape.
- No extraction of the dev-mode pill into its own component — only used in 3 places now, and once inlined here it'll be only 1 place (this component) plus the `/admin/` index.
