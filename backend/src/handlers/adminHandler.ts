import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, PutCommand, GetCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import jwt from 'jsonwebtoken';
import { google } from 'googleapis';

// DynamoDB client
const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

// Environment variables
const FEEDBACK_TABLE_NAME = process.env.FEEDBACK_TABLE_NAME || 'chq-calendar-feedback';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const JWT_SECRET = process.env.NEXTAUTH_SECRET || 'your-secret-key';
const ADMIN_EMAIL_WHITELIST = process.env.ADMIN_EMAIL_WHITELIST;
const isProduction = process.env.NODE_ENV === 'production' || process.env.ENVIRONMENT === 'prod';
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
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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
  const authHeader = event.headers.Authorization || event.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

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
              'Location': `${FRONTEND_URL}/admin/login?error=oauth_error`,
            },
            body: '',
          };
        }

        if (!code) {
          return {
            statusCode: 302,
            headers: {
              'Location': `${FRONTEND_URL}/admin/login?error=no_code`,
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
              'Location': `${FRONTEND_URL}/admin/login?error=no_email`,
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
              'Location': `${FRONTEND_URL}/admin/login?error=unauthorized`,
            },
            body: '',
          };
        }

        // Generate JWT token
        const token = generateJWT({ email, name });

        // Redirect back to frontend with token
        const redirectUrl = `${FRONTEND_URL}/admin/login?token=${token}&user=${encodeURIComponent(JSON.stringify({ email, name }))}`;

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
            'Location': `${FRONTEND_URL}/admin/login?error=callback_error`,
          },
          body: '',
        };
      }
    }

    // All remaining endpoints require authentication
    const user = authenticateRequest(event);
    if (!user) {
      return createResponse(401, { error: 'Authentication required' });
    }

    // Admin feedback management endpoints
    if (path === '/admin/feedback') {
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
    if (httpMethod === 'PATCH' && path === '/admin/feedback/bulk') {
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
