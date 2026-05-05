import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { randomBytes } from 'crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, PutCommand, GetCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import jwt from 'jsonwebtoken';
import { google } from 'googleapis';
import { ApplicationStateError, PublisherAdminService } from '../services/publisherAdminService';
import { PublisherRegistryService } from '../services/publisherRegistryService';
import { PublisherEventStore } from '../services/publisherEventStore';
import { SesMailService } from '../services/mailService';
import {
  handlePublisherTest,
  handlePublisherApplyRequest,
  handlePublisherApplyVerify,
  handlePublisherAuthRequest,
  handlePublisherAuthVerify,
  handlePublisherStatus,
  handlePublisherProfilePatch,
  handlePublisherEmailChangeRequest,
  handlePublisherEmailChangeCancelSelf,
  handlePublisherEmailChangeVerify,
  handlePublisherEmailChangeCancelByOld,
} from './publisherPortalHandler';

// DynamoDB client
const dynamoClient = new DynamoDBClient({ 
  region: process.env.AWS_REGION || 'us-east-1',
  ...(process.env.DYNAMODB_ENDPOINT && {
    endpoint: process.env.DYNAMODB_ENDPOINT,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'dummy',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'dummy',
    },
  }),
});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

// Lambda client used to invoke the publisher-ingest function on demand from
// the admin "Run ingest now" button. Async (Event) invocation only — admin
// API Gateway has a 29s timeout and ingest runs can exceed that.
let _lambdaClient: LambdaClient | null = null;
function lambdaClient(): LambdaClient {
  if (!_lambdaClient) {
    _lambdaClient = new LambdaClient({ region: process.env.AWS_REGION || 'us-east-1' });
  }
  return _lambdaClient;
}

// Test-only: inject a fake LambdaClient (or a stub with a `send` method).
export function _setLambdaClientForTests(client: LambdaClient | null): void {
  _lambdaClient = client;
}

// Read per-call rather than caching at module load so tests can override the
// env var without re-importing the module.
//
// In production the env var is wired by Terraform (see infrastructure/main.tf
// admin_handler.environment.PUBLISHER_INGEST_FUNCTION_NAME) and we fall back
// to the canonical name only as a defensive default. In local dev (Docker /
// `npm run dev`) the env var is unset and falling back to the prod name would
// cause the dev "Run ingest now" button to invoke the real production Lambda
// — surprising and potentially expensive. So:
//   - If the env var is set, use it (any environment).
//   - If unset and we look like we're running in real Lambda
//     (AWS_LAMBDA_FUNCTION_NAME is set), fall back to the canonical name.
//   - Otherwise (local dev), throw so the route returns 500 instead of
//     reaching across to production.
class IngestFunctionNotConfiguredError extends Error {
  constructor() {
    super(
      'PUBLISHER_INGEST_FUNCTION_NAME is not set. Refusing to default to ' +
        'the production function name from outside an AWS Lambda runtime.',
    );
    this.name = 'IngestFunctionNotConfiguredError';
  }
}

function publisherIngestFunctionName(): string {
  const fromEnv = process.env.PUBLISHER_INGEST_FUNCTION_NAME;
  if (fromEnv) return fromEnv;
  if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return 'chautauqua-calendar-publisher-ingest';
  }
  throw new IngestFunctionNotConfiguredError();
}

// Lazy singleton for PublisherAdminService — one instance per Lambda warm container.
// Phase C: pass MailService + siteBaseUrl so approve/reject can notify publishers.
let _publisherAdmin: PublisherAdminService | null = null;
function publisherAdmin(): PublisherAdminService {
  if (!_publisherAdmin) {
    _publisherAdmin = new PublisherAdminService(
      new PublisherRegistryService(docClient, process.env.PUBLISHERS_TABLE_NAME ?? 'chautauqua-calendar-publishers'),
      new PublisherEventStore(docClient, process.env.PUBLISHER_EVENTS_TABLE_NAME ?? 'chautauqua-calendar-publisher-events'),
      {
        mail: new SesMailService(),
        siteBaseUrl: process.env.SITE_BASE_URL ?? 'https://www.chqcal.org',
      },
    );
  }
  return _publisherAdmin;
}

// Test-only: inject a fake PublisherAdminService so handler tests can drive
// the route layer without standing up DynamoDB/SES. Pass null to revert
// to the lazily-constructed real instance.
export function _setPublisherAdminForTests(svc: PublisherAdminService | null): void {
  _publisherAdmin = svc;
}

// Environment variables
const FEEDBACK_TABLE_NAME = process.env.FEEDBACK_TABLE_NAME || 'chautauqua-calendar-feedback';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const rawJwtSecret = process.env.JWT_SECRET;
const isProduction = process.env.NODE_ENV === 'production' || process.env.ENVIRONMENT === 'prod';

if (!rawJwtSecret && isProduction) {
  throw new Error('JWT secret is not configured. Please set JWT_SECRET in the production environment.');
}

const JWT_SECRET = rawJwtSecret || 'your-secret-key';
// Default to empty so missing-env doesn't crash isAuthorizedEmail with a
// TypeError. Empty whitelist correctly admits no one.
const ADMIN_EMAIL_WHITELIST = process.env.ADMIN_EMAIL_WHITELIST ?? '';
const FRONTEND_URL = isProduction ? 'https://www.chqcal.org' : 'http://localhost:3000';

// Google OAuth2 Client Setup
const oauth2Client = new google.auth.OAuth2(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  `${isProduction ? 'https://www.chqcal.org' : 'http://localhost:3001'}/auth/google/callback`
);

// Types
interface FeedbackRecord {
  id: string;
  feedback: string;
  contactInfo?: string;
  timestamp: number;
  userAgent?: string;
  ipAddress?: string;
  createdAt: string;
  archived?: boolean;
  archivedAt?: string;
}

// Header names whose values must never appear in logs.
// `set-cookie` is a response header and won't appear on inbound
// APIGatewayProxyEvents, but we include it defensively so the same set
// is safe to reuse if this helper ever runs on response objects.
const SENSITIVE_HEADER_NAMES = new Set([
  'authorization',
  'x-auth-token',
  'cookie',
  'set-cookie',
]);

const REDACTED = '[REDACTED]';

// Returns a shallow copy of `event` with sensitive header values replaced by
// '[REDACTED]'. Used before logging the event to CloudWatch so JWTs in
// `Authorization` / `X-Auth-Token` / cookies are not persisted in logs.
//
// `headers` values stay as strings; `multiValueHeaders` values stay as
// `string[]` (single-element `['[REDACTED]']`) so the returned event
// keeps the shape declared by APIGatewayProxyEvent.
export const redactEventForLogging = (event: APIGatewayProxyEvent): APIGatewayProxyEvent => {
  const redactString = (
    headers: APIGatewayProxyEvent['headers'] | null | undefined,
  ): APIGatewayProxyEvent['headers'] => {
    if (!headers) return headers as APIGatewayProxyEvent['headers'];
    const out: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(headers)) {
      out[key] = SENSITIVE_HEADER_NAMES.has(key.toLowerCase()) ? REDACTED : value;
    }
    return out;
  };

  const redactMulti = (
    headers: APIGatewayProxyEvent['multiValueHeaders'] | null | undefined,
  ): APIGatewayProxyEvent['multiValueHeaders'] => {
    if (!headers) return headers as APIGatewayProxyEvent['multiValueHeaders'];
    const out: Record<string, string[] | undefined> = {};
    for (const [key, value] of Object.entries(headers)) {
      out[key] = SENSITIVE_HEADER_NAMES.has(key.toLowerCase()) ? [REDACTED] : value;
    }
    return out;
  };

  return {
    ...event,
    headers: redactString(event.headers),
    multiValueHeaders: redactMulti(event.multiValueHeaders),
  };
};

// Helper function to create response
const createResponse = (statusCode: number, body: any): APIGatewayProxyResult => {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PATCH',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Auth-Token',
    },
    body: JSON.stringify(body),
  };
};

// Helper function to generate JWT token
const generateJWT = (user: { email: string; name: string }) => {
  return jwt.sign(user, JWT_SECRET, { expiresIn: '7d' });
};

// Helper function to verify JWT token
const verifyJWT = (token: string): { email: string; name: string } | null => {
  try {
    return jwt.verify(token, JWT_SECRET) as { email: string; name: string };
  } catch (error) {
    return null;
  }
};

// Helper function to check if email is authorized
const isAuthorizedEmail = (email: string): boolean => {
  if (!ADMIN_EMAIL_WHITELIST) return false;
  const whitelist = ADMIN_EMAIL_WHITELIST.split(',').map(e => e.trim());
  return whitelist.includes(email);
};

// Authentication middleware for Lambda
const authenticateRequest = (event: APIGatewayProxyEvent): { email: string; name: string } | null => {
  // Try Authorization header first (standard), then X-Auth-Token (workaround for API Gateway issue)
  const authHeader = event.headers.Authorization || event.headers.authorization;
  const customAuthHeader = event.headers['X-Auth-Token'] || event.headers['x-auth-token'];
  
  let token;
  if (authHeader) {
    token = authHeader.split(' ')[1]; // Bearer TOKEN
  } else if (customAuthHeader) {
    token = customAuthHeader; // Direct token
  }

  if (!token) {
    return null;
  }

  const user = verifyJWT(token);
  if (!user || !isAuthorizedEmail(user.email)) {
    return null;
  }

  return user;
};

export const handler = async (event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> => {
  console.log('Admin Lambda Event:', JSON.stringify(redactEventForLogging(event), null, 2));
  console.log('Environment check - NODE_ENV:', process.env.NODE_ENV, 'ENVIRONMENT:', process.env.ENVIRONMENT);
  console.log('isProduction:', isProduction);
  console.log('ADMIN_EMAIL_WHITELIST:', ADMIN_EMAIL_WHITELIST);

  try {
    const path = event.path;
    const httpMethod = event.httpMethod;

    // Handle CORS preflight requests
    if (httpMethod === 'OPTIONS') {
      return createResponse(200, {});
    }

    // Parse request body
    let requestBody: any = {};
    if (event.body) {
      try {
        requestBody = JSON.parse(event.body);
      } catch (error) {
        console.error('Error parsing request body:', error);
        return createResponse(400, { error: 'Invalid JSON in request body' });
      }
    }

    // OAuth endpoints
    if (path === '/auth/google') {
      if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
        return createResponse(500, { error: 'Google OAuth not configured' });
      }

      const scopes = [
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile'
      ];

      const url = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: scopes,
        // 128-bit cryptographically random CSRF state. Math.random() yields
        // ~20 bits of non-cryptographic entropy — trivially guessable.
        state: randomBytes(16).toString('hex'),
      });

      return {
        statusCode: 302,
        headers: {
          'Location': url,
          'Access-Control-Allow-Origin': '*',
        },
        body: '',
      };
    }

    if (path === '/auth/google/callback') {
      try {
        const { code, error } = event.queryStringParameters || {};

        if (error) {
          console.error('OAuth error:', error);
          return {
            statusCode: 302,
            headers: {
              'Location': `${FRONTEND_URL}/admin/login/?error=oauth_error`,
            },
            body: '',
          };
        }

        if (!code) {
          return {
            statusCode: 302,
            headers: {
              'Location': `${FRONTEND_URL}/admin/login/?error=no_code`,
            },
            body: '',
          };
        }

        // Exchange code for tokens
        const { tokens } = await oauth2Client.getToken(code as string);
        oauth2Client.setCredentials(tokens);

        // Get user info
        const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
        const userInfo = await oauth2.userinfo.get();

        const email = userInfo.data.email;
        const name = userInfo.data.name || email;

        if (!email) {
          return {
            statusCode: 302,
            headers: {
              'Location': `${FRONTEND_URL}/admin/login/?error=no_email`,
            },
            body: '',
          };
        }

        // Check if user is authorized
        if (!isAuthorizedEmail(email)) {
          console.log(`Unauthorized login attempt from: ${email}`);
          return {
            statusCode: 302,
            headers: {
              'Location': `${FRONTEND_URL}/admin/login/?error=unauthorized`,
            },
            body: '',
          };
        }

        // Generate JWT token
        const token = generateJWT({ email, name });

        // Redirect back to frontend with token in hash to prevent loss during redirects
        const userData = encodeURIComponent(JSON.stringify({ email, name, token }));
        const redirectUrl = `${FRONTEND_URL}/admin/login/#auth=${userData}`;

        return {
          statusCode: 302,
          headers: {
            'Location': redirectUrl,
          },
          body: '',
        };

      } catch (error) {
        console.error('OAuth callback error:', error);
        return {
          statusCode: 302,
          headers: {
            'Location': `${FRONTEND_URL}/admin/login/?error=callback_error`,
          },
          body: '',
        };
      }
    }

    // ─── Public (un-authenticated) publisher portal endpoints ─────────────
    //
    // Routing decision (Phase A, Option X from the design plan): we host
    // `/publisher-test` inside adminHandler.ts rather than spinning up a
    // separate Lambda + Terraform plumbing for it. The actual handler logic
    // lives in `publisherPortalHandler.ts`; we delegate to it here.
    //
    // The single trade-off — adminHandler is no longer 100% admin-only — is
    // acceptable for Phase A. Phase D can wire publisherPortalHandler.ts up
    // as its own Lambda Function URL with no further refactoring.
    //
    // Auth: this endpoint is intentionally OPEN. Prospective publishers need
    // to iterate on their feed before they're registered. Abuse mitigation
    // is the URL guard (services/urlGuard.ts) and the in-memory rate
    // limiter inside publisherPortalHandler.ts.
    if (path === '/publisher-test' && httpMethod === 'POST') {
      return await handlePublisherTest(event, requestBody);
    }

    // Phase B: publisher portal apply + magic-link auth flow. All open
    // (no admin auth). Each handler enforces its own per-IP rate limit.
    if (path === '/publisher-apply/request' && httpMethod === 'POST') {
      return await handlePublisherApplyRequest(event, requestBody);
    }
    if (path === '/publisher-apply/verify' && httpMethod === 'POST') {
      return await handlePublisherApplyVerify(event, requestBody);
    }
    if (path === '/publisher-auth/request' && httpMethod === 'POST') {
      return await handlePublisherAuthRequest(event, requestBody);
    }
    if (path === '/publisher-auth/verify' && httpMethod === 'POST') {
      return await handlePublisherAuthVerify(event, requestBody);
    }

    // Phase C: publisher-facing status endpoint. JWT-protected with the
    // publisher JWT (NOT the admin JWT) — auth check lives inside the
    // handler, so it sits BEFORE the admin auth gate below.
    if (path === '/publisher-status' && httpMethod === 'GET') {
      return await handlePublisherStatus(event, requestBody);
    }

    // Phase 2 (publisher self-service): publisher edits their own profile
    // (name, organization, sourceUrl, sourceType). Same publisher-JWT auth
    // model as /publisher-status — the handler enforces it itself, so this
    // also sits BEFORE the admin auth gate.
    if (path === '/publisher-profile' && httpMethod === 'PATCH') {
      return await handlePublisherProfilePatch(event, requestBody);
    }

    // Phase 4 (publisher self-service email change): two authenticated
    // routes (POST initiate / DELETE cancel-by-self) and two public,
    // token-clickable routes (GET verify / GET cancel). All four sit
    // BEFORE the admin auth gate — the public ones because they're
    // intentionally unauthenticated, the authenticated ones because they
    // use the publisher JWT, not the admin JWT.
    if (path === '/publisher-email-change' && httpMethod === 'POST') {
      return await handlePublisherEmailChangeRequest(event, requestBody);
    }
    if (path === '/publisher-email-change' && httpMethod === 'DELETE') {
      return await handlePublisherEmailChangeCancelSelf(event, requestBody);
    }
    if (path === '/publisher-email-change/verify' && httpMethod === 'GET') {
      return await handlePublisherEmailChangeVerify(event, requestBody);
    }
    if (path === '/publisher-email-change/cancel' && httpMethod === 'GET') {
      return await handlePublisherEmailChangeCancelByOld(event, requestBody);
    }

    // All remaining endpoints require authentication, except in local development
    let user = authenticateRequest(event);
    console.log('Authentication result:', user ? `authenticated as "${user.name}"` : 'unauthenticated');
    console.log('Request path:', path);
    
    // In local development, bypass authentication and use dummy user.
    // Requires explicit opt-in via DEV_AUTH_BYPASS=true to prevent accidental bypass in staging.
    const isDevelopment = !isProduction && process.env.DEV_AUTH_BYPASS === 'true';
    if (!user && isDevelopment) {
      console.log('Local development mode: bypassing authentication with dummy user');
      user = { email: 'dev@localhost.local', name: 'Local Dev User' };
    }
    
    if (!user) {
      return createResponse(401, { error: 'Authentication required' });
    }

    // Trigger an immediate publisher-ingest run. Async invocation: API
    // Gateway times out at 29s and the ingest may take minutes for many
    // publishers, so we fire-and-forget and let the UI poll the publishers
    // list to observe updated lastFetchedAt timestamps.
    if (path === '/publishers/run-ingest' && httpMethod === 'POST') {
      try {
        const triggeredAt = new Date().toISOString();
        await lambdaClient().send(new InvokeCommand({
          FunctionName: publisherIngestFunctionName(),
          InvocationType: 'Event',
          Payload: Buffer.from(JSON.stringify({ source: 'admin-ui', triggeredBy: user.email, triggeredAt })),
        }));
        return createResponse(202, { triggeredAt });
      } catch (error) {
        console.error('Error triggering publisher ingest:', error);
        const message = error instanceof Error ? error.message : 'unknown error';
        return createResponse(500, { error: `Failed to trigger publisher ingest: ${message}` });
      }
    }

    // Publisher CRUD endpoints
    if (path === '/publishers' && httpMethod === 'GET') {
      try {
        const publishers = await publisherAdmin().listPublishers();
        return createResponse(200, { publishers });
      } catch (error) {
        console.error('Error listing publishers:', error);
        return createResponse(500, { error: 'Failed to list publishers' });
      }
    }

    if (path === '/publishers' && httpMethod === 'POST') {
      try {
        const publisher = await publisherAdmin().createPublisher(requestBody);
        return createResponse(201, { publisher });
      } catch (error) {
        console.error('Error creating publisher:', error);
        const message = error instanceof Error ? error.message : '';
        if (message.startsWith('publisher already exists')) {
          return createResponse(409, { error: message });
        }
        return createResponse(500, { error: 'Failed to create publisher' });
      }
    }

    // Phase C: pending application review (admin-only).
    if (path === '/publisher-applications/pending' && httpMethod === 'GET') {
      try {
        const applications = await publisherAdmin().listPendingApplications();
        return createResponse(200, { applications });
      } catch (error) {
        console.error('Error listing pending applications:', error);
        return createResponse(500, { error: 'Failed to list pending applications' });
      }
    }

    const matchAppApprove = path.match(/^\/publisher-applications\/([^/]+)\/approve$/);
    if (matchAppApprove && httpMethod === 'POST') {
      try {
        const publisher = await publisherAdmin().approveApplication(
          decodeURIComponent(matchAppApprove[1]),
          user.email,
        );
        return createResponse(200, { publisher });
      } catch (error) {
        if (error instanceof ApplicationStateError) {
          return createResponse(409, { error: error.message, currentStatus: error.currentStatus });
        }
        const message = error instanceof Error ? error.message : '';
        if (message.startsWith('unknown publisher')) {
          return createResponse(404, { error: message });
        }
        console.error('Error approving application:', error);
        return createResponse(500, { error: 'Failed to approve application' });
      }
    }

    const matchAppReject = path.match(/^\/publisher-applications\/([^/]+)\/reject$/);
    if (matchAppReject && httpMethod === 'POST') {
      try {
        const reason = typeof requestBody?.reason === 'string' ? requestBody.reason : undefined;
        const publisher = await publisherAdmin().rejectApplication(
          decodeURIComponent(matchAppReject[1]),
          user.email,
          reason,
        );
        return createResponse(200, { publisher });
      } catch (error) {
        if (error instanceof ApplicationStateError) {
          return createResponse(409, { error: error.message, currentStatus: error.currentStatus });
        }
        const message = error instanceof Error ? error.message : '';
        if (message.startsWith('unknown publisher')) {
          return createResponse(404, { error: message });
        }
        console.error('Error rejecting application:', error);
        return createResponse(500, { error: 'Failed to reject application' });
      }
    }

    // Matches both PATCH and DELETE routes for a single publisher by id.
    // The regex is intentionally narrow — sub-paths like /publishers/run-ingest
    // are handled above this block, so they can't fall through here.
    const matchPubId = path.match(/^\/publishers\/([^/]+)$/);
    if (matchPubId && httpMethod === 'PATCH') {
      try {
        const publisher = await publisherAdmin().updatePublisher(decodeURIComponent(matchPubId[1]), requestBody);
        return createResponse(200, { publisher });
      } catch (error) {
        console.error('Error updating publisher:', error);
        const message = error instanceof Error ? error.message : '';
        if (message.startsWith('unknown publisher')) {
          return createResponse(404, { error: message });
        }
        return createResponse(500, { error: 'Failed to update publisher' });
      }
    }

    if (matchPubId && httpMethod === 'DELETE') {
      try {
        const result = await publisherAdmin().deletePublisher(decodeURIComponent(matchPubId[1]));
        return createResponse(200, result);
      } catch (error) {
        console.error('Error deleting publisher:', error);
        const message = error instanceof Error ? error.message : '';
        if (message.startsWith('unknown publisher')) {
          return createResponse(404, { error: message });
        }
        return createResponse(500, { error: 'Failed to delete publisher' });
      }
    }

    // Publisher pending events queue
    if (path === '/publisher-events/pending' && httpMethod === 'GET') {
      try {
        const events = await publisherAdmin().listPendingEvents();
        return createResponse(200, { events });
      } catch (error) {
        console.error('Error listing pending publisher events:', error);
        return createResponse(500, { error: 'Failed to list pending events' });
      }
    }

    const matchApprove = path.match(/^\/publisher-events\/([^/]+)\/([^/]+)\/approve$/);
    if (matchApprove && httpMethod === 'POST') {
      try {
        await publisherAdmin().approveEvent(decodeURIComponent(matchApprove[1]), decodeURIComponent(matchApprove[2]));
        return createResponse(204, {});
      } catch (error) {
        console.error('Error approving publisher event:', error);
        const message = error instanceof Error ? error.message : '';
        if (message.startsWith('cannot approve')) {
          return createResponse(409, { error: message });
        }
        return createResponse(500, { error: 'Failed to approve event' });
      }
    }

    const matchReject = path.match(/^\/publisher-events\/([^/]+)\/([^/]+)\/reject$/);
    if (matchReject && httpMethod === 'POST') {
      try {
        await publisherAdmin().rejectEvent(decodeURIComponent(matchReject[1]), decodeURIComponent(matchReject[2]));
        return createResponse(204, {});
      } catch (error) {
        console.error('Error rejecting publisher event:', error);
        return createResponse(500, { error: 'Failed to reject event' });
      }
    }

    // Publisher threshold-halt management
    if (path === '/publisher-halts' && httpMethod === 'GET') {
      try {
        const halts = await publisherAdmin().listThresholdHalts();
        return createResponse(200, { halts });
      } catch (error) {
        console.error('Error listing publisher halts:', error);
        return createResponse(500, { error: 'Failed to list publisher halts' });
      }
    }

    const matchHaltApprove = path.match(/^\/publisher-halts\/([^/]+)\/approve$/);
    if (matchHaltApprove && httpMethod === 'POST') {
      try {
        await publisherAdmin().approveThresholdHalt(decodeURIComponent(matchHaltApprove[1]));
        return createResponse(200, {});
      } catch (error) {
        console.error('Error approving threshold halt:', error);
        return createResponse(500, { error: 'Failed to approve threshold halt' });
      }
    }

    const matchHaltCancel = path.match(/^\/publisher-halts\/([^/]+)\/cancel$/);
    if (matchHaltCancel && httpMethod === 'POST') {
      try {
        await publisherAdmin().cancelThresholdHalt(decodeURIComponent(matchHaltCancel[1]));
        return createResponse(200, {});
      } catch (error) {
        console.error('Error cancelling threshold halt:', error);
        return createResponse(500, { error: 'Failed to cancel threshold halt' });
      }
    }

    // Admin feedback management endpoints
    if (path === '/feedback' || path === '/feedback/') {
      if (httpMethod === 'GET') {
        // List all feedback
        try {
          const result = await docClient.send(new ScanCommand({
            TableName: FEEDBACK_TABLE_NAME
          }));

          const feedbacks = (result.Items || []).map((item: any) => ({
            ...item,
            createdAt: new Date(item.timestamp).toISOString()
          })).sort((a: any, b: any) => b.timestamp - a.timestamp);

          return createResponse(200, { feedbacks });
        } catch (error) {
          console.error('Error fetching feedback:', error);
          return createResponse(500, { error: 'Failed to fetch feedback' });
        }
      }

      if (httpMethod === 'PATCH') {
        // Update feedback (archive/unarchive)
        const { id, archived } = requestBody as { id: string; archived: boolean };

        if (!id) {
          return createResponse(400, { error: 'Feedback ID is required' });
        }

        try {
          // Get the existing feedback record first
          const getResult = await docClient.send(new GetCommand({
            TableName: FEEDBACK_TABLE_NAME,
            Key: { id: id }
          }));

          if (!getResult.Item) {
            return createResponse(404, { error: 'Feedback not found' });
          }

          const updateData: any = {
            ...getResult.Item,
            archived: archived,
          };

          if (archived) {
            updateData.archivedAt = new Date().toISOString();
          } else {
            delete updateData.archivedAt;
          }

          await docClient.send(new PutCommand({
            TableName: FEEDBACK_TABLE_NAME,
            Item: updateData
          }));

          return createResponse(200, {
            message: `Feedback ${archived ? 'archived' : 'unarchived'} successfully`,
            id: id
          });
        } catch (error) {
          console.error('Error updating feedback:', error);
          return createResponse(500, { error: 'Failed to update feedback' });
        }
      }

      if (httpMethod === 'DELETE') {
        // Delete feedback
        const { id } = requestBody as { id: string };

        if (!id) {
          return createResponse(400, { error: 'Feedback ID is required' });
        }

        try {
          await docClient.send(new DeleteCommand({
            TableName: FEEDBACK_TABLE_NAME,
            Key: { id: id }
          }));

          return createResponse(200, {
            message: 'Feedback deleted successfully',
            id: id
          });
        } catch (error) {
          console.error('Error deleting feedback:', error);
          return createResponse(500, { error: 'Failed to delete feedback' });
        }
      }
    }

    // Bulk feedback operations
    if (httpMethod === 'PATCH' && (path === '/feedback/bulk' || path === '/feedback/bulk/')) {
      const { ids, action, archived } = requestBody as {
        ids: string[];
        action: 'archive' | 'delete';
        archived?: boolean;
      };

      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return createResponse(400, { error: 'Feedback IDs array is required' });
      }

      const results = [];

      for (const id of ids) {
        try {
          if (action === 'delete') {
            await docClient.send(new DeleteCommand({
              TableName: FEEDBACK_TABLE_NAME,
              Key: { id: id }
            }));
            results.push({ id, action: 'deleted', success: true });
          } else if (action === 'archive') {
            // Get the existing feedback record first
            const getResult = await docClient.send(new GetCommand({
              TableName: FEEDBACK_TABLE_NAME,
              Key: { id: id }
            }));

            if (getResult.Item) {
              const updateData: any = {
                ...getResult.Item,
                archived: archived !== undefined ? archived : true,
              };

              if (updateData.archived) {
                updateData.archivedAt = new Date().toISOString();
              } else {
                delete updateData.archivedAt;
              }

              await docClient.send(new PutCommand({
                TableName: FEEDBACK_TABLE_NAME,
                Item: updateData
              }));
              results.push({ id, action: archived ? 'archived' : 'unarchived', success: true });
            } else {
              results.push({ id, action: 'not_found', success: false });
            }
          }
        } catch (error) {
          console.error(`Error processing ${action} for feedback ${id}:`, error);
          results.push({ id, action: 'error', success: false, error: (error as Error).message });
        }
      }

      return createResponse(200, {
        message: `Bulk ${action} completed`,
        results: results
      });
    }

    // Method not allowed
    return createResponse(405, { error: 'Method not allowed' });

  } catch (error) {
    console.error('Error in admin handler:', error);
    return createResponse(500, {
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};
