import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';

// Create simple mock functions with proper types
const mockCalendarHandler = jest.fn() as any;
const mockAdminHandler = jest.fn() as any;

// Mock the handlers
jest.mock('../handlers/calendarHandler', () => ({
  handler: mockCalendarHandler
}));

jest.mock('../handlers/adminHandler', () => ({
  handler: mockAdminHandler
}));

// Mock dotenv/config (auto-loads env vars on import)
jest.mock('dotenv/config', () => ({}));

describe('Server', () => {
  let app: express.Application;
  let consoleSpy: any;

  beforeAll(async () => {
    // Mock console to suppress server startup logs
    jest.spyOn(console, 'log').mockImplementation(() => {});
    
    // Mock the listen method to prevent actual server startup
    const originalListen = express.application.listen;
    express.application.listen = function(this: any, ...args: any[]) {
      // Don't actually start the server
      return {
        close: jest.fn()
      } as any;
    };

    // Import server after mocking
    const serverModule = await import('../server');
    app = serverModule.default;

    // Restore listen method
    express.application.listen = originalListen;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock console methods
    consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe('POST /calendar', () => {
    it('should handle calendar API requests successfully', async () => {
      const mockResponse = {
        statusCode: 200,
        body: JSON.stringify({ events: [], metadata: { totalEvents: 0 } })
      };

      mockCalendarHandler.mockResolvedValue(mockResponse);

      const response = await request(app)
        .post('/calendar')
        .send({ filters: { categories: ['music'] } });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ events: [], metadata: { totalEvents: 0 } });
      expect(mockCalendarHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          httpMethod: 'POST',
          path: '/calendar',
          body: JSON.stringify({ filters: { categories: ['music'] } })
        }),
        expect.objectContaining({
          functionName: 'local-dev',
          awsRequestId: 'local'
        })
      );
    });

    it('should handle calendar API errors gracefully', async () => {
      mockCalendarHandler.mockRejectedValue(new Error('Calendar handler error'));

      const response = await request(app)
        .post('/calendar')
        .send({ filters: {} });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Internal server error' });
      expect(console.error).toHaveBeenCalledWith('Calendar API error:', expect.any(Error));
    });

    it('should handle calendar responses with different status codes', async () => {
      const mockResponse = {
        statusCode: 400,
        body: JSON.stringify({ error: 'Bad request' })
      };

      mockCalendarHandler.mockResolvedValue(mockResponse);

      const response = await request(app)
        .post('/calendar')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Bad request' });
    });
  });

  describe('POST /feedback', () => {
    it('should handle feedback API requests successfully', async () => {
      const mockResponse = {
        statusCode: 201,
        body: JSON.stringify({ message: 'Feedback submitted successfully', id: 'feedback-123' })
      };

      mockCalendarHandler.mockResolvedValue(mockResponse);

      const response = await request(app)
        .post('/feedback')
        .send({ 
          feedback: 'Great calendar!', 
          contactInfo: 'user@example.com',
          captchaToken: 'valid-token'
        });

      expect(response.status).toBe(201);
      expect(response.body).toEqual({ message: 'Feedback submitted successfully', id: 'feedback-123' });
      expect(mockCalendarHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          httpMethod: 'POST',
          path: '/feedback',
          body: JSON.stringify({ 
            feedback: 'Great calendar!', 
            contactInfo: 'user@example.com',
            captchaToken: 'valid-token'
          })
        }),
        expect.any(Object)
      );
    });

    it('should handle feedback API errors gracefully', async () => {
      mockCalendarHandler.mockRejectedValue(new Error('Feedback handler error'));

      const response = await request(app)
        .post('/feedback')
        .send({ feedback: 'Test feedback' });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Internal server error' });
      expect(console.error).toHaveBeenCalledWith('Feedback API error:', expect.any(Error));
    });
  });

  describe('GET /auth/google', () => {
    it('should handle OAuth initiation with redirect response', async () => {
      const mockResponse = {
        statusCode: 302,
        headers: { Location: 'https://accounts.google.com/oauth/authorize?...' },
        body: JSON.stringify({})
      };

      mockAdminHandler.mockResolvedValue(mockResponse);

      const response = await request(app)
        .get('/auth/google');

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('https://accounts.google.com/oauth/authorize?...');
      expect(mockAdminHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          httpMethod: 'GET',
          path: '/auth/google'
        }),
        expect.any(Object)
      );
    });

    it('should handle OAuth initiation with JSON response', async () => {
      const mockResponse = {
        statusCode: 400,
        body: JSON.stringify({ error: 'OAuth configuration error' })
      };

      mockAdminHandler.mockResolvedValue(mockResponse);

      const response = await request(app)
        .get('/auth/google');

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'OAuth configuration error' });
    });

    it('should handle OAuth initiation errors gracefully', async () => {
      mockAdminHandler.mockRejectedValue(new Error('OAuth handler error'));

      const response = await request(app)
        .get('/auth/google');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Internal server error' });
      expect(console.error).toHaveBeenCalledWith('OAuth initiation error:', expect.any(Error));
    });
  });

  describe('GET /auth/google/callback', () => {
    it('should handle OAuth callback with redirect response', async () => {
      const mockResponse = {
        statusCode: 302,
        headers: { Location: '/admin?auth=success' },
        body: JSON.stringify({})
      };

      mockAdminHandler.mockResolvedValue(mockResponse);

      const response = await request(app)
        .get('/auth/google/callback')
        .query({ code: 'auth-code', state: 'state-token' });

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/admin?auth=success');
      expect(mockAdminHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          httpMethod: 'GET',
          path: '/auth/google/callback'
        }),
        expect.any(Object)
      );
    });

    it('should handle OAuth callback with JSON response', async () => {
      const mockResponse = {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid authorization code' })
      };

      mockAdminHandler.mockResolvedValue(mockResponse);

      const response = await request(app)
        .get('/auth/google/callback')
        .query({ error: 'access_denied' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Invalid authorization code' });
    });

    it('should handle OAuth callback errors gracefully', async () => {
      mockAdminHandler.mockRejectedValue(new Error('OAuth callback error'));

      const response = await request(app)
        .get('/auth/google/callback');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Internal server error' });
      expect(console.error).toHaveBeenCalledWith('OAuth callback error:', expect.any(Error));
    });
  });

  describe('Admin API routes', () => {
    describe('GET /admin/api/feedback', () => {
      it('should handle admin feedback GET requests successfully', async () => {
        const mockResponse = {
          statusCode: 200,
          body: JSON.stringify({ 
            feedback: [
              { id: '1', feedback: 'Test feedback', timestamp: Date.now() }
            ],
            total: 1 
          })
        };

        mockAdminHandler.mockResolvedValue(mockResponse);

        const response = await request(app)
          .get('/admin/api/feedback')
          .query({ limit: '10', offset: '0' });

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('feedback');
        expect(mockAdminHandler).toHaveBeenCalledWith(
          expect.objectContaining({
            httpMethod: 'GET',
            path: '/feedback'
          }),
          expect.any(Object)
        );
      });

      it('should handle admin feedback GET errors gracefully', async () => {
        mockAdminHandler.mockRejectedValue(new Error('Admin handler error'));

        const response = await request(app)
          .get('/admin/api/feedback');

        expect(response.status).toBe(500);
        expect(response.body).toEqual({ error: 'Internal server error' });
        expect(console.error).toHaveBeenCalledWith('Admin API error:', expect.any(Error));
      });
    });

    describe('PATCH /admin/api/feedback', () => {
      it('should handle admin feedback PATCH requests successfully', async () => {
        const mockResponse = {
          statusCode: 200,
          body: JSON.stringify({ message: 'Feedback updated successfully' })
        };

        mockAdminHandler.mockResolvedValue(mockResponse);

        const response = await request(app)
          .patch('/admin/api/feedback')
          .send({ id: 'feedback-123', archived: true });

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ message: 'Feedback updated successfully' });
        expect(mockAdminHandler).toHaveBeenCalledWith(
          expect.objectContaining({
            httpMethod: 'PATCH',
            path: '/feedback'
          }),
          expect.any(Object)
        );
      });

      it('should handle admin feedback PATCH errors gracefully', async () => {
        mockAdminHandler.mockRejectedValue(new Error('Update failed'));

        const response = await request(app)
          .patch('/admin/api/feedback')
          .send({ id: 'invalid' });

        expect(response.status).toBe(500);
        expect(response.body).toEqual({ error: 'Internal server error' });
      });
    });

    describe('DELETE /admin/api/feedback', () => {
      it('should handle admin feedback DELETE requests successfully', async () => {
        const mockResponse = {
          statusCode: 204,
          body: JSON.stringify({})
        };

        mockAdminHandler.mockResolvedValue(mockResponse);

        const response = await request(app)
          .delete('/admin/api/feedback')
          .send({ id: 'feedback-123' });

        expect(response.status).toBe(204);
        expect(mockAdminHandler).toHaveBeenCalledWith(
          expect.objectContaining({
            httpMethod: 'DELETE',
            path: '/feedback'
          }),
          expect.any(Object)
        );
      });

      it('should handle admin feedback DELETE errors gracefully', async () => {
        mockAdminHandler.mockRejectedValue(new Error('Delete failed'));

        const response = await request(app)
          .delete('/admin/api/feedback')
          .send({ id: 'invalid' });

        expect(response.status).toBe(500);
        expect(response.body).toEqual({ error: 'Internal server error' });
      });
    });

    describe('PATCH /admin/api/feedback/bulk', () => {
      it('should handle admin feedback bulk PATCH requests successfully', async () => {
        const mockResponse = {
          statusCode: 200,
          body: JSON.stringify({ message: 'Bulk update completed', updated: 5 })
        };

        mockAdminHandler.mockResolvedValue(mockResponse);

        const response = await request(app)
          .patch('/admin/api/feedback/bulk')
          .send({ 
            ids: ['feedback-1', 'feedback-2', 'feedback-3'], 
            archived: true 
          });

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ message: 'Bulk update completed', updated: 5 });
        expect(mockAdminHandler).toHaveBeenCalledWith(
          expect.objectContaining({
            httpMethod: 'PATCH',
            path: '/feedback/bulk'
          }),
          expect.any(Object)
        );
      });

      it('should handle admin feedback bulk PATCH errors gracefully', async () => {
        mockAdminHandler.mockRejectedValue(new Error('Bulk update failed'));

        const response = await request(app)
          .patch('/admin/api/feedback/bulk')
          .send({ ids: [] });

        expect(response.status).toBe(500);
        expect(response.body).toEqual({ error: 'Internal server error' });
      });
    });
  });

  describe('GET /health', () => {
    it('should return health check response', async () => {
      const response = await request(app)
        .get('/health');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'ok');
      expect(response.body).toHaveProperty('timestamp');
      expect(new Date(response.body.timestamp)).toBeInstanceOf(Date);
    });
  });

  describe('expressToLambdaEvent helper function', () => {
    it('should convert Express request to Lambda event format', async () => {
      const mockResponse = {
        statusCode: 200,
        body: JSON.stringify({ test: 'success' })
      };

      mockCalendarHandler.mockResolvedValue(mockResponse);

      await request(app)
        .post('/calendar')
        .set('User-Agent', 'test-agent')
        .set('Authorization', 'Bearer token')
        .query({ test: 'param' })
        .send({ data: 'test' });

      expect(mockCalendarHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          httpMethod: 'POST',
          path: '/calendar',
          pathParameters: expect.any(Object),
          queryStringParameters: expect.objectContaining({ test: 'param' }),
          headers: expect.objectContaining({ 
            'user-agent': 'test-agent',
            authorization: 'Bearer token'
          }),
          body: JSON.stringify({ data: 'test' }),
          isBase64Encoded: false,
          requestContext: expect.objectContaining({
            accountId: 'local',
            apiId: 'local',
            httpMethod: 'POST',
            path: '/calendar',
            identity: expect.objectContaining({
              userAgent: 'test-agent'
            })
          })
        }),
        expect.any(Object)
      );
    });

    it('should handle requests without body', async () => {
      const mockResponse = {
        statusCode: 200,
        body: JSON.stringify({ events: [] })
      };

      mockCalendarHandler.mockResolvedValue(mockResponse);

      await request(app)
        .post('/calendar');

      expect(mockCalendarHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          body: "{}" // Express parses empty POST body as "{}"
        }),
        expect.any(Object)
      );
    });

    it('should handle query parameters correctly', async () => {
      const mockResponse = {
        statusCode: 200,
        body: JSON.stringify({ events: [] })
      };

      mockCalendarHandler.mockResolvedValue(mockResponse);

      await request(app)
        .post('/calendar')
        .query({ 
          category: 'music',
          startDate: '2025-01-01',
          endDate: '2025-12-31'
        });

      expect(mockCalendarHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          queryStringParameters: expect.objectContaining({
            category: 'music',
            startDate: '2025-01-01',
            endDate: '2025-12-31'
          })
        }),
        expect.any(Object)
      );
    });
  });

  describe('Error handling edge cases', () => {
    it('should handle malformed JSON responses from handlers', async () => {
      mockCalendarHandler.mockResolvedValue({
        statusCode: 200,
        body: 'invalid-json'
      });

      const response = await request(app)
        .post('/calendar')
        .send({});

      expect(response.status).toBe(500);
    });

    it('should handle handlers that return undefined body', async () => {
      mockAdminHandler.mockResolvedValue({
        statusCode: 200,
        body: undefined
      });

      const response = await request(app)
        .get('/admin/api/feedback');

      expect(response.status).toBe(500);
    });

    it('should handle headers with Location property as number', async () => {
      const mockResponse = {
        statusCode: 302,
        headers: { Location: 12345 },
        body: JSON.stringify({})
      };

      mockAdminHandler.mockResolvedValue(mockResponse);

      const response = await request(app)
        .get('/auth/google');

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('12345');
    });
  });
});