import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, PutCommand, GetCommand, QueryCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import ical from 'ical-generator';
import { v4 as uuidv4 } from 'uuid';
import { format, parseISO } from 'date-fns';
import fetch from 'node-fetch';
import { MultiLayerCacheService, CacheConfig } from '../services/multiLayerCacheService';

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

// Environment variables
const EVENTS_TABLE_NAME = process.env.EVENTS_TABLE_NAME || 'chautauqua-calendar-events';
const DATA_SOURCES_TABLE_NAME = process.env.DATA_SOURCES_TABLE_NAME || 'chautauqua-calendar-data-sources';
const FEEDBACK_TABLE_NAME = process.env.FEEDBACK_TABLE_NAME || 'chautauqua-calendar-feedback';
const RECAPTCHA_SECRET_KEY = process.env.RECAPTCHA_SECRET_KEY;

// Cache configuration
const CACHE_S3_BUCKET = process.env.CACHE_S3_BUCKET || 'chautauqua-calendar-cache';
const CACHE_MEMORY_TTL_MINUTES = parseInt(process.env.CACHE_MEMORY_TTL_MINUTES || '60');
const CACHE_S3_TTL_MINUTES = parseInt(process.env.CACHE_S3_TTL_MINUTES || '60');
const CACHE_S3_KEY_PREFIX = process.env.CACHE_S3_KEY_PREFIX || 'calendar-cache';
const CACHE_BROWSER_TTL_SECONDS = parseInt(process.env.CACHE_BROWSER_TTL_SECONDS || '3600'); // 1 hour default
const CACHE_KEY_BUCKET_MINUTES = parseInt(process.env.CACHE_KEY_BUCKET_MINUTES || '15'); // 15 minute buckets for cache key consistency

// Initialize cache service
const cacheConfig: CacheConfig = {
  memoryTtlMinutes: CACHE_MEMORY_TTL_MINUTES,
  s3TtlMinutes: CACHE_S3_TTL_MINUTES,
  s3BucketName: CACHE_S3_BUCKET,
  s3KeyPrefix: CACHE_S3_KEY_PREFIX
};

const cacheService = new MultiLayerCacheService(cacheConfig);

// Types
interface Event {
  id: string;
  title: string;
  description?: string;
  startDate: string;
  endDate: string;
  location?: string;
  category?: string;
  week?: number;
  tags?: string[];
  url?: string;
  presenter?: string;
  uid?: string;
  lastModified?: string;
  createdAt: string;
  updatedAt: string;
}

interface CalendarRequest {
  filters?: {
    categories?: string[];
    tags?: string[];
    dateRange?: {
      start: string;
      end: string;
    };
  };
  format?: 'ics' | 'json';
  timezone?: string;
}

interface FeedbackRequest {
  feedback: string;
  contactInfo?: string;
  captchaToken?: string;
}

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

// Helper function to create HTTP response with caching headers
const createResponse = (statusCode: number, body: any, headers: Record<string, string> = {}, enableCaching = false): APIGatewayProxyResult => {
  const cacheHeaders = enableCaching ? {
    'Cache-Control': `public, max-age=${CACHE_BROWSER_TTL_SECONDS}, s-maxage=${CACHE_BROWSER_TTL_SECONDS}`, // Browser & CDN cache
    'Expires': new Date(Date.now() + CACHE_BROWSER_TTL_SECONDS * 1000).toUTCString(),
    'Vary': 'Accept-Encoding',
    'X-Cache-Enabled': 'true', // Debug header to confirm caching is enabled
    'X-Cache-TTL': String(CACHE_BROWSER_TTL_SECONDS) // Debug header with TTL value
  } : {
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
    'X-Cache-Enabled': 'false' // Debug header
  };

  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      ...cacheHeaders,
      ...headers
    },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  };
};

// Helper function to verify reCAPTCHA token
const verifyCaptcha = async (token: string): Promise<boolean> => {
  if (!RECAPTCHA_SECRET_KEY) {
    const isProduction = process.env.ENVIRONMENT === 'prod';
    if (isProduction) {
      console.error('RECAPTCHA_SECRET_KEY not configured in production - rejecting request');
      return false; // Fail closed in production
    } else {
      console.warn('RECAPTCHA_SECRET_KEY not configured, skipping CAPTCHA verification in non-production');
      return true; // Allow in development/testing only
    }
  }

  try {
    const response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        secret: RECAPTCHA_SECRET_KEY,
        response: token,
      }),
    });

    const result = await response.json() as {
      success: boolean;
      score?: number;
      action?: string;
      'error-codes'?: string[];
      challenge_ts?: string;
      hostname?: string;
    };

    console.log(`reCAPTCHA verification result:`, {
      success: result.success,
      score: result.score,
      action: result.action || 'submit_feedback',
      errorCodes: result['error-codes'],
      challengeTimestamp: result.challenge_ts,
      hostname: result.hostname
    });

    // For reCAPTCHA v3, we should check the score as well
    if (result.score !== undefined) {
      const isValid = result.success && result.score > 0.5; // Threshold for human vs bot
      console.log(`reCAPTCHA score validation: ${result.score} > 0.5 = ${isValid}`);
      return isValid;
    }

    return result.success;
  } catch (error) {
    console.error('Error verifying CAPTCHA:', error);
    return false;
  }
};

// Helper function to transform database events to the expected Event format
const transformDatabaseEvent = (dbEvent: any): Event => {
  return {
    id: dbEvent.id,
    title: dbEvent.title,
    description: dbEvent.description,
    startDate: dbEvent.startDate,
    endDate: dbEvent.endDate,
    location: dbEvent.location || (dbEvent.venue?.name) || '',
    category: dbEvent.category || (dbEvent.categories && dbEvent.categories.length > 0 ? dbEvent.categories[0].name : ''),
    week: dbEvent.week || undefined,
    tags: Array.isArray(dbEvent.tags) ? dbEvent.tags : [],
    url: dbEvent.url,
    presenter: dbEvent.presenter,
    uid: dbEvent.uid,
    lastModified: dbEvent.lastModified || dbEvent.lastUpdated,
    createdAt: dbEvent.createdAt,
    updatedAt: dbEvent.updatedAt
  };
};

// Helper function to scan all events with pagination
const scanAllEvents = async (): Promise<any[]> => {
  const allEvents: any[] = [];
  let lastEvaluatedKey: any = undefined;

  do {
    const command = new ScanCommand({
      TableName: EVENTS_TABLE_NAME,
      ExclusiveStartKey: lastEvaluatedKey
    });

    const result = await docClient.send(command);

    if (result.Items) {
      allEvents.push(...result.Items);
    }

    lastEvaluatedKey = result.LastEvaluatedKey;

    console.log(`Scanned ${result.Items?.length || 0} events, total: ${allEvents.length}`);

  } while (lastEvaluatedKey);

  console.log(`Total events scanned: ${allEvents.length}`);
  return allEvents;
};

// Helper function to query events from DynamoDB with optimized filtering (uncached)
const queryEventsFromDatabase = async (filters?: CalendarRequest['filters']): Promise<Event[]> => {
  try {
    let events: any[] = [];

    // Use GSI queries when possible for better performance
    if (filters?.categories && filters.categories.length === 1) {
      // Query by category using CategoryIndex
      const command = new QueryCommand({
        TableName: EVENTS_TABLE_NAME,
        IndexName: 'CategoryIndex',
        KeyConditionExpression: 'category = :category',
        ExpressionAttributeValues: {
          ':category': filters.categories[0]
        }
      });
      const result = await docClient.send(command);
      events = (result.Items || []) as any[];
    } else if (filters?.dateRange?.start) {
      // For date range queries, we need to scan all events first
      // and then filter programmatically because date formats vary
      // Handle pagination to get all events
      events = await scanAllEvents();
    } else {
      // Fall back to scan if no efficient query is possible
      // Handle pagination to get all events
      events = await scanAllEvents();
    }

    // Transform database events to the expected Event format
    const transformedEvents = events.map(dbEvent => transformDatabaseEvent(dbEvent));

    // Apply remaining filters
    let filteredEvents = transformedEvents;
    if (filters) {
      if (filters.categories && filters.categories.length > 1) {
        filteredEvents = filteredEvents.filter(event =>
          filters.categories!.includes(event.category || '')
        );
      }

      if (filters.tags && filters.tags.length > 0) {
        filteredEvents = filteredEvents.filter(event =>
          event.tags && filters.tags!.some(tag => event.tags!.includes(tag))
        );
      }

      if (filters.dateRange) {
        // Apply date filtering for all cases
        const startDate = new Date(filters.dateRange.start);
        const endDate = new Date(filters.dateRange.end);

        filteredEvents = filteredEvents.filter(event => {
          // Parse database date format (YYYY-MM-DD HH:MM:SS or ISO format)
          let eventStart: Date;
          if (event.startDate.includes('T')) {
            // ISO format
            eventStart = new Date(event.startDate);
          } else {
            // Database format (YYYY-MM-DD HH:MM:SS) - assume it's in Eastern Time
            // Add 'T' to make it parseable and treat as UTC (since times are already in ET)
            eventStart = new Date(event.startDate.replace(' ', 'T') + '.000Z');
          }

          // For date-only comparisons, compare just the date parts
          const eventDateOnly = event.startDate.split(' ')[0];
          const startDateOnly = filters.dateRange.start.split('T')[0];
          const endDateOnly = filters.dateRange.end.split('T')[0];

          return eventDateOnly >= startDateOnly && eventDateOnly <= endDateOnly;
        });
      }
    }

    // Sort by start date
    filteredEvents.sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());

    // Filter out week tags from events
    filteredEvents = filteredEvents.map(event => ({
      ...event,
      tags: event.tags?.filter(tag => !tag.match(/^week.*/i)) || []
    }));

    return filteredEvents;
  } catch (error) {
    console.error('Error querying events:', error);
    throw error;
  }
};

// Cached version of queryEvents using multi-layer caching
const queryEvents = async (filters?: CalendarRequest['filters']): Promise<Event[]> => {
  // Create cache key based on filters
  const cacheKey = {
    filters: filters || {},
    timestamp: Math.floor(Date.now() / (1000 * 60 * CACHE_KEY_BUCKET_MINUTES)) // Round to bucket interval for consistency
  };

  console.log('Checking cache for events with filters:', JSON.stringify(filters));

  try {
    // Try to get from cache first (Layers 3 & 4)
    const cachedEvents = await cacheService.get(cacheKey);
    if (cachedEvents) {
      console.log(`Cache HIT: Returning ${cachedEvents.length} events from cache`);
      return cachedEvents;
    }

    console.log('Cache MISS: Fetching events from database');

    // Cache miss - fetch from database
    const events = await queryEventsFromDatabase(filters);

    // Store in cache for future requests
    await cacheService.set(cacheKey, events);

    console.log(`Fetched and cached ${events.length} events`);
    return events;
  } catch (error) {
    console.error('Error in cached queryEvents:', error);
    // Fallback to database query if cache fails
    console.log('Falling back to direct database query due to cache error');
    return await queryEventsFromDatabase(filters);
  }
};

// Helper function to generate iCal format
const generateICalendar = (events: Event[]): string => {
  const calendar = ical({
    name: 'Chautauqua Institution Calendar',
    description: 'Dynamic calendar for Chautauqua Institution 2026 season',
    timezone: 'America/New_York',
    url: 'https://chqcal.org'
  });

  events.forEach(event => {
    calendar.createEvent({
      id: event.id,
      start: parseISO(event.startDate),
      end: parseISO(event.endDate),
      summary: event.title,
      description: event.description || '',
      location: event.location || '',
      url: event.url || '',
      organizer: event.presenter ? { name: event.presenter } : undefined,
      categories: [
        ...(event.category && event.category.trim() ? [{ name: event.category.trim() }] : []),
        ...(event.tags || []).filter(tag => tag && tag.trim()).map(tag => ({ name: tag }))
      ],
      created: parseISO(event.createdAt),
      lastModified: parseISO(event.updatedAt)
    });
  });

  return calendar.toString();
};

// Main Lambda handler
export const handler = async (event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> => {
  console.log('Calendar handler invoked:', JSON.stringify(event, null, 2));

  try {
    const httpMethod = event.httpMethod;
    const path = event.path;

    // Handle CORS preflight
    if (httpMethod === 'OPTIONS') {
      return createResponse(200, {});
    }

    // Parse request body
    let requestBody: CalendarRequest = {};
    if (event.body) {
      try {
        requestBody = JSON.parse(event.body);
      } catch (error) {
        console.error('Error parsing request body:', error);
        return createResponse(400, { error: 'Invalid JSON in request body' });
      }
    }

    // Handle feedback submission
    if (httpMethod === 'POST' && path === '/feedback') {
      const { feedback, contactInfo, captchaToken }: FeedbackRequest = requestBody as FeedbackRequest;

      // Validate input
      if (!feedback || !feedback.trim()) {
        return createResponse(400, { error: 'Feedback is required' });
      }

      // In development, allow missing CAPTCHA token for easier testing
      if (!captchaToken && process.env.ENVIRONMENT !== 'prod') {
        console.log('CAPTCHA token missing, but allowing in non-production environment');
      } else if (!captchaToken) {
        return createResponse(400, { error: 'CAPTCHA verification is required' });
      }

      // Verify CAPTCHA if token is provided
      if (captchaToken) {
        const isCaptchaValid = await verifyCaptcha(captchaToken);
        if (!isCaptchaValid) {
          return createResponse(400, { error: 'CAPTCHA verification failed' });
        }
      }

      // Create feedback record
      const feedbackRecord: FeedbackRecord = {
        id: uuidv4(),
        feedback: feedback.trim(),
        contactInfo: contactInfo?.trim() || undefined,
        timestamp: Date.now(),
        userAgent: event.headers['User-Agent'] || event.headers['user-agent'],
        ipAddress: event.requestContext?.identity?.sourceIp,
        createdAt: new Date().toISOString(),
      };

      try {
        // Store feedback in DynamoDB
        await docClient.send(new PutCommand({
          TableName: FEEDBACK_TABLE_NAME,
          Item: feedbackRecord
        }));

        console.log('Feedback submitted successfully:', feedbackRecord.id);

        return createResponse(201, {
          message: 'Feedback submitted successfully',
          id: feedbackRecord.id
        });
      } catch (error) {
        console.error('Error storing feedback:', error);
        return createResponse(500, { error: 'Failed to store feedback' });
      }
    }

    // Handle calendar generation (both GET and POST for caching support)
    if ((httpMethod === 'POST' || httpMethod === 'GET') && path === '/calendar') {
      let filters, format, timezone;

      if (httpMethod === 'POST') {
        // POST request with body
        ({ filters, format = 'json', timezone = 'America/New_York' } = requestBody);
      } else {
        // GET request with query parameters
        const queryParams = event.queryStringParameters || {};

        // Parse filters from query parameters
        filters = {};
        if (queryParams.categories) {
          filters.categories = queryParams.categories.split(',');
        }
        if (queryParams.tags) {
          filters.tags = queryParams.tags.split(',');
        }
        if (queryParams.startDate && queryParams.endDate) {
          filters.dateRange = {
            start: queryParams.startDate,
            end: queryParams.endDate
          };
        }

        // If no individual filter params, check for JSON filters param (backward compatibility)
        if (!queryParams.categories && !queryParams.tags && !queryParams.startDate && queryParams.filters) {
          try {
            filters = JSON.parse(queryParams.filters);
          } catch (error) {
            console.error('Error parsing filters JSON from query parameter:', error);
            filters = {};
          }
        }

        // If no filters at all, set to undefined for cleaner cache keys
        if (Object.keys(filters).length === 0) {
          filters = undefined;
        }

        format = queryParams.format || 'json';
        timezone = queryParams.timezone || 'America/New_York';
      }

      console.log(`Calendar API called via ${httpMethod} with filters:`, JSON.stringify(filters));
      console.log('Cache configuration:', {
        CACHE_BROWSER_TTL_SECONDS,
        CACHE_MEMORY_TTL_MINUTES,
        CACHE_S3_TTL_MINUTES,
        CACHE_S3_BUCKET
      });

      // Fetch events from DynamoDB with optimized queries
      const events = await queryEvents(filters);

      console.log(`Found ${events.length} events after filtering`);

      // Generate response based on format
      if (format === 'ics') {
        const icalData = generateICalendar(events);
        return createResponse(200, icalData, {
          'Content-Type': 'text/calendar; charset=utf-8',
          'Content-Disposition': 'attachment; filename="chautauqua-calendar.ics"'
        }, true); // Enable caching for iCal files
      } else {
        // Return JSON format
        // Extract metadata for frontend filtering
        const categories = [...new Set(events.map(e => e.category).filter(Boolean))] as string[];
        const tags = [...new Set(events.flatMap(e => e.tags || []))] as string[];

        return createResponse(200, {
          events,
          metadata: {
            totalEvents: events.length,
            filters: filters || {},
            generatedAt: new Date().toISOString(),
            timezone,
            availableFilters: {
              categories: categories.sort(),
              tags: tags.sort()
            }
          }
        }, undefined, true); // Enable caching for JSON responses
      }
    }

    // Handle events listing
    if (httpMethod === 'GET' && path === '/calendar/events') {
      const events = await queryEvents();
      return createResponse(200, { events }, undefined, true); // Enable caching
    }

    // Handle health check
    if (httpMethod === 'GET' && path === '/health') {
      return createResponse(200, {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        environment: process.env.ENVIRONMENT || 'unknown'
      });
    }

    // Handle cache status check (for monitoring)
    if (httpMethod === 'GET' && path === '/cache/status') {
      const stats = cacheService.getCacheStats();
      return createResponse(200, {
        cacheStatus: 'operational',
        stats,
        timestamp: new Date().toISOString()
      });
    }

    // Handle sample data creation (for testing)
    if (httpMethod === 'POST' && path === '/calendar/sample-data') {
      const sampleEvents: Omit<Event, 'id' | 'createdAt' | 'updatedAt'>[] = [
        {
          title: 'Opening Day Ceremony',
          description: 'Official opening of the 2026 Chautauqua season',
          startDate: '2026-06-27T10:00:00Z',
          endDate: '2026-06-27T11:00:00Z',
          location: 'Amphitheater',
          category: 'special-events',
          week: 1,
          tags: ['opening', 'ceremony', 'season'],
          presenter: 'Chautauqua Institution'
        },
        {
          title: 'Morning Lecture Series',
          description: 'Daily morning lectures on current topics',
          startDate: '2026-06-28T10:45:00Z',
          endDate: '2026-06-28T11:45:00Z',
          location: 'Amphitheater',
          category: 'lectures',
          week: 1,
          tags: ['lecture', 'education', 'morning'],
          presenter: 'Distinguished Speaker'
        },
        {
          title: 'Chautauqua Symphony Orchestra',
          description: 'Evening concert featuring classical masterpieces',
          startDate: '2026-06-28T20:15:00Z',
          endDate: '2026-06-28T22:00:00Z',
          location: 'Amphitheater',
          category: 'music',
          week: 1,
          tags: ['symphony', 'classical', 'evening'],
          presenter: 'Chautauqua Symphony Orchestra'
        }
      ];

      // Insert sample events
      const createdEvents = [];
      for (const eventData of sampleEvents) {
        const event: Event = {
          ...eventData,
          id: uuidv4(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };

        await docClient.send(new PutCommand({
          TableName: EVENTS_TABLE_NAME,
          Item: event
        }));

        createdEvents.push(event);
      }

      return createResponse(201, {
        message: 'Sample data created successfully',
        events: createdEvents
      });
    }

    // Handle feedback submission
    if (httpMethod === 'POST' && path === '/feedback') {
      const { feedback, contactInfo, captchaToken }: FeedbackRequest = requestBody as FeedbackRequest;

      // Validate input
      if (!feedback || !feedback.trim()) {
        return createResponse(400, { error: 'Feedback is required' });
      }

      // In development, allow missing CAPTCHA token for easier testing
      if (!captchaToken && process.env.ENVIRONMENT !== 'prod') {
        console.log('CAPTCHA token missing, but allowing in non-production environment');
      } else if (!captchaToken) {
        return createResponse(400, { error: 'CAPTCHA verification is required' });
      }

      // Verify CAPTCHA if token is provided
      if (captchaToken) {
        const isCaptchaValid = await verifyCaptcha(captchaToken);
        if (!isCaptchaValid) {
          return createResponse(400, { error: 'CAPTCHA verification failed' });
        }
      }

      // Create feedback record
      const feedbackRecord: FeedbackRecord = {
        id: uuidv4(),
        feedback: feedback.trim(),
        contactInfo: contactInfo?.trim() || undefined,
        timestamp: Date.now(),
        userAgent: event.headers['User-Agent'] || event.headers['user-agent'],
        ipAddress: event.requestContext?.identity?.sourceIp,
        createdAt: new Date().toISOString(),
        archived: false,
      };

      try {
        // Store feedback in DynamoDB
        await docClient.send(new PutCommand({
          TableName: FEEDBACK_TABLE_NAME,
          Item: feedbackRecord
        }));

        console.log('Feedback submitted successfully:', feedbackRecord.id);

        return createResponse(201, {
          message: 'Feedback submitted successfully',
          id: feedbackRecord.id
        });
      } catch (error) {
        console.error('Error storing feedback:', error);
        return createResponse(500, { error: 'Failed to store feedback' });
      }
    }

    // Admin endpoints are handled by the Express server with proper OAuth authentication
    // This Lambda handler only serves public endpoints (calendar generation, feedback submission)

    // Method not allowed
    return createResponse(405, { error: 'Method not allowed' });

  } catch (error) {
    console.error('Error in calendar handler:', error);
    return createResponse(500, {
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};
