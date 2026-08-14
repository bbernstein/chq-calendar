import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  detectIosEligibility,
  isSnoozed,
  snoozePromo,
  shouldShowPromoBanner,
  isAppLaunchAvailable,
  resolveDeepLink,
  launchApp,
  readDeviceInfo,
  IOS_PROMO_SNOOZE_KEY,
  type DeviceInfo,
} from '@/lib/iosPromo';
import { IOS_PROMO_SNOOZE_MS } from '@/lib/constants';

const IPHONE_18: DeviceInfo = {
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  platform: 'iPhone',
  maxTouchPoints: 5,
  standalone: false,
};

const IPHONE_17: DeviceInfo = {
  ...IPHONE_18,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1',
};

const IPAD_DESKTOP: DeviceInfo = {
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  platform: 'MacIntel',
  maxTouchPoints: 5,
  standalone: false,
};

const MAC_DESKTOP: DeviceInfo = {
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  platform: 'MacIntel',
  maxTouchPoints: 0,
  standalone: false,
};

const ANDROID: DeviceInfo = {
  userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36',
  platform: 'Linux armv8l',
  maxTouchPoints: 5,
  standalone: false,
};

describe('detectIosEligibility', () => {
  it('accepts an iPhone on iOS 18', () => {
    const r = detectIosEligibility(IPHONE_18);
    expect(r).toMatchObject({ isIos: true, version: 18, eligible: true });
  });

  it('rejects an iPhone on iOS 17', () => {
    const r = detectIosEligibility(IPHONE_17);
    expect(r).toMatchObject({ isIos: true, version: 17, eligible: false });
  });

  it('accepts iPadOS reporting itself as desktop Safari (version unknown)', () => {
    const r = detectIosEligibility(IPAD_DESKTOP);
    expect(r).toMatchObject({ isIos: true, version: null, eligible: true });
  });

  it('rejects a real Mac desktop (no touch)', () => {
    expect(detectIosEligibility(MAC_DESKTOP).eligible).toBe(false);
  });

  it('rejects Android', () => {
    expect(detectIosEligibility(ANDROID)).toMatchObject({ isIos: false, eligible: false });
  });

  it('rejects an eligible device already running as an installed app', () => {
    expect(detectIosEligibility({ ...IPHONE_18, standalone: true }).eligible).toBe(false);
  });
});

describe('snooze', () => {
  let store: Record<string, string>;
  const storage = {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
  };

  beforeEach(() => { store = {}; });

  it('is not snoozed with nothing stored', () => {
    expect(isSnoozed(1000, storage)).toBe(false);
  });

  it('snoozePromo writes now + IOS_PROMO_SNOOZE_MS', () => {
    snoozePromo(1000, storage);
    expect(store[IOS_PROMO_SNOOZE_KEY]).toBe(String(1000 + IOS_PROMO_SNOOZE_MS));
  });

  it('is snoozed within the window and clears after it', () => {
    snoozePromo(1000, storage);
    expect(isSnoozed(1000 + IOS_PROMO_SNOOZE_MS - 1, storage)).toBe(true);
    expect(isSnoozed(1000 + IOS_PROMO_SNOOZE_MS, storage)).toBe(false);
    expect(isSnoozed(1000 + IOS_PROMO_SNOOZE_MS + 1, storage)).toBe(false);
  });

  it('ignores a corrupt stored value', () => {
    store[IOS_PROMO_SNOOZE_KEY] = 'not-a-number';
    expect(isSnoozed(1000, storage)).toBe(false);
  });
});

describe('shouldShowPromoBanner / isAppLaunchAvailable', () => {
  const storage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };

  it('shows for an eligible device that has not snoozed', () => {
    expect(shouldShowPromoBanner(IPHONE_18, 1000, storage)).toBe(true);
  });

  it('hides for an ineligible device', () => {
    expect(shouldShowPromoBanner(ANDROID, 1000, storage)).toBe(false);
    expect(isAppLaunchAvailable(ANDROID)).toBe(false);
  });

  it('hides the banner while snoozed but keeps launch available', () => {
    const snoozed = {
      getItem: () => String(2000 + IOS_PROMO_SNOOZE_MS),
      setItem: () => {},
      removeItem: () => {},
    };
    expect(shouldShowPromoBanner(IPHONE_18, 2000, snoozed)).toBe(false);
    expect(isAppLaunchAvailable(IPHONE_18)).toBe(true);
  });
});

describe('resolveDeepLink', () => {
  it('defaults to my-day with no context', () => {
    expect(resolveDeepLink()).toBe('chqcal://my-day');
  });

  it('targets an event when given an id', () => {
    expect(resolveDeepLink({ eventId: '101037' })).toBe('chqcal://event/101037');
  });

  it('encodes an id and ignores an empty one', () => {
    expect(resolveDeepLink({ eventId: 'a b' })).toBe('chqcal://event/a%20b');
    expect(resolveDeepLink({ eventId: '' })).toBe('chqcal://my-day');
  });
});

describe('launchApp', () => {
  function makeDoc(visibilityState: DocumentVisibilityState) {
    const listeners: Record<string, Array<() => void>> = {};
    return {
      visibilityState,
      addEventListener: (t: string, fn: () => void) => {
        (listeners[t] ??= []).push(fn);
      },
      removeEventListener: (t: string, fn: () => void) => {
        listeners[t] = (listeners[t] ?? []).filter((f) => f !== fn);
      },
      fire: (t: string) => (listeners[t] ?? []).forEach((f) => f()),
      count: (t: string) => (listeners[t] ?? []).length,
    };
  }

  it('fires the deep link, then redirects to the App Store when still visible', () => {
    const doc = makeDoc('visible');
    const navigate = vi.fn();
    let timerFn: (() => void) | null = null;
    launchApp({
      deepLink: 'chqcal://my-day',
      appStoreUrl: 'https://apps.apple.com/app/id1',
      doc,
      navigate,
      setTimer: (fn) => { timerFn = fn; return 1 as unknown as ReturnType<typeof setTimeout>; },
      clearTimer: () => {},
    });
    expect(navigate).toHaveBeenNthCalledWith(1, 'chqcal://my-day');
    timerFn!();
    expect(navigate).toHaveBeenNthCalledWith(2, 'https://apps.apple.com/app/id1');
  });

  it('cancels the App Store fallback when the app takes over (page hidden)', () => {
    const doc = makeDoc('visible');
    const navigate = vi.fn();
    const clearTimer = vi.fn();
    launchApp({
      deepLink: 'chqcal://my-day',
      appStoreUrl: 'https://apps.apple.com/app/id1',
      doc,
      navigate,
      setTimer: () => 1 as unknown as ReturnType<typeof setTimeout>,
      clearTimer,
    });
    doc.visibilityState = 'hidden';
    doc.fire('visibilitychange');
    expect(clearTimer).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledTimes(1); // only the deep link
    expect(doc.count('visibilitychange')).toBe(0); // listener removed
  });

  it('cleanup cancels a pending fallback and detaches listeners', () => {
    const doc = makeDoc('visible');
    const clearTimer = vi.fn();
    const cleanup = launchApp({
      deepLink: 'chqcal://my-day',
      doc,
      navigate: vi.fn(),
      setTimer: () => 7 as unknown as ReturnType<typeof setTimeout>,
      clearTimer,
    });
    cleanup();
    expect(clearTimer).toHaveBeenCalledWith(7);
    expect(doc.count('visibilitychange')).toBe(0);
    expect(doc.count('pagehide')).toBe(0);
  });
});

describe('readDeviceInfo', () => {
  it('reads the live navigator without throwing', () => {
    const info = readDeviceInfo();
    expect(typeof info.userAgent).toBe('string');
    expect(typeof info.standalone).toBe('boolean');
  });
});
