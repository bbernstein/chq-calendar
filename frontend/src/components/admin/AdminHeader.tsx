// Shared top-of-page header for /admin/* sub-pages (feedback, publishers,
// publisher-events). The /admin/ index page has a different layout and
// does NOT use this component.
//
// Layout matches the post-PR #119 markup verbatim so visual output is
// unchanged: flex-wrap rows that collapse the right-side group below
// the left side when there isn't enough room for a long signed-in email
// to fit on one line.

import type { ReactNode } from 'react';

export interface AdminHeaderSiblingLink {
  href: string;
  label: string;
  ariaLabel?: string;
}

export interface AdminHeaderProps {
  title: string;
  // Optional inline link rendered to the right of the title block. Used
  // for the publishers ↔ publisher-events cross-link added in PR #118.
  siblingLink?: AdminHeaderSiblingLink;
  // null = not logged in; the email/logout pair is hidden in that case.
  user: { email: string } | null;
  onLogout: () => void;
  // Right-side extras rendered between the dev-mode pill and the
  // email/logout pair — e.g. the publishers page's enabled/disabled
  // counts or the feedback page's filtered-item count.
  children?: ReactNode;
}

function isLocalhost(): boolean {
  if (typeof window === 'undefined') return false;
  const h = window.location.hostname;
  return h === 'localhost' || h === '127.0.0.1';
}

export function AdminHeader({
  title,
  siblingLink,
  user,
  onLogout,
  children,
}: AdminHeaderProps) {
  return (
    <header className="bg-white dark:bg-gray-800 shadow-lg">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 py-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <img
              src="/chq-calendar-icon-256.svg"
              alt="Chautauqua Calendar Logo"
              width={32}
              height={32}
              className="w-8 h-8"
            />
            <div>
              <a
                href="/admin/"
                aria-label="Back to Admin"
                className="text-xs text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400"
              >
                ← Admin
              </a>
              <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">
                {title}
              </h1>
            </div>
            {siblingLink && (
              <a
                href={siblingLink.href}
                aria-label={siblingLink.ariaLabel ?? siblingLink.label}
                className="hidden sm:inline-flex items-center px-3 py-1.5 text-sm font-medium text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/50 rounded-md"
              >
                {siblingLink.label}
              </a>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2 ml-auto">
            {isLocalhost() && (
              <div className="px-2 py-1 bg-yellow-100 text-yellow-800 text-xs font-medium rounded-md">
                Dev Mode
              </div>
            )}
            {children}
            {user && (
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-sm text-gray-600 dark:text-gray-300 break-words">
                  {user.email}
                </span>
                <button
                  onClick={onLogout}
                  className="px-3 py-1 bg-red-600 text-white rounded-md hover:bg-red-700 text-sm shrink-0"
                >
                  Logout
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
