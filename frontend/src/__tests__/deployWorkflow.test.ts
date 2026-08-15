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
