import type { ApplicationStatus } from '../types/publisher';

// A publisher is "approved" — and therefore eligible for self-service routes
// like profile edit, ingest controls, email change — when:
//   - applicationStatus === 'approved' (the standard case after admin
//     accepts the application), OR
//   - applicationStatus is undefined (legacy admin-created rows that pre-date
//     the application flow; treated as approved for backwards compatibility).
//
// Pending/rejected applicants are gated out (HTTP 403 in the handler;
// non-editable view in the frontend).
//
// Mirror of frontend/src/lib/publisherApproval.ts. The two files duplicate
// ~5 lines deliberately rather than introducing a shared workspace package
// across backend and frontend builds.
export function isApprovedPublisher(rec: { applicationStatus?: ApplicationStatus }): boolean {
  return rec.applicationStatus === undefined || rec.applicationStatus === 'approved';
}
