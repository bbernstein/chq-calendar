// Reset helper that wraps POST /admin/api/smoke-reset-bbtest. Used as the
// before/after teardown for the smoke journey — see publisher-lifecycle.test.ts.
//
// Why a wrapper (vs calling api.admin.smokeReset() inline): centralizes
// the "log what we cleaned up" line so a CI failure shows whether the
// previous run left state behind. If the first reset reports rowsAffected > 0
// AND the journey was supposed to be clean, the most recent run was killed
// mid-flight; that's a finding worth surfacing in the deploy log.

import { SmokeApiClient } from './apiClient';

export async function resetBbtestEmail(api: SmokeApiClient, email: string): Promise<void> {
  const r = await api.admin.smokeReset(email);
  // eslint-disable-next-line no-console
  console.log(`[smoke] reset cleaned ${r.rowsAffected} rows for ${email}`);
}
