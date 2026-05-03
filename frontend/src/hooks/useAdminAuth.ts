import { useEffect, useState } from 'react';
import {
  AUTH_TOKEN_KEY,
  getAuthToken,
  getAuthUser,
  setAuthUser,
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
      setAuthUser(LOCAL_DUMMY_USER);
      localStorage.setItem(AUTH_TOKEN_KEY, 'dummy-local-token');
      setUser(LOCAL_DUMMY_USER);
      return;
    }

    const token = getAuthToken();
    const savedUser = getAuthUser();

    if (!token || !savedUser) {
      window.location.href = '/admin/login/';
      return;
    }

    setUser(savedUser);
  }, []);

  return user;
}

