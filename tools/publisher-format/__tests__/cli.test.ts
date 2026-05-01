import * as path from 'path';
import { runCli } from '../src/cli';

describe('runCli', () => {
  const valid = path.join(__dirname, 'fixtures', 'valid-feed.json');
  const bad = path.join(__dirname, 'fixtures', 'invalid-bad-category.json');

  it('returns exit 0 for a valid feed', async () => {
    expect(await runCli([valid])).toBe(0);
  });
  it('returns exit 1 for an invalid feed', async () => {
    expect(await runCli([bad])).toBe(1);
  });
  it('returns exit 2 with no argument', async () => {
    expect(await runCli([])).toBe(2);
  });
});
