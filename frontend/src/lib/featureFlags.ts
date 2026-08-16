/**
 * Build-time flags.
 *
 * Each reads `import.meta.env` **inside the function**, never at module
 * scope: `vi.stubEnv` mutates `import.meta.env` at runtime, and a value
 * captured at import time would freeze whatever the first test saw. It also
 * keeps the flag honest in the dev server, where the variable can change
 * between restarts.
 */

/**
 * Phase 2 of the date-navigation initiative: the day-granular render window,
 * automatic forward expansion and the "Show earlier" control.
 *
 * Off unless `VITE_NAV_V2` is exactly `"true"`, so merging the phase changes
 * nothing for anyone until the flip. Matches the `VITE_ENABLE_PUBLISHER_FEEDS`
 * idiom already used by `useEventData`.
 */
export function isNavV2Enabled(): boolean {
  return String(import.meta.env.VITE_NAV_V2) === 'true';
}
