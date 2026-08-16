import { describe, it, expect, afterEach, vi } from 'vitest';
import { isNavV2Enabled } from '@/lib/featureFlags';

describe('isNavV2Enabled', () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it('is off when the variable is unset', () => {
    expect(isNavV2Enabled()).toBe(false);
  });

  it('is on only for the exact string "true"', () => {
    vi.stubEnv('VITE_NAV_V2', 'true');
    expect(isNavV2Enabled()).toBe(true);
  });

  it('is off for anything else', () => {
    for (const value of ['false', '1', 'yes', 'TRUE', '']) {
      vi.stubEnv('VITE_NAV_V2', value);
      expect(isNavV2Enabled()).toBe(false);
    }
  });
});
