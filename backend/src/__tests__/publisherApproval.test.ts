import { isApprovedPublisher } from '../utils/publisherApproval';

describe('isApprovedPublisher', () => {
  it('returns true when applicationStatus is undefined (legacy admin-created row)', () => {
    expect(isApprovedPublisher({})).toBe(true);
    expect(isApprovedPublisher({ applicationStatus: undefined })).toBe(true);
  });

  it('returns true when applicationStatus is "approved"', () => {
    expect(isApprovedPublisher({ applicationStatus: 'approved' })).toBe(true);
  });

  it('returns false when applicationStatus is "pending"', () => {
    expect(isApprovedPublisher({ applicationStatus: 'pending' })).toBe(false);
  });

  it('returns false when applicationStatus is "rejected"', () => {
    expect(isApprovedPublisher({ applicationStatus: 'rejected' })).toBe(false);
  });
});
