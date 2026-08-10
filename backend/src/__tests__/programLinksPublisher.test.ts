import { ProgramLinksPublisher } from '../services/programLinksPublisher';
import type { ProgramMatchState, ProgramLinksFile } from '../types/programs';

const mockSend = jest.fn();
const mockS3: any = { send: mockSend };

const STATE: ProgramMatchState = { matcherVersion: 1, programs: {}, eventFingerprints: {}, matches: [] };
const FILE: ProgramLinksFile = { generatedAt: '2026-07-15T14:00:00.000Z', matcherVersion: 1, links: {} };

describe('ProgramLinksPublisher', () => {
  let pub: ProgramLinksPublisher;
  beforeEach(() => {
    jest.resetAllMocks();
    pub = new ProgramLinksPublisher(
      mockS3,
      'bucket',
      'cache/calendar-cache',
      'internal/program-links',
      'private-bucket',
    );
  });

  test('publishLinks writes public key with 5-minute cache-control on the public bucket', async () => {
    mockSend.mockResolvedValue({});
    await pub.publishLinks(2026, FILE);
    const cmd: any = mockSend.mock.calls[0][0];
    expect(cmd.input.Bucket).toBe('bucket');
    expect(cmd.input.Key).toBe('cache/calendar-cache/program-links-2026.json');
    expect(cmd.input.CacheControl).toBe('public, max-age=300');
    expect(cmd.input.ContentType).toBe('application/json');
    expect(JSON.parse(cmd.input.Body)).toEqual(FILE);
  });

  test('state round-trips on the internal prefix of the private state bucket; missing state → undefined', async () => {
    mockSend.mockResolvedValueOnce({});
    await pub.saveState(2026, STATE);
    expect(mockSend.mock.calls[0][0].input.Bucket).toBe('private-bucket');
    expect(mockSend.mock.calls[0][0].input.Key).toBe('internal/program-links/program-links-state-2026.json');

    const err = new Error('nope');
    (err as any).name = 'NoSuchKey';
    mockSend.mockRejectedValueOnce(err);
    expect(await pub.loadState(2026)).toBeUndefined();

    mockSend.mockResolvedValueOnce({ Body: { transformToString: () => Promise.resolve(JSON.stringify(STATE)) } });
    expect(await pub.loadState(2026)).toEqual(STATE);
    expect(mockSend.mock.calls[mockSend.mock.calls.length - 1][0].input.Bucket).toBe('private-bucket');
  });

  test('loadState rethrows non-NoSuchKey errors (run must abort, not full-recompute)', async () => {
    mockSend.mockRejectedValueOnce(new Error('AccessDenied'));
    await expect(pub.loadState(2026)).rejects.toThrow('AccessDenied');
  });

  test('omitting stateBucket falls back to the public bucket (backward compatibility)', async () => {
    const fallback = new ProgramLinksPublisher(mockS3, 'bucket', 'cache/calendar-cache', 'internal/program-links');
    mockSend.mockResolvedValueOnce({});
    await fallback.saveState(2026, STATE);
    expect(mockSend.mock.calls[0][0].input.Bucket).toBe('bucket');
  });
});
