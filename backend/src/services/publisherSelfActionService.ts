// Phase 6 — publisher self-disable orchestration.
//
// Why a dedicated service: the disable flow has three side effects that must
// stay coupled (registry mutation, in-flight email-change cleanup, confirmation
// email) and the handler is already heavy. Pulling them into a small service
// keeps the handler thin and makes the multi-step semantics easy to test.
//
// Confirmation slug: the publisher's own `id` (e.g. `pub-<uuid4>`) doubles as
// the typed-confirmation token. The plan and the existing apply/approval
// emails refer to this value as the publisher's "slug" — same string, two
// names. We compare strictly (case-sensitive, exact match) so a paste with
// trailing whitespace or a typo'd hyphen fails closed.

import { PublisherNotFoundError, PublisherRegistryService } from './publisherRegistryService';
import { MagicTokenService } from './magicTokenService';
import { MailService } from './mailService';

export class SelfDisableError extends Error {
  constructor(public readonly code: 'not_found' | 'confirm_mismatch') {
    super(code);
    this.name = 'SelfDisableError';
  }
}

export interface SelfDisableDeps {
  registry: PublisherRegistryService;
  magicTokens: MagicTokenService;
  mail: MailService;
}

export interface SelfDisableInput {
  publisherId: string;
  confirmSlug: string;
}

export interface SelfDisableResult {
  publisherId: string;
  slug: string;
  emailedTo: string;
}

// Steps:
//   1) Load the row. If it's gone, the caller has a stale session — 404.
//   2) Verify the typed confirmSlug matches publisher.id exactly.
//   3) Mutate the row: enabled=false, selfDisabledAt=now, tokenVersion+=1.
//      (See registry.setSelfDisabled — single atomic UpdateExpression.)
//   4) Drop any in-flight email-change pair so the disabled publisher can't
//      complete a verify/cancel after the fact.
//   5) Send confirmation email. Mail failure is logged, NOT raised — the
//      disable already happened in DDB and we don't want a flaky SES to
//      bubble up as a 500 (which the publisher would naturally retry,
//      pushing us through the rate limiter and confusing them about whether
//      the action took effect).
export async function selfDisable(
  input: SelfDisableInput,
  deps: SelfDisableDeps,
): Promise<SelfDisableResult> {
  const pub = await deps.registry.get(input.publisherId);
  if (!pub) throw new SelfDisableError('not_found');
  if (input.confirmSlug !== pub.id) {
    throw new SelfDisableError('confirm_mismatch');
  }

  // The registry helper guards against a row deleted between our get() above
  // and this write (very narrow race, but possible if an admin deletes the
  // row while the publisher is mid-confirm). Translate the typed not-found
  // error into the same SelfDisableError 'not_found' code so the handler
  // returns a clean 404 either way.
  try {
    await deps.registry.setSelfDisabled(input.publisherId);
  } catch (err) {
    if (err instanceof PublisherNotFoundError) {
      throw new SelfDisableError('not_found');
    }
    throw err;
  }
  await deps.magicTokens.deleteEmailChangePairByPublisher(input.publisherId);

  try {
    await deps.mail.sendSelfDisabledConfirmation({
      to: pub.contactEmail,
      slug: pub.id,
    });
  } catch (err) {
    // Best-effort: the publisher's row is already disabled. Logging the
    // failure gives ops a CloudWatch signal; the publisher just won't get
    // their confirmation email for this attempt.
    console.error(
      `[publisher-self-disable] mail send failed for publisher=${pub.id}:`,
      err,
    );
  }

  return {
    publisherId: pub.id,
    slug: pub.id,
    emailedTo: pub.contactEmail,
  };
}
