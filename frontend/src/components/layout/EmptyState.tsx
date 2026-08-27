interface EmptyStateProps {
  /**
   * Whether the reader narrowed the list themselves.
   *
   * This component has two callers, and until now it addressed only one of
   * them. `page.tsx` renders it whenever `groupedEvents` is empty, which
   * happens for a search or a venue that matches nothing — and ALSO for
   * `landingState.ts` rule 3: a failed or empty feed fetch during the season,
   * where `showLanding` is false and the year simply has no events. "Try
   * adjusting your filters or search terms" is true advice for the first
   * reader and a dead end for the second, who has set no filters at all and
   * is being told to adjust something they never touched.
   *
   * Required rather than defaulted, deliberately. A default is a guess about
   * which caller is more common, and getting it wrong reintroduces exactly
   * this bug silently at whichever call site forgets to pass it.
   */
  hasFilters: boolean;
}

export function EmptyState({ hasFilters }: EmptyStateProps) {
  return (
    <div data-testid="empty-state" className="text-center py-12">
      <div className="text-6xl mb-4">🎭</div>
      <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
        {hasFilters ? 'No events found' : 'No events to show'}
      </h3>
      <p className="text-gray-600 dark:text-gray-200 mb-4">
        {hasFilters
          ? 'Try adjusting your filters or search terms.'
          : 'We don’t have any events for this year yet. If that’s unexpected, try reloading in a moment.'}
      </p>
    </div>
  );
}
