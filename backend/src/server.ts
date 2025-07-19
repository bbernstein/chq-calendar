import express from 'express';
import cors from 'cors';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { EventsCalendarDataSyncService } from './services/eventsCalendarDataSyncService';
import { SyncScheduler } from './services/syncScheduler';
import ical from 'ical-generator';
import { v4 as uuidv4 } from 'uuid';
import { format, parseISO } from 'date-fns';
import fetch from 'node-fetch';

const app = express();
const port = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// DynamoDB client for local development
const dynamoClient = new DynamoDBClient({
  region: process.env.DYNAMODB_REGION || 'us-east-1',
  endpoint: process.env.DYNAMODB_ENDPOINT || 'http://localhost:8000',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'dummy',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'dummy'
  }
});

const docClient = DynamoDBDocumentClient.from(dynamoClient, {
  marshallOptions: {
    removeUndefinedValues: true,
  },
});

// Initialize sync service (using new JSON API)
const syncService = new EventsCalendarDataSyncService(undefined, docClient);

// Initialize sync scheduler for periodic syncs
const syncScheduler = new SyncScheduler(docClient);

// Environment variables
const EVENTS_TABLE_NAME = process.env.EVENTS_TABLE_NAME || 'chq-calendar-events';
const DATA_SOURCES_TABLE_NAME = process.env.DATA_SOURCES_TABLE_NAME || 'chq-calendar-data-sources';
const FEEDBACK_TABLE_NAME = process.env.FEEDBACK_TABLE_NAME || 'chq-calendar-feedback';
const RECAPTCHA_SECRET_KEY = process.env.RECAPTCHA_SECRET_KEY;

// Types
interface Event {
  id: string;
  title: string;
  description?: string;
  startDate: string;
  endDate: string;
  location?: string;
  category?: string;
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
  captchaToken: string;
}

interface FeedbackRecord {
  id: string;
  feedback: string;
  contactInfo?: string;
  timestamp: number;
  userAgent?: string;
  ipAddress?: string;
  createdAt: string;
}

// Helper function to verify reCAPTCHA token
const verifyCaptcha = async (token: string): Promise<boolean> => {
  if (!RECAPTCHA_SECRET_KEY) {
    console.warn('RECAPTCHA_SECRET_KEY not configured, skipping CAPTCHA verification');
    return true; // Allow in development/testing
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

    const result = await response.json() as { success: boolean; score?: number };
    
    // For reCAPTCHA v3, we should check the score as well
    if (result.score !== undefined) {
      return result.success && result.score > 0.5; // Threshold for human vs bot
    }
    
    return result.success;
  } catch (error) {
    console.error('Error verifying CAPTCHA:', error);
    return false;
  }
};

// Helper function to query events from DynamoDB with optimized filtering
const queryEvents = async (filters?: CalendarRequest['filters']): Promise<Event[]> => {
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
      // Use scan with filter expression for date range queries
      // since DateIndex doesn't support range queries on hash key
      // Handle both simple date strings (YYYY-MM-DD) and ISO datetime strings
      let startDateRange, endDateRange;
      
      if (filters.dateRange.start.includes('T')) {
        // ISO format - convert to local datetime format for database comparison
        const startDate = new Date(filters.dateRange.start);
        const endDate = filters.dateRange.end ? new Date(filters.dateRange.end) : new Date(filters.dateRange.start);
        
        // Convert to YYYY-MM-DD HH:MM:SS format that matches database storage
        startDateRange = startDate.getFullYear() + '-' + 
          String(startDate.getMonth() + 1).padStart(2, '0') + '-' + 
          String(startDate.getDate()).padStart(2, '0') + ' ' +
          String(startDate.getHours()).padStart(2, '0') + ':' +
          String(startDate.getMinutes()).padStart(2, '0') + ':' +
          String(startDate.getSeconds()).padStart(2, '0');
          
        // For end date, if it's the same day, extend to end of day
        if (filters.dateRange.end) {
          endDate.setHours(23, 59, 59);
        } else {
          endDate.setHours(23, 59, 59);
        }
        
        endDateRange = endDate.getFullYear() + '-' + 
          String(endDate.getMonth() + 1).padStart(2, '0') + '-' + 
          String(endDate.getDate()).padStart(2, '0') + ' ' +
          String(endDate.getHours()).padStart(2, '0') + ':' +
          String(endDate.getMinutes()).padStart(2, '0') + ':' +
          String(endDate.getSeconds()).padStart(2, '0');
      } else {
        // Simple date format - append time components
        startDateRange = filters.dateRange.start + ' 00:00:00';
        endDateRange = filters.dateRange.end 
          ? filters.dateRange.end + ' 23:59:59'
          : filters.dateRange.start + ' 23:59:59';
      }
      
      const filterExpression = 'startDate BETWEEN :startDate AND :endDate';
      
      const expressionAttributeValues = {
        ':startDate': startDateRange,
        ':endDate': endDateRange
      };

      console.log(`Date range filter: ${startDateRange} to ${endDateRange}`);

      // Handle DynamoDB scan pagination
      let lastEvaluatedKey = undefined;
      do {
        const command = new ScanCommand({
          TableName: EVENTS_TABLE_NAME,
          FilterExpression: filterExpression,
          ExpressionAttributeValues: expressionAttributeValues,
          ExclusiveStartKey: lastEvaluatedKey
        });
        const result = await docClient.send(command);
        events.push(...(result.Items || []) as any[]);
        lastEvaluatedKey = result.LastEvaluatedKey;
        console.log(`Scan batch found ${result.Items?.length || 0} events, total so far: ${events.length}`);
      } while (lastEvaluatedKey);
      
      console.log(`Scan found ${events.length} events total`);
    } else {
      // Fall back to scan if no efficient query is possible
      // Handle DynamoDB scan pagination for full table scan
      let lastEvaluatedKey = undefined;
      do {
        const command = new ScanCommand({
          TableName: EVENTS_TABLE_NAME,
          ExclusiveStartKey: lastEvaluatedKey
        });
        const result = await docClient.send(command);
        events.push(...(result.Items || []) as any[]);
        lastEvaluatedKey = result.LastEvaluatedKey;
        console.log(`Scan batch found ${result.Items?.length || 0} events, total so far: ${events.length}`);
      } while (lastEvaluatedKey);
      
      console.log(`Scan found ${events.length} events total`);
    }

    // Transform events to match frontend expectations
    const transformedEvents: Event[] = events.map(event => {
      // Extract category names from categories array
      const originalCategories = event.categories?.map((cat: any) => cat.name) || [];
      
      // Set location from venue or fallback to location field
      const location = event.venue?.name || event.location || '';
      
      return {
        id: event.id,
        title: event.title,
        description: event.description,
        startDate: event.startDate,
        endDate: event.endDate,
        location,
        category: event.category,
        originalCategories,
        tags: event.tags || [],
        presenter: event.presenter,
        lastModified: event.lastModified,
        url: event.url,
        uid: event.uid,
        createdAt: event.createdAt,
        updatedAt: event.updatedAt
      };
    });

    // Apply remaining filters
    if (filters) {
      let filteredEvents = transformedEvents;

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

      // Date filtering is already done at the database level, no need to filter again

      // Sort by start date
      filteredEvents.sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());

      // Filter out week tags from events
      return filteredEvents.map(event => ({
        ...event,
        tags: event.tags?.filter(tag => !tag.match(/^week.*/i)) || []
      }));
    }

    // Sort by start date
    transformedEvents.sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());

    // Filter out week tags from events
    return transformedEvents.map(event => ({
      ...event,
      tags: event.tags?.filter(tag => !tag.match(/^week.*/i)) || []
    }));
  } catch (error) {
    console.error('Error querying events:', error);
    throw error;
  }
};

// Helper function to generate iCal format
const generateICalendar = (events: Event[]): string => {
  const calendar = ical({
    name: 'Chautauqua Institution Calendar',
    description: 'Dynamic calendar for Chautauqua Institution 2025 season',
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
      categories: event.category ? [{ name: event.category }] : [],
      created: parseISO(event.createdAt),
      lastModified: parseISO(event.updatedAt)
    });
  });

  return calendar.toString();
};

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Calendar generation endpoint
app.post('/calendar', async (req, res) => {
  try {
    const { filters, format = 'json', timezone = 'America/New_York' } = req.body;

    console.log('Calendar request:', { filters, format, timezone });

    // Fetch events from DynamoDB with optimized queries
    const events = await queryEvents(filters);

    console.log(`Found ${events.length} events after filtering`);

    // Generate response based on format
    if (format === 'ics') {
      const icalData = generateICalendar(events);
      res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="chautauqua-calendar.ics"');
      res.send(icalData);
    } else {
      // Extract metadata for frontend filtering
      const categories = [...new Set(events.map(e => e.category).filter(Boolean))] as string[];
      const tags = [...new Set(events.flatMap(e => e.tags || []))] as string[];
      
      res.json({
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
      });
    }
  } catch (error) {
    console.error('Error generating calendar:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Feedback submission endpoint
app.post('/feedback', async (req, res) => {
  try {
    const { feedback, contactInfo, captchaToken }: FeedbackRequest = req.body;

    // Validate input
    if (!feedback || !feedback.trim()) {
      return res.status(400).json({ error: 'Feedback is required' });
    }

    // In development, allow missing CAPTCHA token for easier testing
    if (!captchaToken && process.env.NODE_ENV !== 'development') {
      return res.status(400).json({ error: 'CAPTCHA verification is required' });
    }

    // Verify CAPTCHA if token is provided
    if (captchaToken) {
      const isCaptchaValid = await verifyCaptcha(captchaToken);
      if (!isCaptchaValid) {
        return res.status(400).json({ error: 'CAPTCHA verification failed' });
      }
    }

    // Create feedback record
    const feedbackRecord: FeedbackRecord = {
      id: uuidv4(),
      feedback: feedback.trim(),
      contactInfo: contactInfo?.trim() || undefined,
      timestamp: Date.now(),
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip || req.connection.remoteAddress,
      createdAt: new Date().toISOString(),
    };

    try {
      // Store feedback in DynamoDB
      await docClient.send(new PutCommand({
        TableName: FEEDBACK_TABLE_NAME,
        Item: feedbackRecord
      }));

      console.log('Feedback submitted successfully:', feedbackRecord.id);

      res.status(201).json({
        message: 'Feedback submitted successfully',
        id: feedbackRecord.id
      });
    } catch (error) {
      console.error('Error storing feedback:', error);
      res.status(500).json({ error: 'Failed to store feedback' });
    }
  } catch (error) {
    console.error('Error in feedback endpoint:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Events CRUD endpoints
app.get('/events', async (req, res) => {
  try {
    const events = await queryEvents();
    res.json({ events });
  } catch (error) {
    console.error('Error fetching events:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Sample data creation endpoint
app.post('/calendar/sample-data', async (req, res) => {
  try {
    const sampleEvents: Omit<Event, 'id' | 'createdAt' | 'updatedAt'>[] = [
      {
        title: 'Opening Day Ceremony',
        description: 'Official opening of the 2025 Chautauqua season',
        startDate: '2025-06-21T10:00:00Z',
        endDate: '2025-06-21T11:00:00Z',
        location: 'Amphitheater',
        category: 'special-events',
        tags: ['opening', 'ceremony', 'season'],
        presenter: 'Chautauqua Institution'
      },
      {
        title: 'Morning Lecture Series',
        description: 'Daily morning lectures on current topics',
        startDate: '2025-06-22T10:45:00Z',
        endDate: '2025-06-22T11:45:00Z',
        location: 'Amphitheater',
        category: 'lectures',
        tags: ['lecture', 'education', 'morning'],
        presenter: 'Distinguished Speaker'
      },
      {
        title: 'Chautauqua Symphony Orchestra',
        description: 'Evening concert featuring classical masterpieces',
        startDate: '2025-06-22T20:15:00Z',
        endDate: '2025-06-22T22:00:00Z',
        location: 'Amphitheater',
        category: 'music',
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

    res.status(201).json({
      message: 'Sample data created successfully',
      events: createdEvents
    });
  } catch (error) {
    console.error('Error creating sample data:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

app.post('/events', async (req, res) => {
  try {
    const event = req.body;
    // Here you would save to DynamoDB
    // For now, just return the event with an ID
    const savedEvent = {
      ...event,
      id: Date.now().toString(),
      createdAt: new Date().toISOString()
    };

    res.status(201).json(savedEvent);
  } catch (error) {
    console.error('Error creating event:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Data sources endpoints
app.get('/data-sources', async (req, res) => {
  try {
    const mockDataSources = [
      {
        id: '1',
        name: 'Chautauqua Main Calendar',
        url: 'https://chq.org/calendar',
        type: 'web_scraping',
        active: true,
        lastSync: new Date().toISOString()
      }
    ];

    res.json({ dataSources: mockDataSources });
  } catch (error) {
    console.error('Error fetching data sources:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Data sync endpoints
app.post('/sync', async (req, res) => {
  try {
    const { syncType = 'incremental', year = 2025, startDate, endDate } = req.body;
    console.log(`Starting sync (${syncType}) for year ${year}`);
    
    let result;
    
    switch (syncType) {
      case 'full':
        result = await syncService.syncAllSeasonEvents(year);
        break;
      case 'daily':
        result = await syncService.performDailySync(year);
        break;
      case 'hourly':
        result = await syncService.performHourlySync();
        break;
      case 'dateRange':
        if (!startDate || !endDate) {
          return res.status(400).json({
            success: false,
            error: 'Date range sync requires startDate and endDate'
          });
        }
        result = await syncService.syncDateRange(startDate, endDate);
        break;
      default:
        result = await syncService.performIncrementalSync();
    }
    
    res.json(result);
  } catch (error) {
    console.error('Error during sync:', error);
    res.status(500).json({
      success: false,
      error: 'Sync failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Specific sync endpoints for different strategies
app.post('/sync/full', async (req, res) => {
  try {
    const { year = 2025 } = req.body;
    const result = await syncService.syncAllSeasonEvents(year);
    res.json(result);
  } catch (error) {
    console.error('Error during full sync:', error);
    res.status(500).json({
      success: false,
      error: 'Full sync failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

app.post('/sync/daily', async (req, res) => {
  try {
    const { year = 2025 } = req.body;
    const result = await syncService.performDailySync(year);
    res.json(result);
  } catch (error) {
    console.error('Error during daily sync:', error);
    res.status(500).json({
      success: false,
      error: 'Daily sync failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

app.post('/sync/hourly', async (req, res) => {
  try {
    const result = await syncService.performHourlySync();
    res.json(result);
  } catch (error) {
    console.error('Error during hourly sync:', error);
    res.status(500).json({
      success: false,
      error: 'Hourly sync failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

app.post('/sync/range', async (req, res) => {
  try {
    const { startDate, endDate } = req.body;
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: 'Range sync requires startDate and endDate'
      });
    }
    
    const result = await syncService.syncDateRange(startDate, endDate);
    res.json(result);
  } catch (error) {
    console.error('Error during range sync:', error);
    res.status(500).json({
      success: false,
      error: 'Range sync failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Sync scheduler management endpoints
app.post('/sync/scheduler/start', async (req, res) => {
  try {
    syncScheduler.start();
    res.json({ success: true, message: 'Sync scheduler started' });
  } catch (error) {
    console.error('Error starting sync scheduler:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to start sync scheduler',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

app.post('/sync/scheduler/stop', async (req, res) => {
  try {
    syncScheduler.stop();
    res.json({ success: true, message: 'Sync scheduler stopped' });
  } catch (error) {
    console.error('Error stopping sync scheduler:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to stop sync scheduler',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

app.get('/sync/scheduler/status', async (req, res) => {
  try {
    const status = syncScheduler.getStatus();
    res.json(status);
  } catch (error) {
    console.error('Error getting sync scheduler status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get sync scheduler status',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

app.get('/sync/status', async (req, res) => {
  try {
    // Show current event count and sync status
    const eventsCount = await docClient.send(new ScanCommand({
      TableName: EVENTS_TABLE_NAME,
      Select: 'COUNT'
    }));
    
    const schedulerStatus = syncScheduler.getStatus();
    
    res.json({
      totalEvents: eventsCount.Count || 0,
      syncScheduler: schedulerStatus
    });
  } catch (error) {
    console.error('Error checking sync status:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Initialize DynamoDB tables for local development
async function initializeTables() {
  try {
    console.log('🚀 Skipping table initialization for now...');
    console.log('✅ Tables should be initialized manually');
  } catch (error) {
    console.error('Error initializing tables:', error);
  }
}

// Start server
app.listen(port, async () => {
  console.log(`🚀 Backend server running on port ${port}`);
  console.log(`📊 DynamoDB endpoint: ${process.env.DYNAMODB_ENDPOINT || 'http://localhost:8000'}`);
  console.log(`🔧 Environment: ${process.env.NODE_ENV || 'development'}`);

  // Initialize tables on startup
  await initializeTables();
  
  // Start sync scheduler if enabled
  if (USE_NEW_API && syncScheduler) {
    console.log('🕐 Starting sync scheduler...');
    syncScheduler.start();
  }
});

// Environment flag for new API
const USE_NEW_API = process.env.USE_NEW_API === 'true';

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('👋 Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('👋 Shutting down gracefully...');
  process.exit(0);
});
