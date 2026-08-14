/**
 * Logic for promoting the native iOS app to eligible web visitors.
 *
 * The web calendar runs in every browser, but iPhone/iPad visitors on a
 * device that can run our app (iOS >= 18, the app's deployment target) get a
 * nudge toward its App Store listing, and a dismissal is remembered for a few
 * days.
 *
 * Every promo surface links straight to the App Store rather than trying the
 * app's `chqcal://` scheme first. There is no browser API that answers "is
 * this app installed?", and the classic scheme-with-timeout trick fails loudly
 * for anyone who doesn't have it: iOS Safari shows a modal "the address is
 * invalid" alert for an unregistered scheme (confirmed on a simulator with the
 * app absent), which is exactly the audience a promo banner is aimed at. The
 * App Store listing costs an installed user one extra tap — the store shows
 * "Open" — and costs everyone else nothing. Universal Links (silent launch
 * when installed, App Store otherwise) are the real fix and are tracked as the
 * Phase 2 follow-up; they need an `applinks` entitlement and an app release.
 */

import { APP_STORE_URL, IOS_MIN_VERSION, IOS_PROMO_SNOOZE_MS } from '@/lib/constants';

/** localStorage key holding the epoch-ms until which the banner stays hidden. */
export const IOS_PROMO_SNOOZE_KEY = 'chq-calendar-ios-promo-snooze';

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
  /** Parsed major iOS version, or null when the UA doesn't expose it. For an
   *  iPad in desktop mode this is Safari's major, which tracks the OS major. */
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
 * iPadOS 13+ masquerades as desktop Safari ("MacIntel" + touch), which drops
 * the `OS <major>_` token. Safari still reports its own `Version/<major>`
 * there, and Safari's major version has tracked the OS major since iOS 15, so
 * that stands in as the version signal for this case.
 *
 * When neither token parses we stay eligible for iPad-as-desktop and fall back
 * to ineligible everywhere else. That asymmetry is deliberate: showing the
 * promo to an iPad we couldn't version-check costs one tap onto a store page
 * that says the app needs a newer OS, while hiding it from a modern iPad costs
 * an install we never hear about. A UA that names iOS but carries no version
 * is a narrower, weirder case, so it stays ineligible rather than guessed.
 */
export function detectIosEligibility(device: DeviceInfo): IosEligibility {
  const { userAgent, platform, maxTouchPoints, standalone } = device;

  const uaIsIos = /iPhone|iPod|iPad/.test(userAgent);
  const ipadAsDesktop = platform === 'MacIntel' && maxTouchPoints > 1;
  const isIos = uaIsIos || ipadAsDesktop;

  const osMatch = userAgent.match(/OS (\d+)_/);
  const safariMatch = ipadAsDesktop ? userAgent.match(/Version\/(\d+)/) : null;
  const versionMatch = osMatch ?? safariMatch;
  const version = versionMatch ? parseInt(versionMatch[1], 10) : null;

  let versionOk: boolean;
  if (version !== null) {
    versionOk = version >= IOS_MIN_VERSION;
  } else {
    // Nothing to check: eligible only for iPad-as-desktop (see above).
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

/** Whether the always-available header link to the app should render. */
export function isAppPromoAvailable(device: DeviceInfo): boolean {
  return APP_STORE_URL.length > 0 && detectIosEligibility(device).eligible;
}
