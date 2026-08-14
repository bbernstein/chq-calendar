/**
 * Logic for promoting the native iOS app to eligible web visitors.
 *
 * The web calendar runs in every browser, but iPhone/iPad visitors on a
 * device that can run our app (iOS >= 18, the app's deployment target) get a
 * nudge toward it: launch the app if it's installed, or send them to the App
 * Store if it isn't, remembering a dismissal for a few days.
 *
 * There is no reliable browser API that answers "is this native app
 * installed?" for a custom URL scheme, so `launchApp` uses the classic
 * scheme-with-timeout trick: fire the `chqcal://` deep link and, if the page
 * is still visible a beat later (the app never came to the foreground),
 * fall back to the App Store. Phase 2 (Universal Links) will make the launch
 * silent and remove the guesswork; until then this is gated behind an
 * explicit user tap so Safari allows the scheme navigation.
 *
 * The pure helpers here (eligibility, snooze, deep-link resolution) are unit
 * tested; the DOM-heavy `launchApp` is a thin wrapper with injectable seams.
 */

import { APP_STORE_URL } from '@/app/about/aboutContent';
import { IOS_MIN_VERSION, IOS_PROMO_SNOOZE_MS } from '@/lib/constants';

/** localStorage key holding the epoch-ms until which the banner stays hidden. */
export const IOS_PROMO_SNOOZE_KEY = 'chq:iosPromoSnoozeUntil';

/** The app's custom URL scheme (see ios/ChqCalendar/Info.plist). */
const DEEP_LINK_SCHEME = 'chqcal://';

export interface DeviceInfo {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
  /** navigator.standalone — true when running as an installed home-screen app. */
  standalone: boolean;
}

export interface IosEligibility {
  /** iPhone/iPad/iPod, including iPadOS reporting itself as desktop Safari. */
  isIos: boolean;
  /** Parsed major iOS version, or null when the UA doesn't expose it. */
  version: number | null;
  /** True when we should offer the app: iOS >= 18 and not already app-like. */
  eligible: boolean;
}

/** Read the current device's traits, tolerating a non-browser (SSR/test) env. */
export function readDeviceInfo(): DeviceInfo {
  if (typeof navigator === 'undefined') {
    return { userAgent: '', platform: '', maxTouchPoints: 0, standalone: false };
  }
  return {
    userAgent: navigator.userAgent ?? '',
    platform: navigator.platform ?? '',
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    // `standalone` is a non-standard Safari-only flag; guard the access.
    standalone: (navigator as unknown as { standalone?: boolean }).standalone === true,
  };
}

/**
 * Decide whether to promote the app to this device.
 *
 * iPadOS 13+ masquerades as desktop Safari ("MacIntel" + touch), which hides
 * the version string. Such a device is a modern iPad, so we treat the unknown
 * version as eligible: the worst case is a tap that lands on an App Store page
 * telling the user the app needs a newer OS — no error dialog, no data cost.
 * A UA that names iOS but carries no parseable version is treated as
 * ineligible rather than guessed.
 */
export function detectIosEligibility(device: DeviceInfo): IosEligibility {
  const { userAgent, platform, maxTouchPoints, standalone } = device;

  const uaIsIos = /iPhone|iPod|iPad/.test(userAgent);
  const ipadAsDesktop = platform === 'MacIntel' && maxTouchPoints > 1;
  const isIos = uaIsIos || ipadAsDesktop;

  const match = userAgent.match(/OS (\d+)_/);
  const version = match ? parseInt(match[1], 10) : null;

  let versionOk: boolean;
  if (version !== null) {
    versionOk = version >= IOS_MIN_VERSION;
  } else {
    // No version string: eligible only for iPad-as-desktop (a modern iPad).
    versionOk = ipadAsDesktop;
  }

  const eligible = isIos && versionOk && !standalone;
  return { isIos, version, eligible };
}

type MinimalStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function safeStorage(storage?: MinimalStorage): MinimalStorage | null {
  if (storage) return storage;
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    // Access can throw in private mode / sandboxed iframes.
    return null;
  }
}

/** True when the user dismissed the banner recently and it should stay hidden. */
export function isSnoozed(now: number, storage?: MinimalStorage): boolean {
  const store = safeStorage(storage);
  if (!store) return false;
  try {
    const raw = store.getItem(IOS_PROMO_SNOOZE_KEY);
    if (!raw) return false;
    const until = Number(raw);
    if (!Number.isFinite(until)) return false;
    return now < until;
  } catch {
    return false;
  }
}

/** Record a dismissal: hide the banner until `now + IOS_PROMO_SNOOZE_MS`. */
export function snoozePromo(now: number, storage?: MinimalStorage): void {
  const store = safeStorage(storage);
  if (!store) return;
  try {
    store.setItem(IOS_PROMO_SNOOZE_KEY, String(now + IOS_PROMO_SNOOZE_MS));
  } catch {
    // Best-effort; a failed write just means the banner may reappear sooner.
  }
}

/**
 * Whether the promo banner should render right now: the app is live (App Store
 * URL wired up), the device is eligible, and the user hasn't snoozed it.
 * The persistent header affordance uses only the eligibility half of this.
 */
export function shouldShowPromoBanner(
  device: DeviceInfo,
  now: number,
  storage?: MinimalStorage,
): boolean {
  if (!APP_STORE_URL) return false;
  if (!detectIosEligibility(device).eligible) return false;
  return !isSnoozed(now, storage);
}

/** Whether the always-available "Open in app" affordance should render. */
export function isAppLaunchAvailable(device: DeviceInfo): boolean {
  return APP_STORE_URL.length > 0 && detectIosEligibility(device).eligible;
}

/**
 * Map a web context to the closest in-app screen. Today the scheme covers
 * events, My Day, and the map; an unknown context opens the app's default
 * screen. `eventId` is the only context the calendar surfaces so far.
 */
export function resolveDeepLink(context?: { eventId?: string | number }): string {
  if (context?.eventId != null && context.eventId !== '') {
    return `${DEEP_LINK_SCHEME}event/${encodeURIComponent(String(context.eventId))}`;
  }
  return `${DEEP_LINK_SCHEME}my-day`;
}

/** The slice of `document` `launchApp` touches — kept minimal so tests can
 *  supply a lightweight fake without reconstructing the DOM's overloads. */
export interface DocLike {
  visibilityState: DocumentVisibilityState;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
}

export interface LaunchOptions {
  deepLink?: string;
  appStoreUrl?: string;
  timeoutMs?: number;
  /** Injectable seams for testing. */
  now?: () => number;
  navigate?: (url: string) => void;
  doc?: DocLike;
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (id: ReturnType<typeof setTimeout>) => void;
}

/**
 * Attempt to open the app via its custom scheme, falling back to the App Store
 * if the app doesn't take over the page within `timeoutMs`. Must be called
 * from a user gesture (Safari blocks non-gesture scheme navigations).
 *
 * Returns a cleanup function that cancels the pending fallback, so a caller
 * unmounting mid-launch doesn't fire a late redirect.
 */
export function launchApp(options: LaunchOptions = {}): () => void {
  const deepLink = options.deepLink ?? resolveDeepLink();
  const appStoreUrl = options.appStoreUrl ?? APP_STORE_URL;
  const timeoutMs = options.timeoutMs ?? 1200;
  const navigate = options.navigate ?? ((url: string) => { window.location.assign(url); });
  const doc = options.doc ?? (typeof document !== 'undefined' ? document : undefined);
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((id) => clearTimeout(id));

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    clearTimer(timer);
    doc?.removeEventListener('visibilitychange', onHide);
    doc?.removeEventListener('pagehide', onHide);
  };
  // The app coming to the foreground hides/hidden-pages the web page; that's
  // our signal it was installed, so cancel the App Store fallback.
  const onHide = () => {
    if (!doc || doc.visibilityState === 'hidden') finish();
  };

  const timer = setTimer(() => {
    if (done) return;
    done = true;
    doc?.removeEventListener('visibilitychange', onHide);
    doc?.removeEventListener('pagehide', onHide);
    // Still visible → app never opened → send to the App Store.
    if (!doc || doc.visibilityState === 'visible') {
      if (appStoreUrl) navigate(appStoreUrl);
    }
  }, timeoutMs);

  doc?.addEventListener('visibilitychange', onHide);
  doc?.addEventListener('pagehide', onHide);

  // Fire the deep link last so the listeners/timer are already armed.
  navigate(deepLink);

  return finish;
}
