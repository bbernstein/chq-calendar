import type { EnvironmentContext, JestEnvironmentConfig } from '@jest/environment';
import type { TestEnvironment as NodeEnvironment } from 'jest-environment-node';

// The project's own environment (localStorage workaround), not the stock
// one, so a suite that opts into this behaves like every other suite in
// every other respect.
const BaseEnvironment: typeof NodeEnvironment = require('../../../jest-environment.cjs');

/**
 * Runs one test file with the worker process on a chosen timezone.
 *
 * Opt in per file with a docblock:
 *
 *     /**
 *      * @jest-environment ./src/__tests__/environments/timeZoneEnvironment.ts
 *      * @jest-environment-options {"timeZone": "Asia/Tokyo"}
 *      *\/
 *
 * Why an environment and not `process.env.TZ = ...` in a `beforeAll`: inside
 * a test, `process` is Jest's sandbox copy, and its `env` is a plain object
 * copied from the real one (jest-util `createProcessObject`). Assigning `TZ`
 * there changes nothing — Node only re-reads the zone when the *real*
 * `process.env.TZ` is assigned, which the environment, running in the worker
 * itself, can do. That was established by trying it first: the `beforeAll`
 * version left `Intl` on America/New_York.
 *
 * The zone is set before `super()` so the sandbox's copy of `process.env`
 * agrees with the clock, and restored in `teardown` because Jest workers are
 * reused across files — leaking it would move every later suite on that
 * worker to a zone nobody asked for.
 */
export default class TimeZoneEnvironment extends BaseEnvironment {
  private readonly originalTz: string | undefined;

  constructor(config: JestEnvironmentConfig, context: EnvironmentContext) {
    const timeZone = config.projectConfig.testEnvironmentOptions?.timeZone;
    if (typeof timeZone !== 'string' || timeZone.length === 0) {
      throw new Error(
        'timeZoneEnvironment needs a zone: add '
        + '`@jest-environment-options {"timeZone": "<IANA zone>"}` to the test file docblock.',
      );
    }
    const originalTz = process.env.TZ;
    process.env.TZ = timeZone;
    super(config, context);
    this.originalTz = originalTz;
  }

  async teardown(): Promise<void> {
    // Assigning `undefined` would store the string "undefined", which Node
    // reads as UTC rather than as the machine's own zone.
    if (this.originalTz === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = this.originalTz;
    }
    await super.teardown();
  }
}
