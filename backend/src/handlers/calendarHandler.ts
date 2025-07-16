import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, PutCommand, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import ical from 'ical-generator';
import { v4 as uuidv4 } from 'uuid';
import { format, parseISO } from 'date-fns';

// DynamoDB client
const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

// Environment variables
const EVENTS_TABLE_NAME = process.env.EVENTS_TABLE_NAME || 'chq-calendar-events';
const DATA_SOURCES_TABLE_NAME = process.env.DATA_SOURCES_TABLE_NAME || 'chq-calendar-data-sources';

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

// Helper function to create HTTP response
const createResponse = (statusCode: number, body: any, headers: Record<string, string> = {}): APIGatewayProxyResult => {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      ...headers
    },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  };
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
      categories: [
        ...(event.category && event.category.trim() ? [event.category.trim()] : []),
        ...(event.tags || []).filter(tag => tag && tag.trim())
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

    // Handle calendar generation
    if (httpMethod === 'POST' && path === '/calendar') {
      const { filters, format = 'json', timezone = 'America/New_York' } = requestBody;

      // Fetch events from DynamoDB with optimized queries
      const events = await queryEvents(filters);

      console.log(`Found ${events.length} events after filtering`);

      // Generate response based on format
      if (format === 'ics') {
        const icalData = generateICalendar(events);
        return createResponse(200, icalData, {
          'Content-Type': 'text/calendar; charset=utf-8',
          'Content-Disposition': 'attachment; filename="chautauqua-calendar.ics"'
        });
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
        });
      }
    }

    // Handle events listing
    if (httpMethod === 'GET' && path === '/calendar/events') {
      const events = await queryEvents();
      return createResponse(200, { events });
    }

    // Handle health check
    if (httpMethod === 'GET' && path === '/health') {
      return createResponse(200, {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        environment: process.env.ENVIRONMENT || 'unknown'
      });
    }

    // Handle sample data creation (for testing)
    if (httpMethod === 'POST' && path === '/calendar/sample-data') {
      const sampleEvents: Omit<Event, 'id' | 'createdAt' | 'updatedAt'>[] = [
        {
          title: 'Opening Day Ceremony',
          description: 'Official opening of the 2025 Chautauqua season',
          startDate: '2025-06-21T10:00:00Z',
          endDate: '2025-06-21T11:00:00Z',
          location: 'Amphitheater',
          category: 'special-events',
          week: 1,
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
          week: 1,
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
