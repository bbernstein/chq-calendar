/**
 * Local-only manual trigger for the program-links pipeline.
 *
 * Runs the REAL scraper + matcher (`runProgramIngest`) against:
 *   - the REAL audienceaccess.co listing pages (read-only, public)
 *   - events read from `frontend/public/data/all-events-<year>.json`
 *   - the sidecar written to `frontend/public/data/program-links-<year>.json`
 *     and the private state to a gitignored dotfile alongside it
 *
 * Nothing here touches AWS. After a run, `npm run dev` in frontend/ serves
 * the result; expand a matched event card to see the link.
 *
 * Usage (from backend/):
 *   npx ts-node src/scripts/runProgramIngestLocal.ts          # current year
 *   npx ts-node src/scripts/runProgramIngestLocal.ts 2026     # explicit year
 */
import * as fs from 'fs';
import * as path from 'path';
import { AudienceAccessClient } from '../services/audienceAccessClient';
import { runProgramIngest } from '../services/programIngestRunner';
import type { CalendarEventLite } from '../types/articles';
import type { ProgramLinksFile, ProgramMatchState } from '../types/programs';

const DATA_DIR = path.resolve(__dirname, '../../../frontend/public/data');

function readJson<T>(file: string): T | undefined {
  if (!fs.existsSync(file)) return undefined;
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

async function main(): Promise<void> {
  const year = Number(process.argv[2]) || new Date().getFullYear();
  const eventsFile = path.join(DATA_DIR, `all-events-${year}.json`);
  const events = readJson<{ data?: CalendarEventLite[] }>(eventsFile)?.data;
  if (!events?.length) {
    throw new Error(`no events in ${eventsFile} — run the frontend data setup first`);
  }
  const sidecarFile = path.join(DATA_DIR, `program-links-${year}.json`);
  const stateFile = path.join(DATA_DIR, `.program-links-state-${year}.json`);

  const summary = await runProgramIngest({
    client: new AudienceAccessClient(),
    loader: { load: async () => events },
    publisher: {
      loadState: async () => readJson<ProgramMatchState>(stateFile),
      saveState: async (_y, state) => {
        fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
      },
      publishLinks: async (_y, file: ProgramLinksFile) => {
        fs.writeFileSync(sidecarFile, JSON.stringify(file, null, 2));
      },
    },
    now: new Date(),
    year,
  });
  console.log(`wrote ${sidecarFile}`);
  console.log(summary);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
