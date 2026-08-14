import { useEffect, useState } from 'react';
import { APP_STORE_URL } from '@/lib/constants';
import { readDeviceInfo, shouldShowPromoBanner, snoozePromo } from '@/lib/iosPromo';

/**
 * A dismissible strip shown to iPhone/iPad visitors (iOS >= 18) inviting them
 * into the native app via its App Store listing (see `iosPromo` for why we
 * don't try the `chqcal://` scheme first). Dismissing snoozes the banner for a
 * few days. Renders nothing on ineligible devices, while snoozed, or before the
 * app is live (empty APP_STORE_URL). The eligibility check runs in an effect so
 * the server/first paint stays deterministic.
 */
export function IosAppBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(shouldShowPromoBanner(readDeviceInfo(), Date.now()));
  }, []);

  if (!visible) return null;

  const handleOpen = () => {
    // Heading to the store counts as engagement — snooze so we don't re-nag
    // someone who just acted on the banner. Deliberately no `setVisible(false)`
    // here: unmounting the anchor from inside its own click handler can cancel
    // the navigation it was supposed to perform. The snooze hides the banner on
    // the next load, which is when the user actually comes back to it.
    snoozePromo(Date.now());
  };

  const handleDismiss = () => {
    snoozePromo(Date.now());
    setVisible(false);
  };

  return (
    <div className="bg-blue-600 text-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2 flex items-center gap-3">
        <img
          src="/chq-calendar-icon-256.svg"
          alt=""
          aria-hidden="true"
          width={28}
          height={28}
          className="w-7 h-7 rounded-md bg-white/10 p-0.5 shrink-0"
        />
        <p className="text-sm leading-tight flex-1 min-w-0">
          <span className="font-medium">Get the CHQ Calendar app</span>
          <span className="hidden sm:inline"> — reminders, Home Screen widgets, and a map of the grounds.</span>
        </p>
        <a
          href={APP_STORE_URL}
          onClick={handleOpen}
          className="shrink-0 px-3 py-1 text-sm font-medium bg-white text-blue-700 rounded-md hover:bg-blue-50 transition-colors"
        >
          Get the app
        </a>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss"
          className="shrink-0 p-1 -mr-1 text-white/80 hover:text-white transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
