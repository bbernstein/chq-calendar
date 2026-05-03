import { useEffect, useState } from 'react';
import {
  AUTH_TOKEN_KEY,
  AUTH_USER_KEY,
  type AuthUser,
} from '@/lib/auth';

const LOCAL_DUMMY_USER: AuthUser = {
  email: 'dev@localhost.local',
  name: 'Local Dev User',
};

const isLocalhost = (): boolean =>
  typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

// Bootstraps admin authentication on mount.
//
// On localhost, seeds a dummy user + token so the dev server can call admin
// APIs without a real OAuth flow. In production, redirects to /admin/login/
// when no stored token/user is found, otherwise hydrates from localStorage.
//
// Extracted from previously-duplicated useEffect blocks in
// admin/{feedback,publishers,publisher-events}/page.tsx.
export function useAdminAuth(): AuthUser | null {
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    if (isLocalhost()) {
      setUser(LOCAL_DUMMY_USER);
      localStorage.setItem(AUTH_USER_KEY, JSON.stringify(LOCAL_DUMMY_USER));
      localStorage.setItem(AUTH_TOKEN_KEY, 'dummy-local-token');
      return;
    }

    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    const userStr = localStorage.getItem(AUTH_USER_KEY);

    if (!token || !userStr) {
      window.location.href = '/admin/login/';
      return;
    }

    setUser(JSON.parse(userStr) as AuthUser);
  }, []);

  return user;
}
