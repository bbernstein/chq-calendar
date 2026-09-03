import { scheduledHandler } from '../handlers/classesIngestHandler';
import * as runner from '../services/classesIngestRunner';
import { institutionSeasonYear } from '../services/classesIngestRunner';

jest.mock('../services/classesSearchClient');
jest.mock('../services/classesPublisher');

describe('institutionSeasonYear', () => {
  // The ticket site prints session dates with no year, so the year we stamp
  // is the only thing deciding which season those dates land in.
  it.each([
    ['2026-07-04T12:00:00Z', 2026, 'mid-season'],
    ['2026-09-30T12:00:00Z', 2026, 'the day before turnover'],
    ['2026-10-01T12:00:00Z', 2027, 'turnover day'],
    ['2027-02-01T12:00:00Z', 2027, 'the following winter'],
  ])('%s -> %i (%s)', (iso, expected) => {
    expect(institutionSeasonYear(new Date(iso))).toBe(expected);
  });

  it('turns over on Institution time, not UTC', () => {
    // 00:30 UTC on October 1 is still 20:30 on September 30 at Chautauqua,
    // so a run then belongs to the season that has not turned over yet.
    expect(institutionSeasonYear(new Date('2026-10-01T00:30:00Z'))).toBe(2026);
  });
});

describe('classes ingest handler', () => {
  const run = jest.spyOn(runner, 'runClassesIngest');

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CACHE_S3_BUCKET = 'a-bucket';
    run.mockResolvedValue({
      mode: 'full', classes: 0, sessions: 0,
      detailsFetched: 0, detailFailures: 0, carriedForward: 0,
      matched: 0, listedOnly: 0, unobserved: 0, cancelled: 0, published: false, changed: false,
    });
  });

  it('passes the mode the schedule sent', async () => {
    await scheduledHandler({ mode: 'spots' });
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ mode: 'spots' }));
  });

  it('defaults to a full crawl when no mode is given', async () => {
    await scheduledHandler();
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ mode: 'full' }));
  });

  it('rejects an unknown mode instead of falling back', async () => {
    // Defaulting here would turn a Terraform typo into a 466-page crawl on
    // the frequent schedule, against someone else's site.
    await expect(scheduledHandler({ mode: 'sopts' })).rejects.toThrow(/unknown mode "sopts"/);
    expect(run).not.toHaveBeenCalled();
  });

  it('honours a year given for a manual run', async () => {
    await scheduledHandler({ year: 2025 });
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ year: 2025 }));
  });

  it('fails loudly when the bucket is not configured', async () => {
    delete process.env.CACHE_S3_BUCKET;
    await expect(scheduledHandler()).rejects.toThrow(/CACHE_S3_BUCKET/);
    expect(run).not.toHaveBeenCalled();
  });
});
