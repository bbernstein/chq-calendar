# Chautauqua Calendar Generator - Design Document

## Overview

The Chautauqua Calendar Generator is a full-stack serverless application designed to provide a dynamic, filterable calendar for the 2025 Chautauqua Institution season. This document outlines the comprehensive architecture, design decisions, and assumptions that guide the development of this project.

## Table of Contents

1. [System Architecture](#system-architecture)
2. [Frontend Design](#frontend-design)
3. [Backend Design](#backend-design)
4. [Infrastructure Design](#infrastructure-design)
5. [Data Models](#data-models)
6. [Development Workflow](#development-workflow)
7. [Key Assumptions](#key-assumptions)
8. [Design Decisions](#design-decisions)
9. [Performance Considerations](#performance-considerations)
10. [Security Considerations](#security-considerations)

---

## System Architecture

### High-Level Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│                 │    │                 │    │                 │
│    Frontend     │    │     Backend     │    │ Infrastructure  │
│   (Next.js)     │◄──►│   (AWS Lambda)  │◄──►│     (AWS)       │
│                 │    │                 │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                        │                        │
         │                        │                        │
         ▼                        ▼                        ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│ Static Website  │    │ Express Server  │    │ Local DynamoDB  │
│ (Development)   │    │ (Development)   │    │ (Development)   │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### Technology Stack

- **Frontend**: Next.js 15.3.5, React 19, TypeScript, Tailwind CSS 4
- **Backend**: AWS Lambda (Node.js 18.x), Express.js (local dev), TypeScript
- **Database**: DynamoDB (AWS/Local)
- **Infrastructure**: AWS (S3, CloudFront, API Gateway, Lambda, DynamoDB)
- **Development**: Docker Compose, Jest, ESBuild
- **Deployment**: Terraform, AWS CLI

---

## Frontend Design

### Framework & Architecture

**Next.js App Router (v15.3.5)**
- Single Page Application with server-side rendering capability
- Static export for production deployment
- TypeScript for type safety
- Modern React patterns with hooks

### Component Structure

```
src/app/
├── layout.tsx          # Root layout with metadata
├── page.tsx            # Main calendar interface
├── globals.css         # Global styles
└── favicon.ico         # Site icon
```

### Key Design Principles

1. **Mobile-First Responsive Design**
   - Adaptive UI for mobile, tablet, and desktop
   - Touch-friendly interactions
   - Progressive enhancement

2. **Client-Side Performance**
   - All filtering happens client-side for instant results
   - Memoized components to prevent unnecessary re-renders
   - Efficient state management with React hooks

3. **User Experience**
   - Intuitive week-based navigation
   - Smart search with shortcut recognition
   - Visual feedback for all interactions
   - Accessibility compliance

### State Management

**React Hooks Pattern:**
```typescript
// Main state structure
const [events, setEvents] = useState<ChautauquaEvent[]>([]);
const [filteredEvents, setFilteredEvents] = useState<ChautauquaEvent[]>([]);
const [selectedWeeks, setSelectedWeeks] = useState<Set<number>>(new Set());
const [searchTerm, setSearchTerm] = useState<string>('');
const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
```

### Search & Filtering System

**Smart Search Shortcuts:**
- 'amp' → 'amphitheater'
- 'cso' → 'Chautauqua Symphony Orchestra'
- 'clsc' → 'Chautauqua Literary and Scientific Circle'

**Multi-Dimensional Filtering:**
- Week-based filtering (Chautauqua season weeks 1-9)
- Tag-based categorization
- Full-text search across titles and descriptions
- Combined filters with logical AND operations

### Styling Architecture

**Tailwind CSS 4 with PostCSS:**
- Utility-first approach for consistency
- Custom color palette for Chautauqua branding
- Responsive breakpoints: mobile (default), tablet (md), desktop (lg)
- Dark mode support (future enhancement)

---

## Backend Design

### Runtime Environment

**AWS Lambda with Node.js 18.x**
- Serverless compute for cost efficiency
- Auto-scaling based on demand
- TypeScript compilation with ES2020 target
- ESBuild for optimized bundling

### API Architecture

**RESTful API Design:**
```
POST /calendar     # Get filtered calendar events
POST /sync         # Trigger manual data sync
GET  /health       # Health check endpoint
```

**Handler Structure:**
```
src/handlers/
├── calendarHandler.ts    # Main calendar API
├── syncHandler.ts        # Data synchronization
└── healthHandler.ts      # Health monitoring
```

### Service Layer

**Core Services:**
1. **DataSyncService** - Manages data synchronization
2. **ICSParserService** - Parses and processes ICS calendar data
3. **DatabaseService** - Abstracts DynamoDB operations
4. **CategoryService** - Handles event categorization

### Data Synchronization Strategy

**Proximity-Based Sync Frequency:**
- **Current Events**: 30-minute intervals
- **Tomorrow's Events**: 2-hour intervals
- **Future Events**: 24-hour intervals
- **Full Sync**: Weekly on Sundays at 2 AM UTC

**Incremental Update Process:**
1. Fetch latest ICS data from Chautauqua.org
2. Compare with stored events using UID and last-modified timestamps
3. Update only changed events to minimize database operations
4. Log changes for audit trail

### Database Design

**DynamoDB Schema:**
```
Table: ChautauquaEvents
- Partition Key: uid (string)
- Sort Key: N/A (single-item table)
- Attributes: title, description, startDate, endDate, location, category, tags, etc.

Global Secondary Indexes:
- WeekIndex: week (PK) + startDate (SK)
- DateIndex: startDate (PK)
- CategoryIndex: category (PK) + startDate (SK)
```

### Event Processing Pipeline

**ICS Parsing & Enhancement:**
1. Parse ICS format to extract basic event data
2. Normalize event fields (dates, locations, descriptions)
3. Extract presenters from event titles using regex patterns
4. Categorize events using keyword matching
5. Generate tags from descriptions and titles
6. Calculate Chautauqua season week numbers

---

## Infrastructure Design

### AWS Cloud Architecture

**Core Services:**
- **S3**: Static website hosting with versioning
- **CloudFront**: Global CDN with custom domain (chqcal.org)
- **API Gateway**: RESTful API routing to Lambda functions
- **Lambda**: Serverless compute (3 functions)
- **DynamoDB**: NoSQL database with pay-per-request billing
- **Route 53**: DNS management and SSL certificates

**Security & SSL:**
- ACM SSL certificates with DNS validation
- HTTPS enforced with TLS 1.2 minimum
- CORS configuration for cross-origin requests
- IAM roles with least-privilege access

### Deployment Strategy

**Infrastructure as Code (Terraform):**
```
infrastructure/
├── main.tf              # Primary infrastructure
├── sync.tf              # Sync-related resources
├── cloudfront-function.js # Path rewriting
└── tfplan               # Terraform plan output
```

**Automated Deployment:**
- Frontend: Build → S3 → CloudFront invalidation
- Backend: Build → Lambda deployment
- Infrastructure: Terraform plan → apply

### Monitoring & Observability

**CloudWatch Integration:**
- Custom metrics for API performance
- Log aggregation from all Lambda functions
- Alarms for error rates and latency
- Dashboard for operational visibility

**Scheduled Operations:**
- EventBridge rules for automated syncing
- Health checks for API endpoints
- Database maintenance tasks

---

## Data Models

### ChautauquaEvent Interface

```typescript
interface ChautauquaEvent {
  uid: string;                    // Unique identifier
  title: string;                  // Event title
  description?: string;           // Event description
  startDate: string;              // ISO 8601 datetime
  endDate: string;                // ISO 8601 datetime
  location?: string;              // Venue/location
  category: string;               // Event category
  tags: string[];                 // Generated tags
  presenters: string[];           // Extracted presenters
  week: number;                   // Chautauqua season week (1-9)
  confidence: 'confirmed' | 'tentative' | 'placeholder' | 'TBA';
  syncStatus: 'synced' | 'pending' | 'error' | 'outdated';
  lastModified: string;           // ISO 8601 datetime
  source: 'chautauqua-ics';       // Data source
}
```

### Category System

**Event Categories:**
- **Lectures**: Morning lectures, interfaith programs
- **Music**: CSO concerts, chamber music, opera
- **Theater**: CTC productions, special performances
- **Visual Arts**: Gallery exhibitions, artist talks
- **Recreation**: Sports, fitness, family activities
- **Education**: CLSC, workshops, classes
- **Special Events**: Opening ceremonies, galas
- **Worship**: Services, chaplain programs

---

## Development Workflow

### Local Development Environment

**Docker Compose Setup:**
```yaml
services:
  frontend:     # Next.js development server
  backend:      # Express.js API server
  dynamodb:     # DynamoDB Local
  dynamodb-admin: # Database management UI
```

**Development Scripts:**
- `./scripts/start-local.sh` - Start local environment
- `./scripts/test-local.sh` - Run comprehensive tests
- `./scripts/deploy-with-validation.sh` - Deploy with validation

### Testing Strategy

**Local Testing Requirements:**
1. Backend health checks
2. Frontend accessibility
3. API endpoint validation
4. Week filtering accuracy
5. Sync process verification
6. Database connectivity
7. Cross-week event distribution

**Deployment Validation:**
- Local testing must pass before production deployment
- Manual validation of key user flows
- Production verification after deployment

---

## Key Assumptions

### Business Logic Assumptions

1. **Chautauqua Season Structure**
   - 9-week season starting from the 4th Sunday of June
   - Season years are predictable (June-August)
   - Week numbering is consistent across the platform

2. **Event Data Assumptions**
   - ICS feed format remains stable
   - Event UIDs are unique and persistent
   - Last-modified timestamps are reliable for change detection

3. **User Behavior Assumptions**
   - Users primarily filter by week and search
   - Mobile usage is significant (mobile-first design)
   - Real-time updates are more important than perfect consistency

### Technical Assumptions

1. **Data Volume**
   - ~1000 events per season
   - Manageable for client-side filtering
   - DynamoDB performance adequate for read-heavy workload

2. **Performance Requirements**
   - API response time < 500ms for 95th percentile
   - Frontend load time < 3s on 3G connection
   - Search results appear instantly (client-side)

3. **Availability Requirements**
   - 99.5% uptime acceptable (not mission-critical)
   - Graceful degradation during outages
   - Cached data acceptable during sync failures

### Infrastructure Assumptions

1. **AWS Service Reliability**
   - Lambda cold start latency acceptable
   - DynamoDB consistent performance
   - CloudFront global distribution sufficient

2. **Cost Optimization**
   - Serverless architecture cost-effective for usage patterns
   - Pay-per-request pricing model optimal
   - Static hosting cheaper than server-based solutions

---

## Design Decisions

### Frontend Technology Choices

**Next.js vs. React SPA:**
- **Chosen**: Next.js with static export
- **Rationale**: SEO benefits, better performance, development experience
- **Trade-offs**: Slight complexity increase, static build constraints

**Client-Side vs. Server-Side Filtering:**
- **Chosen**: Client-side filtering
- **Rationale**: Instant results, reduced API calls, better UX
- **Trade-offs**: Larger initial payload, memory usage

### Backend Architecture Decisions

**Lambda vs. Container-Based:**
- **Chosen**: AWS Lambda
- **Rationale**: Cost efficiency, auto-scaling, serverless benefits
- **Trade-offs**: Cold start latency, execution time limits

**DynamoDB vs. Relational Database:**
- **Chosen**: DynamoDB
- **Rationale**: Serverless, predictable performance, AWS integration
- **Trade-offs**: Query limitations, eventual consistency

### Data Synchronization Strategy

**Pull vs. Push Model:**
- **Chosen**: Pull model with scheduled sync
- **Rationale**: Chautauqua doesn't provide webhooks, reliable scheduling
- **Trade-offs**: Potential delay in updates, resource usage

**Incremental vs. Full Sync:**
- **Chosen**: Incremental sync with periodic full sync
- **Rationale**: Efficiency, reduced API load, faster updates
- **Trade-offs**: Complexity, potential for inconsistencies

---

## Performance Considerations

### Frontend Performance

**Optimization Strategies:**
- React.memo for expensive components
- useMemo for complex calculations
- Lazy loading for non-critical components
- Efficient event filtering algorithms

**Metrics to Monitor:**
- First Contentful Paint (FCP)
- Largest Contentful Paint (LCP)
- Cumulative Layout Shift (CLS)
- Time to Interactive (TTI)

### Backend Performance

**Lambda Optimization:**
- Minimize cold starts with provisioned concurrency
- Optimize bundle size with tree shaking
- Connection pooling for database operations
- Efficient JSON serialization

**Database Performance:**
- Strategic use of Global Secondary Indexes
- Batch operations for bulk updates
- Query optimization with projection expressions
- Caching strategies for frequently accessed data

---

## Security Considerations

### Authentication & Authorization

**Current Implementation:**
- No user authentication required (public calendar)
- API rate limiting through API Gateway
- CORS restrictions for browser security

**Future Enhancements:**
- Admin authentication for manual sync operations
- API key management for third-party integrations
- User preferences and personalization

### Data Security

**In Transit:**
- HTTPS everywhere with TLS 1.2+
- Secure WebSocket connections (if implemented)
- Certificate pinning for mobile apps

**At Rest:**
- DynamoDB encryption at rest
- S3 bucket encryption
- CloudWatch log encryption

### Infrastructure Security

**AWS Security Best Practices:**
- IAM roles with least-privilege access
- VPC configuration for sensitive resources
- Security groups and NACLs
- Regular security audits and updates

---

## Future Enhancements

### Planned Features

1. **User Personalization**
   - Saved filters and preferences
   - Personal calendar integration
   - Notification preferences

2. **Advanced Filtering**
   - Location-based filtering
   - Presenter-specific views
   - Custom tag creation

3. **Social Features**
   - Event sharing
   - Community recommendations
   - Social media integration

### Technical Improvements

1. **Performance Optimizations**
   - Service worker for offline functionality
   - Progressive web app capabilities
   - Advanced caching strategies

2. **Monitoring & Analytics**
   - User behavior tracking
   - Performance monitoring
   - Error tracking and alerting

3. **API Enhancements**
   - GraphQL API for flexible queries
   - Real-time updates with WebSockets
   - Third-party API integrations

---

## Conclusion

This design document serves as the single source of truth for the Chautauqua Calendar Generator architecture. It should be referenced for all development decisions and updated as the system evolves. The design prioritizes simplicity, performance, and maintainability while providing a robust foundation for future enhancements.

**Key Principles:**
- Simplicity over complexity
- Performance over features
- User experience over technical elegance
- Maintainability over optimization
- Transparency over abstraction

---

*Last Updated: July 16, 2025*
*Version: 1.0*
*Next Review: August 2025*