// Guards on .github/workflows/deploy-production.yml.
//
// Asserted as TEXT, not parsed YAML: there is no YAML parser in this
// workspace and adding a dependency to test one file would cost more than
// it protects. These assertions are deliberately narrow — they pin the
// specific facts that are expensive to get wrong, not the file's shape.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const WORKFLOW_PATH = resolve(
  __dirname,
  '../../../.github/workflows/deploy-production.yml'
);
const workflow = readFileSync(WORKFLOW_PATH, 'utf8');

describe('deploy-production paths-ignore', () => {
  // A merge touching only these paths must not start a run at all. Before
  // this existed, a docs-only merge redeployed six Lambdas, synced S3,
  // invalidated CloudFront and re-triggered three data ingests.
  it.each(["'docs/**'", "'ios/**'", "'**/*.md'"])(
    'ignores %s',
    (pattern) => {
      expect(workflow).toContain(pattern);
    }
  );

  it('declares paths-ignore under the push trigger', () => {
    // Ordering matters: paths-ignore has to sit inside `on.push`, not
    // inside workflow_dispatch (where it is silently meaningless).
    const push = workflow.slice(
      workflow.indexOf('  push:'),
      workflow.indexOf('  workflow_dispatch:')
    );
    expect(push).toContain('paths-ignore:');
  });

  // The single most dangerous thing to add to the ignore list. shared/ is a
  // FRONTEND BUILD INPUT: frontend/src/lib/quickLinks.ts imports
  // @shared/links.json via the Vite alias at vite.config.ts:132. Ignoring it
  // would let a links.json edit merge and never reach the header — a failure
  // indistinguishable from a caching bug.
  it('does NOT ignore shared/', () => {
    const ignoreBlock = workflow.slice(
      workflow.indexOf('paths-ignore:'),
      workflow.indexOf('  workflow_dispatch:')
    );
    expect(ignoreBlock).not.toContain("shared/");
  });

  // frontend/ and backend/ must never be ignored either, for the obvious
  // reason. Pinned because an over-eager ignore list is a silent no-deploy.
  it.each(["- 'frontend/**'", "- 'backend/**'"])(
    'does NOT ignore %s',
    (pattern) => {
      const ignoreBlock = workflow.slice(
        workflow.indexOf('paths-ignore:'),
        workflow.indexOf('  workflow_dispatch:')
      );
      expect(ignoreBlock).not.toContain(pattern);
    }
  );
});

describe('deploy-production job split', () => {
  it.each(['changes:', 'deploy-backend:', 'deploy-frontend:', 'verify:'])(
    'declares the %s job',
    (job) => {
      expect(workflow).toContain(`  ${job}`);
    }
  );

  // Secrets resolve per-job, not per-workflow. A deploy job without this
  // gets no AWS credentials and fails at the first aws call.
  it('puts environment: production on both deploy jobs', () => {
    // ` {4}` rather than four literal spaces: same match, but eslint's
    // no-regex-spaces rejects countable runs of spaces in a regex literal.
    const occurrences = workflow.match(/^ {4}environment: production$/gm) ?? [];
    expect(occurrences.length).toBeGreaterThanOrEqual(2);
  });

  // The fork guard has to be on every job now that there are four. A fork
  // would otherwise red-X on every push, or deploy over production if
  // someone added real credentials to the fork's secrets.
  //
  // One per job: changes, deploy-backend, deploy-frontend, verify. A new
  // job added without the guard is exactly the regression this catches —
  // so the constant is meant to be updated deliberately, not derived.
  it('repeats the fork guard on every job', () => {
    const guards =
      workflow.match(/github\.repository == 'bbernstein\/chq-calendar'/g) ?? [];
    expect(guards.length).toBe(4);
  });

  // Two concurrent runs interleave the ci-e2e-test publisher's
  // enable/disable toggles and corrupt the post-deploy retraction
  // assertion. With four jobs the group has to be workflow-level.
  it('declares concurrency at workflow level, not job level', () => {
    const beforeJobs = workflow.slice(0, workflow.indexOf('\njobs:'));
    expect(beforeJobs).toContain('concurrency:');
    expect(beforeJobs).toContain('group: deploy-production');
    expect(beforeJobs).toContain('cancel-in-progress: false');
  });

  // shared/** must be in the FRONTEND filter. This is the assertion that
  // catches the failure mode where editing links.json deploys nothing that
  // rebuilds the bundle it is compiled into.
  it('routes shared/ to the frontend filter', () => {
    // Anchored on the ASSIGNMENT, not the bare name: the comments above
    // these lines mention both markers, and slicing between those comments
    // asserts against prose that describes the constraint rather than the
    // regex that implements it. That version passed even with `shared/|`
    // deleted from the real filter.
    const from = workflow.indexOf("FRONTEND_PATHS='");
    const to = workflow.indexOf("BACKEND_PATHS='");
    expect(from, "FRONTEND_PATHS assignment missing").toBeGreaterThan(-1);
    expect(to, "BACKEND_PATHS assignment missing").toBeGreaterThan(from);
    const frontendFilter = workflow.slice(from, to);
    expect(frontendFilter).toContain('shared/');
    expect(frontendFilter).toContain('frontend/');
  });

  // A bare [skip-deploy] must NOT skip. The reason is required, so opting
  // out is a recorded decision rather than silence — same contract as
  // [skip-screenshots: <reason>] in app-store-assets.yml.
  //
  // The workflow uses grep -qE, so this is ERE: a bare +, and a POSIX
  // [[:space:]] class rather than \s.
  it('requires a non-empty reason on the skip-deploy marker', () => {
    expect(workflow).toContain('skip-deploy: *[^][:space:]][^]]*');
  });

  // Pinning the bug, not just the fix. `[skip-deploy: *[^]]+]` looks
  // equivalent and is not: against `[skip-deploy: ]` the ` *` backtracks to
  // zero and `[^]]+` consumes the space, so a whitespace-only reason skips
  // the deploy. Verified by running all four message shapes through grep.
  it('does not use the naive marker regex that a blank reason satisfies', () => {
    expect(workflow).not.toContain('skip-deploy: *[^]]+');
  });
});
