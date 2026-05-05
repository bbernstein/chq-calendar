// Shared helpers for invoking the publisher-ingest Lambda from inside the
// admin Lambda's runtime. Two consumers today:
//   - adminHandler.ts /publishers/run-ingest      (admin "Run ingest now")
//   - publisherPortalHandler.ts /publisher-fetch-now (self-service refetch)
//
// Both invoke the same target Lambda with InvocationType=Event, but with
// different payloads (admin button → all-publishers; self-service → single
// publisher). Sharing the env-resolution + LambdaClient singleton here keeps
// the two paths consistent and avoids a second client on cold start.

import { LambdaClient } from '@aws-sdk/client-lambda';

let _lambdaClient: LambdaClient | null = null;

export function lambdaClient(): LambdaClient {
  if (!_lambdaClient) {
    _lambdaClient = new LambdaClient({ region: process.env.AWS_REGION || 'us-east-1' });
  }
  return _lambdaClient;
}

// Test-only: inject a fake LambdaClient (or a stub with a `send` method).
export function _setLambdaClientForTests(client: LambdaClient | null): void {
  _lambdaClient = client;
}

// In production the env var is wired by Terraform (see
// infrastructure/main.tf admin_handler.environment.PUBLISHER_INGEST_FUNCTION_NAME)
// and we fall back to the canonical name only as a defensive default. In
// local dev (Docker / `npm run dev`) the env var is unset and falling back
// to the prod name would cause the dev "Run ingest now" button to invoke
// the real production Lambda — surprising and potentially expensive. So:
//   - If the env var is set, use it (any environment).
//   - If unset and we look like we're running in real Lambda
//     (AWS_LAMBDA_FUNCTION_NAME is set), fall back to the canonical name.
//   - Otherwise (local dev), throw so the route returns 500 instead of
//     reaching across to production.
export class IngestFunctionNotConfiguredError extends Error {
  constructor() {
    super(
      'PUBLISHER_INGEST_FUNCTION_NAME is not set. Refusing to default to ' +
        'the production function name from outside an AWS Lambda runtime.',
    );
    this.name = 'IngestFunctionNotConfiguredError';
  }
}

export function publisherIngestFunctionName(): string {
  const fromEnv = process.env.PUBLISHER_INGEST_FUNCTION_NAME;
  if (fromEnv) return fromEnv;
  if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return 'chautauqua-calendar-publisher-ingest';
  }
  throw new IngestFunctionNotConfiguredError();
}
