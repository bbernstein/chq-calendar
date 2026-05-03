import { useAdminAuth } from '@/hooks/useAdminAuth';
import { logout } from '@/lib/auth';

interface AdminTool {
  href: string;
  title: string;
  description: string;
}

const TOOLS: AdminTool[] = [
  {
    href: '/admin/feedback/',
    title: 'Feedback',
    description: 'Review user feedback submissions and mark them resolved.',
  },
  {
    href: '/admin/publishers/',
    title: 'Publishers',
    description: 'Manage registered publishers, enable/disable feeds, monitor fetch status.',
  },
  {
    href: '/admin/publisher-events/',
    title: 'Publisher events',
    description: 'Approve or reject pending events from review-tier publishers.',
  },
];

export default function AdminIndexPage() {
  const user = useAdminAuth();
  if (!user) return null; // useAdminAuth handles loading + redirect

  return (
    <div className="min-h-screen bg-white dark:bg-gray-900">
      <header className="border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        <div className="mx-auto max-w-5xl px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Admin</h1>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Signed in as {user.email}
            </p>
          </div>
          <button
            onClick={() => logout()}
            className="text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
          >
            Log out
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">
        <ul className="grid gap-4 sm:grid-cols-2">
          {TOOLS.map(t => (
            <li key={t.href}>
              <a
                href={t.href}
                className="block rounded-lg border border-gray-200 dark:border-gray-700 p-4 hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
              >
                <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                  {t.title}
                </h2>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                  {t.description}
                </p>
              </a>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
