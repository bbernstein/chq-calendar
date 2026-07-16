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
