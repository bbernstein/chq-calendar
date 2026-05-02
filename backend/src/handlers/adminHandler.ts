import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, PutCommand, GetCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import jwt from 'jsonwebtoken';
import { google } from 'googleapis';
import { PublisherAdminService } from '../services/publisherAdminService';
import { PublisherRegistryService } from '../services/publisherRegistryService';
import { PublisherEventStore } from '../services/publisherEventStore';

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

// Lazy singleton for PublisherAdminService — one instance per Lambda warm container.
let _publisherAdmin: PublisherAdminService | null = null;
function publisherAdmin(): PublisherAdminService {
  if (!_publisherAdmin) {
    _publisherAdmin = new PublisherAdminService(
      new PublisherRegistryService(docClient, process.env.PUBLISHERS_TABLE_NAME ?? 'chq-publishers'),
      new PublisherEventStore(docClient, process.env.PUBLISHER_EVENTS_TABLE_NAME ?? 'chq-publisher-events'),
    );
  }
  return _publisherAdmin;
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
const ADMIN_EMAIL_WHITELIST = process.env.ADMIN_EMAIL_WHITELIST;
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
  console.log('Admin Lambda Event:', JSON.stringify(event, null, 2));
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
        state: Math.random().toString(36).substring(7) // Simple CSRF protection
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

    // All remaining endpoints require authentication, except in local development
    let user = authenticateRequest(event);
    console.log('Authentication result - user:', user);
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

    const matchPubPatch = path.match(/^\/publishers\/([^/]+)$/);
    if (matchPubPatch && httpMethod === 'PATCH') {
      try {
        const publisher = await publisherAdmin().updatePublisher(decodeURIComponent(matchPubPatch[1]), requestBody);
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
