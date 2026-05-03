// Lazily fetch and cache the publisher JWT signing secret from AWS Secrets
// Manager. Cache scope: per-Lambda-warm-container — cold starts re-fetch
// (~50ms penalty), warm calls are free.
//
// Rotation: when the secret value changes in Secrets Manager, existing warm
// containers will keep using the old value until they recycle. This is
// acceptable because (a) JWT signing keys are not rotated frequently, and
// (b) Lambda containers recycle within minutes-to-hours of inactivity.
// If hot-rotation becomes important, add a TTL on the cached value.

import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

let _client: SecretsManagerClient | null = null;
let _cachedSecret: string | null = null;
let _inFlight: Promise<string> | null = null;

function client(): SecretsManagerClient {
  if (!_client) {
    _client = new SecretsManagerClient({});
  }
  return _client;
}

export async function getPublisherJwtSecret(): Promise<string> {
  if (_cachedSecret !== null) return _cachedSecret;

  // Coalesce concurrent first-callers so cold start makes one API call.
  if (_inFlight) return _inFlight;

  const arn = process.env.PUBLISHER_JWT_SECRET_ARN;
  if (!arn) {
    throw new Error('PUBLISHER_JWT_SECRET_ARN env var not set');
  }

  _inFlight = (async () => {
    try {
      const resp = await client().send(new GetSecretValueCommand({ SecretId: arn }));
      const value = resp.SecretString;
      if (!value) {
        throw new Error('publisher JWT secret has no SecretString value');
      }
      _cachedSecret = value;
      return value;
    } finally {
      _inFlight = null;
    }
  })();

  return _inFlight;
}

// Test-only: clear the cache between cases.
export function _resetPublisherSecretCacheForTests(): void {
  _cachedSecret = null;
  _inFlight = null;
  _client = null;
}
