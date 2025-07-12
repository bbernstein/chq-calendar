# Chautauqua Calendar Generator

A dynamic calendar generator for Chautauqua Institution 2025 season with real-time event updates.

## Features
- 🔄 Live data sync from official Chautauqua sources
- 🎯 Smart multi-dimensional filtering
- 📅 Export to Google Calendar, Outlook, or .ics files
- 📱 Mobile-responsive interface
- 🔔 Real-time update notifications

## Quick Start
```bash
# Deploy infrastructure
cd infrastructure
terraform init
terraform apply

# Deploy backend
cd ../backend
npm install
npm run deploy

# Deploy frontend
cd ../frontend
npm install
npm run build
npm run deploy
```

## Architecture
- **Frontend**: Next.js with TypeScript and Tailwind CSS
- **Backend**: AWS Lambda with TypeScript
- **Infrastructure**: AWS (S3, CloudFront, API Gateway, Lambda, DynamoDB)
- **Data Sources**: Chautauqua API, RSS feeds, iCal feeds, web scraping

