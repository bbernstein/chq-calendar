interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
}

export function SearchBar({ value, onChange }: SearchBarProps) {
  return (
    <div className="mb-2 sm:mb-4">
      <input
        type="text"
        // A placeholder is not a label. It is the only name this field had,
        // and a placeholder disappears the moment the reader types — so
        // anyone returning to a field they have already filled in, with a
        // screen reader or voice control, had nothing to identify it by.
        // Some browsers do fall back to the placeholder for the accessible
        // name, but the fallback is last-resort by spec and not universal.
        aria-label="Search events"
        placeholder="Search events..."
        className="w-full border border-gray-300 dark:border-gray-600 rounded-md px-3 py-2 text-sm sm:text-base bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
