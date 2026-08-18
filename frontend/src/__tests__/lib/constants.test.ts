import { describe, it, expect, vi, afterEach } from 'vitest';

// We need to dynamically import so fake timers are set before module evaluation
describe('getDefaultYear', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
  });

  it('returns current year before October', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 15)); // June 15, 2026
    const { getDefaultYear } = await import('@/lib/constants');
    expect(getDefaultYear()).toBe(2026);
  });

  it('returns next year on October 1', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 1)); // October 1, 2026
    const { getDefaultYear } = await import('@/lib/constants');
    expect(getDefaultYear()).toBe(2027);
  });

  it('returns next year in November', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 15)); // November 15, 2026
    const { getDefaultYear } = await import('@/lib/constants');
    expect(getDefaultYear()).toBe(2027);
  });

  it('returns current year in September', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 30)); // September 30, 2026
    const { getDefaultYear } = await import('@/lib/constants');
    expect(getDefaultYear()).toBe(2026);
  });

  it('returns current year in January', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2027, 0, 15)); // January 15, 2027
    const { getDefaultYear } = await import('@/lib/constants');
    expect(getDefaultYear()).toBe(2027);
  });

  it('returns next year in December', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 11, 25)); // December 25, 2026
    const { getDefaultYear } = await import('@/lib/constants');
    expect(getDefaultYear()).toBe(2027);
  });

  it('turns over on October 1 at Chautauqua, not on the device', async () => {
    // 2026-10-01T03:00:00Z is still 23:00 on September 30 at Chautauqua,
    // so the season year must not have turned over yet.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-01T03:00:00Z'));
    const { getDefaultYear } = await import('@/lib/constants');
    expect(getDefaultYear()).toBe(2026);
  });

  it('turns over once Chautauqua reaches October', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-01T05:00:00Z')); // 01:00 EDT, Oct 1
    const { getDefaultYear } = await import('@/lib/constants');
    expect(getDefaultYear()).toBe(2027);
  });
});
