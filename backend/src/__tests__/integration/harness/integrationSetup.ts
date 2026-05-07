// Test-environment shim: every integration test file imports this BEFORE any
// production module to guarantee env vars are set in time. Production
// adminHandler.ts captures JWT_SECRET / ADMIN_EMAIL_WHITELIST / etc. at
// module load, so the env must be in place before that load.
//
// This file also unmocks @aws-sdk/lib-dynamodb / client-dynamodb (overriding
// setup.ts's global mock) so our InMemoryDocClient works at all and so
// production services can construct the SDK class hierarchy without
// crashing on undefined config.

process.env.AWS_REGION = process.env.AWS_REGION ?? 'us-east-1';
process.env.JWT_SECRET = 'test-admin-jwt-secret';
process.env.ADMIN_EMAIL_WHITELIST = 'admin@test.chqcal.local';
process.env.SES_FROM_ADDRESS = 'test@chqcal.local';
process.env.SITE_BASE_URL = 'https://test.chqcal.local';
process.env.PUBLISHER_INGEST_FUNCTION_NAME = 'test-publisher-ingest';
delete process.env.PUBLISHER_RATE_LIMIT_TABLE_NAME;

jest.unmock('@aws-sdk/lib-dynamodb');
jest.unmock('@aws-sdk/client-dynamodb');
