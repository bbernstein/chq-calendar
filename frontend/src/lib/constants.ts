export const CACHE_EXPIRY_MS = 3600000; // 1 hour in milliseconds
export const USER_STATE_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000; // 30 days in milliseconds
export const ACTIVE_YEAR = 2026;

export const locationShortcuts: Record<string, string> = {
  "Elizabeth S. Lenna Hall": "Lenna Hall",
  "AAHH African American Heritage House": "AAHH",
  "Fletcher Music Hall": "Fletcher Hall",
  "Smith Wilkes Hall": "Smith Wilkes",
  "Alumni Hall Ballroom": "Alumni Hall",
  "Chabad Jewish House": "Chabad House",
  "Fowler-Kellogg Art Center 2nd floor": "Fowler-Kellogg 2nd Floor",
  "Fowler-Kellogg Art Center: 1st Floor": "Fowler-Kellogg 1st Floor",
  "Everett Jewish Life Center": "Everett Jewish Center",
  "Hall of Christ: Sanctuary": "Hall of Christ",
  "Denominational Houses (Selected)": "Denominational Houses",
};

export const categoryShortcuts: Record<string, string> = {
  "Chautauqua Symphony Orchestra/Classical Concerts": "CSO",
  "Chautauqua Institution Program": "CHQ Program",
  "Chautauqua Literary and Scientific Circle (CLSC)": "CLSC",
  "Climate Change Initiative Program": "Climate Change Program",
};

export function getLocationDisplayName(location: string): string {
  return locationShortcuts[location] || location;
}

export function getCategoryDisplayName(category: string): string {
  return categoryShortcuts[category] || category;
}
