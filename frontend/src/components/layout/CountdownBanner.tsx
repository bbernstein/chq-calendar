import { useMemo } from 'react';
import type { SeasonWeek } from '@/lib/types';
import { CHQ_ZONE } from '@/lib/utils/chqTime';

interface CountdownBannerProps {
  seasonWeeks: SeasonWeek[];
}

export function CountdownBanner({ seasonWeeks }: CountdownBannerProps) {
  const daysUntilSeason = useMemo(() => {
    if (seasonWeeks.length === 0) return null;
    const seasonStart = seasonWeeks[0].start;
    const now = new Date();
    if (now >= seasonStart) return null; // Season has started
    const diffMs = seasonStart.getTime() - now.getTime();
    return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  }, [seasonWeeks]);

  if (daysUntilSeason === null) return null;

  const seasonStart = seasonWeeks[0].start;
  const dateStr = seasonStart.toLocaleDateString('en-US', {
    timeZone: CHQ_ZONE,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="bg-blue-50 dark:bg-blue-900/30 border-b border-blue-100 dark:border-blue-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2 text-center text-sm text-blue-700 dark:text-blue-300">
        Season starts {dateStr} — {daysUntilSeason} {daysUntilSeason === 1 ? 'day' : 'days'} away
      </div>
    </div>
  );
}
