export function EmptyState() {
  return (
    <div data-testid="empty-state" className="text-center py-12">
      <div className="text-6xl mb-4">🎭</div>
      <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">No events found</h3>
      <p className="text-gray-600 dark:text-gray-200 mb-4">
        Try adjusting your filters or search terms.
      </p>
    </div>
  );
}
