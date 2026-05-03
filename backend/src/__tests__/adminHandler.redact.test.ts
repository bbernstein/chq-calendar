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
  it('redacts Authorization, X-Auth-Token, Cookie, and Set-Cookie (case-insensitive)', () => {
    const event = baseEvent({
      headers: {
        Authorization: 'Bearer secret-jwt',
        'x-auth-token': 'another-secret',
        Cookie: 'session=abc',
        'set-cookie': 'session=xyz; HttpOnly',
        'Content-Type': 'application/json',
      },
    });

    const out = redactEventForLogging(event);

    expect(out.headers.Authorization).toBe('[REDACTED]');
    expect(out.headers['x-auth-token']).toBe('[REDACTED]');
    expect(out.headers.Cookie).toBe('[REDACTED]');
    expect(out.headers['set-cookie']).toBe('[REDACTED]');
    expect(out.headers['Content-Type']).toBe('application/json');
  });

  it('redacts multiValueHeaders while preserving the string[] shape', () => {
    const event = baseEvent({
      multiValueHeaders: {
        authorization: ['Bearer one', 'Bearer two'],
        'X-Request-Id': ['abc123'],
      },
    });

    const out = redactEventForLogging(event);

    // Stays a string[] so the redacted event still satisfies APIGatewayProxyEvent.
    expect(out.multiValueHeaders!.authorization).toEqual(['[REDACTED]']);
    expect(out.multiValueHeaders!['X-Request-Id']).toEqual(['abc123']);
  });

  it('does not mutate the input event', () => {
    const event = baseEvent({
      headers: { Authorization: 'Bearer keep-me' },
      multiValueHeaders: { authorization: ['Bearer keep-me'] },
    });

    redactEventForLogging(event);

    expect(event.headers.Authorization).toBe('Bearer keep-me');
    expect(event.multiValueHeaders!.authorization).toEqual(['Bearer keep-me']);
  });

  it('handles undefined or null headers gracefully', () => {
    const undefinedEvent = baseEvent({
      headers: undefined as unknown as APIGatewayProxyEvent['headers'],
      multiValueHeaders: undefined,
    });
    expect(() => redactEventForLogging(undefinedEvent)).not.toThrow();

    const nullEvent = baseEvent({
      headers: null as unknown as APIGatewayProxyEvent['headers'],
      multiValueHeaders: null as unknown as APIGatewayProxyEvent['multiValueHeaders'],
    });
    expect(() => redactEventForLogging(nullEvent)).not.toThrow();
  });
});
