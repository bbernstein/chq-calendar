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

// The text from `jobs:` to EOF, split into one entry per job. Job headers
// are the only 2-space-indented, value-less, lowercase keys inside that
// block. Used by the per-job assertions below so they can say WHICH job
// carries a property rather than only how many do.
function jobBlocks(): Array<{ name: string; body: string; header: string }> {
  const jobsAt = workflow.indexOf('\njobs:');
  expect(jobsAt, '`jobs:` block missing').toBeGreaterThan(-1);
  const jobsSection = workflow.slice(jobsAt);
  const headers = [...jobsSection.matchAll(/^ {2}([a-z][a-z-]*):$/gm)];
  return headers.map((match, i) => {
    const start = match.index;
    const end = headers[i + 1]?.index ?? jobsSection.length;
    const body = jobsSection.slice(start, end);
    // The job's own configuration — everything before its `steps:`. A
    // guard has to live HERE to gate the job; the same string appearing
    // inside a step body would not gate anything.
    const stepsAt = body.indexOf('\n    steps:');
    return {
      name: match[1],
      body,
      header: stepsAt > -1 ? body.slice(0, stepsAt) : body,
    };
  });
}

function jobNamed(name: string) {
  const job = jobBlocks().find((j) => j.name === name);
  expect(job, `job ${name} not found`).toBeDefined();
  return job!;
}

describe('deploy-production paths-ignore', () => {
  // A merge touching only these paths must not start a run at all. Before
  // this existed, an iOS-only merge redeployed six Lambdas, synced S3,
  // invalidated CloudFront and re-triggered three data ingests.
  it.each(["'ios/**'", "'**/*.md'"])(
    'ignores %s',
    (pattern) => {
      expect(workflow).toContain(pattern);
    }
  );

  // docs/** was in this list and had to come OUT. Two files under docs/ are
  // Lambda build inputs: docs/publisher/categories.json and
  // docs/publisher/venues.json are copied into
  // tools/publisher-format/dist/refs by its `copy-refs` script, then into
  // backend/dist/refs by backend's `build:prod`, and shipped inside the
  // admin and publisher-ingest zips. While docs/** was ignored, editing a
  // venue list merged with NO workflow run at all — a silent no-deploy that
  // looked green.
  //
  // The narrower "ignore docs/ but not docs/publisher/" is not expressible:
  // paths-ignore has no negation. `**/*.md` stays, so the common all-Markdown
  // docs change still costs no run.
  it('does NOT ignore docs/', () => {
    const ignoreBlock = workflow.slice(
      workflow.indexOf('paths-ignore:'),
      workflow.indexOf('  workflow_dispatch:')
    );
    expect(ignoreBlock).not.toContain('docs/');
  });

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
  //
  // Asserted per-job rather than as a count. A `>= 2` count is satisfied by
  // any two jobs having it — including the wrong two — so it would pass
  // while a deploy job silently ran without credentials.
  it('puts environment: production on both deploy jobs and not on verify', () => {
    // ` {4}` rather than four literal spaces: same match, but eslint's
    // no-regex-spaces rejects countable runs of spaces in a regex literal.
    const declared = /^ {4}environment: production$/m;
    expect(jobNamed('deploy-backend').body).toMatch(declared);
    expect(jobNamed('deploy-frontend').body).toMatch(declared);
    // verify deliberately has none: its only step is curl + jq, so it needs
    // no AWS credentials and should not hold the production environment.
    expect(jobNamed('verify').body).not.toMatch(declared);
  });

  // The fork guard has to be on every job. A fork would otherwise red-X on
  // every push, or deploy over production if someone added real credentials
  // to the fork's secrets.
  //
  // Asserted against the jobs actually present, not against a constant. The
  // previous form counted guards and expected 4, with a comment claiming "a
  // new job added without the guard is exactly the regression this catches"
  // — which was false: a 5th UNGUARDED job leaves the count at 4 and the
  // test passes. That is precisely the security-relevant case, so the
  // assertion is made true rather than the comment softened.
  it('repeats the fork guard on every job', () => {
    const jobs = jobBlocks();
    // The real invariant, checked first so an unguarded job is diagnosed by
    // name rather than as an off-by-one in a list.
    for (const job of jobs) {
      expect(
        job.header,
        `job ${job.name} has no fork guard in its own if:`
      ).toContain("github.repository == 'bbernstein/chq-calendar'");
    }
    // Then pin the discovered set, so the test fails loudly if the header
    // parse stops working (e.g. a future job name with an underscore or a
    // capital) instead of silently looping over an empty list.
    expect(jobs.map((j) => j.name)).toEqual([
      'changes',
      'deploy-backend',
      'deploy-frontend',
      'verify',
    ]);
  });

  // Two concurrent runs interleave the ci-e2e-test publisher's
  // enable/disable toggles and corrupt the post-deploy retraction
  // assertion. With four jobs the group has to be workflow-level.
  it('declares concurrency at workflow level, not job level', () => {
    // `>-1` guard, matching its siblings. Without it a missing `\njobs:`
    // makes slice(0, -1) return the whole file bar one character, so all
    // three assertions below would pass on a corrupted premise.
    const jobsAt = workflow.indexOf('\njobs:');
    expect(jobsAt, '`jobs:` block missing').toBeGreaterThan(-1);
    const beforeJobs = workflow.slice(0, jobsAt);
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

  // Two Lambda build inputs whose paths do not say "backend". Both were
  // missing from BACKEND_PATHS and both produced a green run that deployed
  // nothing:
  //
  //   tools/ — backend/package.json depends on @chq-calendar/publisher-format
  //     (the workspace at tools/publisher-format) and esbuild inlines it into
  //     adminHandler.js and publisherIngestHandler.js.
  //   docs/publisher/ — categories.json and venues.json are copied into the
  //     Lambda zips as dist/refs (publisher-format's `copy-refs` → backend's
  //     `build:prod` → the `cp -r dist/refs` in the deploy steps).
  //
  // Anchored on the ASSIGNMENT, not the bare marker. The bare-marker form
  // already produced one vacuous test in this file: `indexOf('FRONTEND_PATHS')`
  // landed on the explanatory COMMENT, so the assertion was satisfied by prose
  // describing the constraint rather than by the regex implementing it.
  it.each(['tools/', 'docs/publisher/'])(
    'routes %s to the backend filter',
    (path) => {
      const from = workflow.indexOf("BACKEND_PATHS='");
      expect(from, "BACKEND_PATHS assignment missing").toBeGreaterThan(-1);
      const backendFilter = workflow.slice(
        from,
        workflow.indexOf('\n', from)
      );
      expect(backendFilter).toContain(path);
    }
  );

  // A bare [skip-deploy] must NOT skip. The reason is required, so opting
  // out is a recorded decision rather than silence — same contract as
  // [skip-screenshots: <reason>] in app-store-assets.yml.
  //
  // The workflow uses grep -qE, so this is ERE: a bare +, and a POSIX
  // [[:space:]] class rather than \s.
  //
  // Scoped to the `if grep -qE` line rather than asserted against the whole
  // file: a whole-file toContain is satisfied by a COMMENT quoting the
  // regex, so the guard would survive the regex itself being changed. That
  // mechanism has already produced one vacuous test in this file.
  it('requires a non-empty reason on the skip-deploy marker', () => {
    const markerCheck = workflow
      .split('\n')
      .filter((line) => line.includes('grep -qE') && line.includes('skip-deploy'));
    expect(markerCheck, 'skip-deploy grep line not found').toHaveLength(1);
    expect(markerCheck[0]).toContain(
      "'\\[skip-deploy: *[^][:space:]][^]]*\\]'"
    );
  });

  // Pinning the bug, not just the fix. `[skip-deploy: *[^]]+]` looks
  // equivalent and is not: against `[skip-deploy: ]` the ` *` backtracks to
  // zero and `[^]]+` consumes the space, so a whitespace-only reason skips
  // the deploy. Verified by running all four message shapes through grep.
  //
  // This one is deliberately whole-file: the naive form must not appear
  // ANYWHERE, comments included, so nobody copies it back in.
  it('does not use the naive marker regex that a blank reason satisfies', () => {
    expect(workflow).not.toContain('skip-deploy: *[^]]+');
  });

  // The marker is matched against the commit SUBJECT, never the whole
  // message. A squash merge's commit message is the PR title followed by the
  // PR *body*, so matching the whole thing means any PR whose description
  // documents the marker — a runbook, a plan, or the PR that introduced it —
  // silently skips its own deploy.
  //
  // Not hypothetical: PR #231's description quoted the syntax twice, and
  // matching the full message would have skipped that very deploy.
  it('matches the skip marker against the commit subject only', () => {
    const grepLine = workflow
      .split('\n')
      .find((line) => line.includes('grep -qE') && line.includes('skip-deploy'));
    expect(grepLine, 'skip-deploy grep line not found').toBeDefined();
    // The herestring must feed the extracted subject, not the raw message.
    expect(grepLine).toContain('<<< "$SUBJECT"');
    expect(grepLine).not.toContain('"$COMMIT_MESSAGE"');
    expect(workflow, 'SUBJECT must be the first line of the message').toContain(
      "SUBJECT=$(printf '%s' \"$COMMIT_MESSAGE\" | head -1)"
    );
  });
});

describe('deploy-production verify job', () => {
  // The smoke step is `continue-on-error: true`, so the job always succeeds.
  // An unconditional "Deployment Successful" notice therefore fired even when
  // the smoke had failed — the same shape of defect as the unreachable
  // failure notice removed earlier on this branch: a message asserting
  // something the surrounding control flow cannot support.
  it('reports the post-deploy check outcome instead of assuming success', () => {
    expect(workflow).toContain("if: steps.smoke.outcome == 'success'");
    expect(workflow).toContain("if: steps.smoke.outcome == 'failure'");
    expect(workflow, 'the smoke step must be addressable by id').toContain('id: smoke');
  });

  // Deleted rather than left as a control that does nothing. A manual run IS
  // the force-deploy — the changes job sends any non-push event to
  // FALLBACK_DEPLOY_ALL — and no step ever read this input.
  it('declares no dead workflow_dispatch inputs', () => {
    const dispatchBlock = workflow.slice(
      workflow.indexOf('  workflow_dispatch:'),
      workflow.indexOf('\nconcurrency:')
    );
    expect(dispatchBlock).not.toContain('force_deploy:');
    expect(dispatchBlock).not.toContain('inputs:');
  });
});
