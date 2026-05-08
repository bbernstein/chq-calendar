import type { ApplicationStatus } from '@/lib/publisherStatusApi';

// A publisher is "approved" — and therefore eligible for self-service controls
// like profile edit, ingest controls, email change — when:
//   - applicationStatus === 'approved' (the standard case after admin
//     accepts the application), OR
//   - applicationStatus is undefined (legacy admin-created rows that pre-date
//     the application flow; treated as approved for backwards compatibility).
//
// Pending/rejected applicants see a non-editable view.
//
// Mirror of backend/src/utils/publisherApproval.ts. The two files duplicate
// ~5 lines deliberately rather than introducing a shared workspace package
// across backend and frontend builds.
export function isApprovedPublisher(rec: { applicationStatus?: ApplicationStatus }): boolean {
  return rec.applicationStatus === undefined || rec.applicationStatus === 'approved';
}
