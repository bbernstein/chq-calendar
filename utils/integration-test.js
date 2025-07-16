#!/usr/bin/env node

/**
 * Integration Test: Compare localhost vs production calendar data
 * 
 * This test compares the calendar data returned by localhost and production
 * for all 9 weeks of the Chautauqua season to identify discrepancies.
 */

const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

// Configuration
const LOCALHOST_URL = 'http://localhost:3001';
const PRODUCTION_URL = 'https://chqcal.org/api';

// Calculate Chautauqua season weeks (9 weeks starting from 4th Sunday of June)
function getChautauquaSeasonWeeks(year = 2025) {
  // Start from June 1st and find the 4th Sunday
  const june1 = new Date(year, 5, 1); // June 1st
  const current = new Date(june1);
  let sundayCount = 0;
  let fourthSunday = null;

  // Find the 4th Sunday of June
  while (current.getMonth() === 5) { // Still in June
    if (current.getDay() === 0) { // Sunday
      sundayCount++;
      if (sundayCount === 4) {
        fourthSunday = new Date(current);
        break;
      }
    }
    current.setDate(current.getDate() + 1);
  }

  if (!fourthSunday) {
    // Fallback: if somehow we can't find 4th Sunday, use June 22, 2025
    fourthSunday = new Date(2025, 5, 22);
  }

  const weeks = [];
  for (let i = 0; i < 9; i++) {
    const weekStart = new Date(fourthSunday.getTime() + (i * 7 * 24 * 60 * 60 * 1000));
    const weekEnd = new Date(weekStart.getTime() + (6 * 24 * 60 * 60 * 1000));

    weeks.push({
      number: i + 1,
      start: weekStart,
      end: weekEnd,
      label: `Week ${i + 1} (${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})`
    });
  }

  return weeks;
}

// Make API call to get calendar data
async function fetchCalendarData(baseUrl, weekNumbers = [], description = '') {
  const seasonWeeks = getChautauquaSeasonWeeks();
  
  let apiFilters = {};
  
  // If weeks are specified, convert to date range
  if (weekNumbers.length > 0) {
    const startWeek = Math.min(...weekNumbers);
    const endWeek = Math.max(...weekNumbers);
    
    const startDate = seasonWeeks[startWeek - 1]?.start;
    const endDate = seasonWeeks[endWeek - 1]?.end;
    
    if (startDate && endDate) {
      // Set end date to end of the last day (23:59:59)
      const endDateInclusive = new Date(endDate);
      endDateInclusive.setHours(23, 59, 59, 999);
      
      apiFilters = {
        dateRange: {
          start: startDate.toISOString(),
          end: endDateInclusive.toISOString()
        }
      };
    }
  }

  const requestBody = {
    filters: apiFilters,
    format: 'json'
  };

  console.log(`\n📡 Fetching ${description} data...`);
  console.log(`   URL: ${baseUrl}/calendar`);
  console.log(`   Weeks: ${weekNumbers.length > 0 ? weekNumbers.join(', ') : 'All'}`);
  if (apiFilters.dateRange) {
    console.log(`   Date range: ${apiFilters.dateRange.start} to ${apiFilters.dateRange.end}`);
  }

  try {
    const response = await fetch(`${baseUrl}/calendar`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    
    console.log(`   ✅ Success: ${data.events?.length || 0} events returned`);
    console.log(`   Generated at: ${data.metadata?.generatedAt || 'Unknown'}`);
    console.log(`   Total events in metadata: ${data.metadata?.totalEvents || 'Unknown'}`);
    
    return data;
  } catch (error) {
    console.error(`   ❌ Error: ${error.message}`);
    return null;
  }
}

// Compare two datasets
function compareData(localhostData, productionData, testName) {
  console.log(`\n🔍 Comparing ${testName}...`);
  
  if (!localhostData || !productionData) {
    console.log(`   ❌ Cannot compare - missing data`);
    return { passed: false, issues: ['Missing data'] };
  }

  const localEvents = localhostData.events || [];
  const prodEvents = productionData.events || [];
  const issues = [];

  // Compare event counts
  if (localEvents.length !== prodEvents.length) {
    issues.push(`Event count mismatch: localhost=${localEvents.length}, production=${prodEvents.length}`);
  }

  // Compare event IDs and structure
  const localIds = new Set(localEvents.map(e => e.id));
  const prodIds = new Set(prodEvents.map(e => e.id));
  
  // Check for ID format differences
  const localIdSample = Array.from(localIds).slice(0, 5);
  const prodIdSample = Array.from(prodIds).slice(0, 5);
  
  console.log(`   Local ID samples: ${localIdSample.join(', ')}`);
  console.log(`   Production ID samples: ${prodIdSample.join(', ')}`);
  
  // Check for complex vs simple IDs
  const localHasComplexIds = localIdSample.some(id => id.includes('@') || id.includes('-'));
  const prodHasComplexIds = prodIdSample.some(id => id.includes('@') || id.includes('-'));
  
  if (localHasComplexIds !== prodHasComplexIds) {
    issues.push(`ID format mismatch: localhost complex=${localHasComplexIds}, production complex=${prodHasComplexIds}`);
  }

  // Find missing events
  const missingInProd = Array.from(localIds).filter(id => !prodIds.has(id));
  const missingInLocal = Array.from(prodIds).filter(id => !localIds.has(id));
  
  if (missingInProd.length > 0) {
    issues.push(`Events missing in production: ${missingInProd.slice(0, 5).join(', ')}${missingInProd.length > 5 ? '...' : ''} (${missingInProd.length} total)`);
  }
  
  if (missingInLocal.length > 0) {
    issues.push(`Events missing in localhost: ${missingInLocal.slice(0, 5).join(', ')}${missingInLocal.length > 5 ? '...' : ''} (${missingInLocal.length} total)`);
  }

  // Compare event fields for matching events
  const commonIds = Array.from(localIds).filter(id => prodIds.has(id));
  if (commonIds.length > 0) {
    const sampleId = commonIds[0];
    const localEvent = localEvents.find(e => e.id === sampleId);
    const prodEvent = prodEvents.find(e => e.id === sampleId);
    
    const fieldDifferences = [];
    
    // Check for dataSource field
    if (localEvent.dataSource !== prodEvent.dataSource) {
      fieldDifferences.push(`dataSource: local=${localEvent.dataSource}, prod=${prodEvent.dataSource}`);
    }
    
    // Check other key fields
    ['title', 'startDate', 'endDate', 'location', 'category'].forEach(field => {
      if (localEvent[field] !== prodEvent[field]) {
        fieldDifferences.push(`${field}: local="${localEvent[field]}", prod="${prodEvent[field]}"`);
      }
    });
    
    if (fieldDifferences.length > 0) {
      issues.push(`Field differences in event ${sampleId}: ${fieldDifferences.join('; ')}`);
    }
  }

  // Compare metadata
  const localMeta = localhostData.metadata || {};
  const prodMeta = productionData.metadata || {};
  
  if (localMeta.totalEvents !== prodMeta.totalEvents) {
    issues.push(`Metadata totalEvents mismatch: localhost=${localMeta.totalEvents}, production=${prodMeta.totalEvents}`);
  }

  const passed = issues.length === 0;
  console.log(`   ${passed ? '✅' : '❌'} ${passed ? 'PASSED' : 'FAILED'}`);
  
  if (!passed) {
    issues.forEach(issue => console.log(`      - ${issue}`));
  }

  return { passed, issues, localEvents, prodEvents };
}

// Test individual week
async function testWeek(weekNumber) {
  console.log(`\n🗓️  Testing Week ${weekNumber}...`);
  
  const [localhostData, productionData] = await Promise.all([
    fetchCalendarData(LOCALHOST_URL, [weekNumber], `localhost week ${weekNumber}`),
    fetchCalendarData(PRODUCTION_URL, [weekNumber], `production week ${weekNumber}`)
  ]);

  return compareData(localhostData, productionData, `Week ${weekNumber}`);
}

// Test multiple weeks
async function testWeekRange(startWeek, endWeek) {
  const weeks = [];
  for (let i = startWeek; i <= endWeek; i++) {
    weeks.push(i);
  }
  
  console.log(`\n📅 Testing Weeks ${startWeek}-${endWeek}...`);
  
  const [localhostData, productionData] = await Promise.all([
    fetchCalendarData(LOCALHOST_URL, weeks, `localhost weeks ${startWeek}-${endWeek}`),
    fetchCalendarData(PRODUCTION_URL, weeks, `production weeks ${startWeek}-${endWeek}`)
  ]);

  return compareData(localhostData, productionData, `Weeks ${startWeek}-${endWeek}`);
}

// Test all data
async function testAllData() {
  console.log(`\n🎭 Testing All Season Data...`);
  
  const [localhostData, productionData] = await Promise.all([
    fetchCalendarData(LOCALHOST_URL, [], 'localhost all data'),
    fetchCalendarData(PRODUCTION_URL, [], 'production all data')
  ]);

  return compareData(localhostData, productionData, 'All Season Data');
}

// Main test runner
async function runTests() {
  console.log('🎪 Chautauqua Calendar Integration Test');
  console.log('=====================================');
  console.log('Comparing localhost vs production data...');
  
  const results = [];
  const seasonWeeks = getChautauquaSeasonWeeks();
  
  console.log('\n📊 Season Overview:');
  seasonWeeks.forEach(week => {
    console.log(`   ${week.label}`);
  });

  try {
    // Test 1: All data comparison
    const allDataResult = await testAllData();
    results.push({ test: 'All Season Data', ...allDataResult });

    // Test 2: Individual weeks
    for (let weekNum = 1; weekNum <= 9; weekNum++) {
      const weekResult = await testWeek(weekNum);
      results.push({ test: `Week ${weekNum}`, ...weekResult });
    }

    // Test 3: Week ranges (edge cases)
    const rangeTests = [
      [1, 2], // Early season
      [4, 6], // Mid season
      [8, 9], // Late season
      [1, 9], // Full season
    ];

    for (const [start, end] of rangeTests) {
      const rangeResult = await testWeekRange(start, end);
      results.push({ test: `Weeks ${start}-${end}`, ...rangeResult });
    }

    // Generate summary report
    console.log('\n📋 Test Results Summary');
    console.log('=======================');
    
    let totalTests = 0;
    let passedTests = 0;
    
    results.forEach(result => {
      totalTests++;
      if (result.passed) {
        passedTests++;
      }
      console.log(`${result.passed ? '✅' : '❌'} ${result.test}`);
      if (!result.passed && result.issues) {
        result.issues.slice(0, 2).forEach(issue => {
          console.log(`    - ${issue}`);
        });
        if (result.issues.length > 2) {
          console.log(`    ... and ${result.issues.length - 2} more issues`);
        }
      }
    });

    console.log(`\n📊 Overall Results: ${passedTests}/${totalTests} tests passed`);
    
    if (passedTests === totalTests) {
      console.log('🎉 All tests passed! Localhost and production data are synchronized.');
    } else {
      console.log('⚠️  Some tests failed. There are discrepancies between localhost and production.');
    }

    // Save detailed results to file
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportPath = path.join(__dirname, `integration-test-report-${timestamp}.json`);
    
    fs.writeFileSync(reportPath, JSON.stringify({
      timestamp: new Date().toISOString(),
      summary: {
        totalTests,
        passedTests,
        failedTests: totalTests - passedTests,
        success: passedTests === totalTests
      },
      results,
      seasonWeeks
    }, null, 2));

    console.log(`\n📄 Detailed report saved to: ${reportPath}`);

  } catch (error) {
    console.error('\n❌ Test suite failed:', error);
    process.exit(1);
  }
}

// Run the tests
if (require.main === module) {
  runTests().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { runTests, testWeek, testWeekRange, testAllData };