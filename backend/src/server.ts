import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { handler as calendarHandler } from './handlers/calendarHandler';
import { handler as adminHandler } from './handlers/adminHandler';
import { APIGatewayProxyEvent, Context } from 'aws-lambda';

// Local dev convenience: this server file only ever runs under `npm run dev`,
// never in production (the prod admin Lambda invokes adminHandler directly,
// not through this Express wrapper). Auto-enable DEV_AUTH_BYPASS so admin
// pages work out of the box without requiring a real Google OAuth flow.
// adminHandler.ts double-gates on `!isProduction` (NODE_ENV !== 'production'
// AND ENVIRONMENT !== 'prod'), so even if this var leaked into a prod env
// the bypass would still be inert.
if (!process.env.DEV_AUTH_BYPASS) {
  process.env.DEV_AUTH_BYPASS = 'true';
  console.log('🔓 Local dev: DEV_AUTH_BYPASS=true (admin auth bypassed; set DEV_AUTH_BYPASS=false to override)');
}

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

// Single event ICS download
app.get('/calendar/events/:id', async (req, res) => {
  try {
    const event = expressToLambdaEvent(req);
    event.pathParameters = { id: req.params.id };
    const result = await calendarHandler(event, mockContext);
    const contentType = result.headers?.['Content-Type'] || '';
    if (typeof contentType === 'string' && contentType.includes('text/calendar')) {
      Object.entries(result.headers || {}).forEach(([k, v]) => res.set(k, String(v)));
      res.status(result.statusCode).send(result.body);
    } else {
      res.status(result.statusCode).json(JSON.parse(result.body));
    }
  } catch (error) {
    console.error('Calendar event ICS error:', error);
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

// Public publisher-portal API. Exposed at /api/publisher-test (no auth)
// so the prospective-publisher test page can call it without bumping into
// the admin auth middleware. Routes to the same adminHandler — the path
// `/publisher-test` is what the handler matches on.
app.post('/api/publisher-test', async (req, res) => {
  try {
    const event = expressToLambdaEvent(req);
    event.path = '/publisher-test';
    const result = await adminHandler(event, mockContext);
    // Forward Retry-After when present (used on 429 rate-limit responses).
    if (result.headers?.['Retry-After']) {
      res.set('Retry-After', String(result.headers['Retry-After']));
    }
    res.status(result.statusCode).json(result.body ? JSON.parse(result.body) : null);
  } catch (error) {
    console.error('Publisher-test API error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Phase B publisher-portal endpoints (apply + magic-link auth). Same
// pattern: forward to adminHandler with the raw path the handler expects.
const phaseBRoutes: Array<{ express: string; lambda: string }> = [
  { express: '/api/publisher-apply/request', lambda: '/publisher-apply/request' },
  { express: '/api/publisher-apply/verify',  lambda: '/publisher-apply/verify'  },
  { express: '/api/publisher-auth/request',  lambda: '/publisher-auth/request'  },
  { express: '/api/publisher-auth/verify',   lambda: '/publisher-auth/verify'   },
];
for (const { express, lambda } of phaseBRoutes) {
  app.post(express, async (req, res) => {
    try {
      const event = expressToLambdaEvent(req);
      event.path = lambda;
      const result = await adminHandler(event, mockContext);
      if (result.headers?.['Retry-After']) {
        res.set('Retry-After', String(result.headers['Retry-After']));
      }
      res.status(result.statusCode).json(result.body ? JSON.parse(result.body) : null);
    } catch (error) {
      console.error(`${express} error:`, error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
}

// Catch-all for everything else under /admin/api/* (e.g. publisher CRUD,
// publisher-events queue, publisher-halts management). Mirrors the {proxy+}
// resource added on the production admin API Gateway. The explicit /feedback
// routes above keep priority because Express matches in declaration order.
app.all('/admin/api/*', async (req, res) => {
  try {
    const event = expressToLambdaEvent(req);
    event.path = req.path.replace(/^\/admin\/api/, '') || '/';
    const result = await adminHandler(event, mockContext);
    res.status(result.statusCode).json(result.body ? JSON.parse(result.body) : null);
  } catch (error) {
    console.error('Admin API proxy error:', error);
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
  console.log(`🧪 Publisher test API: http://localhost:${PORT}/api/publisher-test`);
  console.log(`❤️  Health: http://localhost:${PORT}/health`);
});

export default app;