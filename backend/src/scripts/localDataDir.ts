import * as path from 'path';

/**
 * `frontend/public/data/` — where the local-data scripts write the files the
 * frontend reads when `VITE_LOCAL_DATA=true`.
 *
 * Shared rather than spelled out at each write site, because it was spelled
 * out four times and every one of them was wrong. `__dirname` here is
 * `backend/src/scripts`, so three levels up is the repo root; the four
 * `../../../../` copies resolved to the repo's *parent* and quietly created a
 * whole `frontend/public/data/` tree next to the checkout. `sync:local`
 * reported "Saved all-events-2026.json" and pointed at a path outside the
 * repository, which nothing serves and no `git status` ever shows.
 *
 * That was one of four independent reasons `npm run sync:local` had never
 * produced a usable file — alongside the unsuffixed filename, a guard that
 * could not pass, and the cache handing back a bare array (all fixed in #300).
 * A constant is the cheap way to stop the fifth.
 */
export const LOCAL_DATA_DIR = path.join(__dirname, '../../../frontend/public/data');
