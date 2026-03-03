import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { handler as calendarHandler } from './handlers/calendarHandler';
import { handler as adminHandler } from './handlers/adminHandler';
import { APIGatewayProxyEvent, Context } from 'aws-lambda';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Helper function to convert Express request to Lambda event
const expressToLambdaEvent = (req: express.Request): APIGatewayProxyEvent => {
  return {
    httpMethod: req.method,
    path: req.path,
    pathParameters: req.params,
    queryStringParameters: req.query as { [key: string]: string },
    headers: req.headers as { [key: string]: string },
    body: req.body ? JSON.stringify(req.body) : null,
    isBase64Encoded: false,
    multiValueHeaders: {},
    multiValueQueryStringParameters: {},
    stageVariables: {},
    requestContext: {
      accountId: 'local',
      apiId: 'local',
      authorizer: null,
      protocol: 'HTTP/1.1',
      httpMethod: req.method,
      path: req.path,
      stage: 'local',
      requestId: Date.now().toString(),
      requestTime: new Date().toISOString(),
      requestTimeEpoch: Date.now(),
      resourceId: 'local',
      resourcePath: req.path,
      identity: {
        accessKey: null,
        accountId: null,
        apiKey: null,
        apiKeyId: null,
        caller: null,
        clientCert: null,
        cognitoAuthenticationProvider: null,
        cognitoAuthenticationType: null,
        cognitoIdentityId: null,
        cognitoIdentityPoolId: null,
        principalOrgId: null,
        sourceIp: req.ip,
        user: null,
        userAgent: req.get('User-Agent'),
        userArn: null,
      },
    },
    resource: req.path,
  };
};

const mockContext: Context = {
  callbackWaitsForEmptyEventLoop: false,
  functionName: 'local-dev',
  functionVersion: '1',
  invokedFunctionArn: 'local',
  memoryLimitInMB: '512',
  awsRequestId: 'local',
  logGroupName: 'local',
  logStreamName: 'local',
  getRemainingTimeInMillis: () => 30000,
  done: () => {},
  fail: () => {},
  succeed: () => {},
};

// Calendar API routes
app.post('/calendar', async (req, res) => {
  try {
    const event = expressToLambdaEvent(req);
    const result = await calendarHandler(event, mockContext);
    res.status(result.statusCode).json(JSON.parse(result.body));
  } catch (error) {
    console.error('Calendar API error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Feedback API routes (support both /feedback and /api/feedback for flexibility)
const handleFeedback = async (req: express.Request, res: express.Response) => {
  try {
    const event = expressToLambdaEvent(req);
    event.path = '/feedback';
    const result = await calendarHandler(event, mockContext);
    res.status(result.statusCode).json(JSON.parse(result.body));
  } catch (error) {
    console.error('Feedback API error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
app.post('/feedback', handleFeedback);
app.post('/api/feedback', handleFeedback);

// Admin OAuth routes
app.get('/auth/google', async (req, res) => {
  try {
    const event = expressToLambdaEvent(req);
    event.path = '/auth/google';
    const result = await adminHandler(event, mockContext);
    
    if (result.statusCode === 302 && result.headers?.Location) {
      res.redirect(String(result.headers.Location));
    } else {
      res.status(result.statusCode).json(JSON.parse(result.body));
    }
  } catch (error) {
    console.error('OAuth initiation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/auth/google/callback', async (req, res) => {
  try {
    const event = expressToLambdaEvent(req);
    event.path = '/auth/google/callback';
    const result = await adminHandler(event, mockContext);
    
    if (result.statusCode === 302 && result.headers?.Location) {
      res.redirect(String(result.headers.Location));
    } else {
      res.status(result.statusCode).json(JSON.parse(result.body));
    }
  } catch (error) {
    console.error('OAuth callback error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin API routes
app.get('/admin/api/feedback', async (req, res) => {
  try {
    const event = expressToLambdaEvent(req);
    event.path = '/feedback';
    const result = await adminHandler(event, mockContext);
    res.status(result.statusCode).json(JSON.parse(result.body));
  } catch (error) {
    console.error('Admin API error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.patch('/admin/api/feedback', async (req, res) => {
  try {
    const event = expressToLambdaEvent(req);
    event.path = '/feedback';
    const result = await adminHandler(event, mockContext);
    res.status(result.statusCode).json(JSON.parse(result.body));
  } catch (error) {
    console.error('Admin API error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/admin/api/feedback', async (req, res) => {
  try {
    const event = expressToLambdaEvent(req);
    event.path = '/feedback';
    const result = await adminHandler(event, mockContext);
    res.status(result.statusCode).json(JSON.parse(result.body));
  } catch (error) {
    console.error('Admin API error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.patch('/admin/api/feedback/bulk', async (req, res) => {
  try {
    const event = expressToLambdaEvent(req);
    event.path = '/feedback/bulk';
    const result = await adminHandler(event, mockContext);
    res.status(result.statusCode).json(JSON.parse(result.body));
  } catch (error) {
    console.error('Admin API error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Local development server running on http://localhost:${PORT}`);
  console.log(`📊 Calendar API: http://localhost:${PORT}/calendar`);
  console.log(`💬 Feedback API: http://localhost:${PORT}/feedback`);
  console.log(`🔐 Admin OAuth: http://localhost:${PORT}/auth/google`);
  console.log(`⚙️  Admin API: http://localhost:${PORT}/admin/api/feedback`);
  console.log(`❤️  Health: http://localhost:${PORT}/health`);
});

export default app;