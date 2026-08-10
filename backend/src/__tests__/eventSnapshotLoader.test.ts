import { EventSnapshotLoader } from '../services/eventSnapshotLoader';

const mockSend = jest.fn();
const mockS3: any = { send: mockSend };

function s3Json(body: unknown) {
  return { Body: { transformToString: () => Promise.resolve(JSON.stringify(body)) } };
}
function noSuchKey() {
  const err = new Error('missing');
  (err as any).name = 'NoSuchKey';
  return err;
}

const PRIMARY = { data: [
  { id: '1', title: 'Morning Lecture', startDate: '2026-07-15T10:45:00', location: 'Amphitheater' },
  { id: '2', title: 'Opera', startDate: '2026-07-15T16:00:00' },
] };
const SIDECAR = { data: [
  { id: '2', title: 'Opera (dup)', startDate: '2026-07-15T16:00:00' },
  { id: 'pub-3', title: 'Publisher Event', startDate: '2026-07-16T12:00:00' },
] };

describe('EventSnapshotLoader', () => {
  beforeEach(() => jest.resetAllMocks());

  test('merges primary + sidecar, deduped by id (primary wins)', async () => {
    mockSend.mockResolvedValueOnce(s3Json(PRIMARY)).mockResolvedValueOnce(s3Json(SIDECAR));
    const loader = new EventSnapshotLoader(mockS3, 'bucket', 'cache/calendar-cache');
    const events = await loader.load(2026);
    expect(events.map(e => e.id)).toEqual(['1', '2', 'pub-3']);
    expect(events[1].title).toBe('Opera'); // primary version kept
    expect(mockSend.mock.calls[0][0].input.Key).toBe('cache/calendar-cache/all-events-2026.json');
    expect(mockSend.mock.calls[1][0].input.Key).toBe('cache/calendar-cache/publisher-events-2026.json');
  });

  test('missing sidecar is tolerated; missing primary throws', async () => {
    mockSend.mockResolvedValueOnce(s3Json(PRIMARY)).mockRejectedValueOnce(noSuchKey());
    const loader = new EventSnapshotLoader(mockS3, 'bucket', 'cache/calendar-cache');
    expect((await loader.load(2026)).map(e => e.id)).toEqual(['1', '2']);

    mockSend.mockReset();
    mockSend.mockRejectedValueOnce(noSuchKey());
    await expect(loader.load(2026)).rejects.toThrow();
  });
});
