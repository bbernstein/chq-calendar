import { APIGatewayProxyEvent } from 'aws-lambda';
import { redactEventForLogging } from '../handlers/adminHandler';

const baseEvent = (overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent => ({
  body: null,
  headers: {},
  multiValueHeaders: {},
  httpMethod: 'GET',
  isBase64Encoded: false,
  path: '/',
  pathParameters: null,
  queryStringParameters: null,
  multiValueQueryStringParameters: null,
  stageVariables: null,
  requestContext: {} as APIGatewayProxyEvent['requestContext'],
  resource: '/',
  ...overrides,
});

describe('redactEventForLogging', () => {
  it('redacts Authorization, X-Auth-Token, and Cookie headers (case-insensitive)', () => {
    const event = baseEvent({
      headers: {
        Authorization: 'Bearer secret-jwt',
        'x-auth-token': 'another-secret',
        Cookie: 'session=abc',
        'Content-Type': 'application/json',
      },
    });

    const out = redactEventForLogging(event);

    expect(out.headers.Authorization).toBe('[REDACTED]');
    expect(out.headers['x-auth-token']).toBe('[REDACTED]');
    expect(out.headers.Cookie).toBe('[REDACTED]');
    expect(out.headers['Content-Type']).toBe('application/json');
  });

  it('redacts multiValueHeaders the same way', () => {
    const event = baseEvent({
      multiValueHeaders: {
        authorization: ['Bearer one', 'Bearer two'],
        'X-Request-Id': ['abc123'],
      },
    });

    const out = redactEventForLogging(event);

    expect(out.multiValueHeaders!.authorization).toBe('[REDACTED]');
    expect(out.multiValueHeaders!['X-Request-Id']).toEqual(['abc123']);
  });

  it('does not mutate the input event', () => {
    const event = baseEvent({
      headers: { Authorization: 'Bearer keep-me' },
    });

    redactEventForLogging(event);

    expect(event.headers.Authorization).toBe('Bearer keep-me');
  });

  it('handles missing headers gracefully', () => {
    const event = baseEvent({ headers: undefined as unknown as APIGatewayProxyEvent['headers'] });
    expect(() => redactEventForLogging(event)).not.toThrow();
  });
});
