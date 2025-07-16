#!/bin/bash

# Test local development environment
# This script runs comprehensive tests on the local environment

set -e

echo "🧪 Testing Local Development Environment"
echo "======================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${BLUE}$1${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Test counter
TESTS_PASSED=0
TESTS_TOTAL=0

run_test() {
    local test_name="$1"
    local test_command="$2"
    local expected_result="$3"
    
    TESTS_TOTAL=$((TESTS_TOTAL + 1))
    print_status "Testing: $test_name"
    
    if eval "$test_command"; then
        print_success "$test_name"
        TESTS_PASSED=$((TESTS_PASSED + 1))
    else
        print_error "$test_name"
        return 1
    fi
}

# Test 1: Backend health
run_test "Backend health" "curl -s http://localhost:3001/health > /dev/null"

# Test 2: Frontend accessibility
run_test "Frontend accessibility" "curl -s http://localhost:3000 > /dev/null"

# Test 3: API returns events
EVENT_COUNT=$(curl -s -X POST 'http://localhost:3001/calendar' -H "Content-Type: application/json" -d '{"filters": {}}' | jq '.events | length' 2>/dev/null || echo "0")
run_test "API returns events ($EVENT_COUNT total)" "[ '$EVENT_COUNT' -gt '0' ]"

# Test 4: Week 1 filtering
WEEK1_COUNT=$(curl -s -X POST 'http://localhost:3001/calendar' -H "Content-Type: application/json" -d '{"filters": {"dateRange": {"start": "2025-06-22T00:00:00.000Z", "end": "2025-06-28T23:59:59.999Z"}}}' | jq '.events | length' 2>/dev/null || echo "0")
run_test "Week 1 filtering ($WEEK1_COUNT events)" "[ '$WEEK1_COUNT' -gt '0' ]"

# Test 5: Week 2 filtering
WEEK2_COUNT=$(curl -s -X POST 'http://localhost:3001/calendar' -H "Content-Type: application/json" -d '{"filters": {"dateRange": {"start": "2025-06-29T00:00:00.000Z", "end": "2025-07-05T23:59:59.999Z"}}}' | jq '.events | length' 2>/dev/null || echo "0")
run_test "Week 2 filtering ($WEEK2_COUNT events)" "[ '$WEEK2_COUNT' -gt '0' ]"

# Test 6: Week 3 filtering (critical test)
WEEK3_COUNT=$(curl -s -X POST 'http://localhost:3001/calendar' -H "Content-Type: application/json" -d '{"filters": {"dateRange": {"start": "2025-07-06T00:00:00.000Z", "end": "2025-07-12T23:59:59.999Z"}}}' | jq '.events | length' 2>/dev/null || echo "0")
run_test "Week 3 filtering ($WEEK3_COUNT events)" "[ '$WEEK3_COUNT' -gt '0' ]"

# Test 7: Week 4 filtering
WEEK4_COUNT=$(curl -s -X POST 'http://localhost:3001/calendar' -H "Content-Type: application/json" -d '{"filters": {"dateRange": {"start": "2025-07-13T00:00:00.000Z", "end": "2025-07-19T23:59:59.999Z"}}}' | jq '.events | length' 2>/dev/null || echo "0")
run_test "Week 4 filtering ($WEEK4_COUNT events)" "[ '$WEEK4_COUNT' -gt '0' ]"

# Test 8: Sync process
SYNC_RESULT=$(curl -s -X POST http://localhost:3001/sync | jq '.success' 2>/dev/null || echo "false")
run_test "Sync process" "[ '$SYNC_RESULT' = 'true' ]"

# Test 9: DynamoDB accessibility
run_test "DynamoDB accessibility" "curl -s http://localhost:8000 > /dev/null"

# Test 10: Check for events across all weeks
TOTAL_WEEKS=9
WEEKS_WITH_EVENTS=0

for week in {1..9}; do
    start_date=$(node -e "
        const getChautauquaSeasonWeeks = (year = 2025) => {
            const june1 = new Date(year, 5, 1);
            const current = new Date(june1);
            let sundayCount = 0;
            let fourthSunday = null;
            
            while (current.getMonth() === 5) {
                if (current.getDay() === 0) {
                    sundayCount++;
                    if (sundayCount === 4) {
                        fourthSunday = new Date(current);
                        break;
                    }
                }
                current.setDate(current.getDate() + 1);
            }
            
            const weeks = [];
            for (let i = 0; i < 9; i++) {
                const weekStart = new Date(fourthSunday);
                weekStart.setDate(fourthSunday.getDate() + (i * 7));
                const weekEnd = new Date(weekStart);
                weekEnd.setDate(weekStart.getDate() + 6);
                
                weeks.push({
                    start: weekStart.toISOString(),
                    end: weekEnd.toISOString()
                });
            }
            
            return weeks;
        };
        
        const weeks = getChautauquaSeasonWeeks();
        console.log(weeks[$week - 1].start);
    ")
    
    end_date=$(node -e "
        const getChautauquaSeasonWeeks = (year = 2025) => {
            const june1 = new Date(year, 5, 1);
            const current = new Date(june1);
            let sundayCount = 0;
            let fourthSunday = null;
            
            while (current.getMonth() === 5) {
                if (current.getDay() === 0) {
                    sundayCount++;
                    if (sundayCount === 4) {
                        fourthSunday = new Date(current);
                        break;
                    }
                }
                current.setDate(current.getDate() + 1);
            }
            
            const weeks = [];
            for (let i = 0; i < 9; i++) {
                const weekStart = new Date(fourthSunday);
                weekStart.setDate(fourthSunday.getDate() + (i * 7));
                const weekEnd = new Date(weekStart);
                weekEnd.setDate(weekStart.getDate() + 6);
                
                weeks.push({
                    start: weekStart.toISOString(),
                    end: weekEnd.toISOString()
                });
            }
            
            return weeks;
        };
        
        const weeks = getChautauquaSeasonWeeks();
        console.log(weeks[$week - 1].end);
    ")
    
    week_count=$(curl -s -X POST 'http://localhost:3001/calendar' -H "Content-Type: application/json" -d "{\"filters\": {\"dateRange\": {\"start\": \"$start_date\", \"end\": \"$end_date\"}}}" | jq '.events | length' 2>/dev/null || echo "0")
    
    if [ "$week_count" -gt "0" ]; then
        WEEKS_WITH_EVENTS=$((WEEKS_WITH_EVENTS + 1))
        echo "   Week $week: $week_count events"
    else
        echo "   Week $week: 0 events ❌"
    fi
done

run_test "All weeks have events ($WEEKS_WITH_EVENTS/$TOTAL_WEEKS weeks)" "[ '$WEEKS_WITH_EVENTS' -eq '$TOTAL_WEEKS' ]"

# Summary
echo ""
echo "=========================="
echo "TEST SUMMARY"
echo "=========================="
echo "Tests passed: $TESTS_PASSED/$TESTS_TOTAL"

if [ $TESTS_PASSED -eq $TESTS_TOTAL ]; then
    print_success "ALL TESTS PASSED! 🎉"
    echo ""
    echo "Your local environment is ready for development!"
    echo "You can now make changes and test them locally."
    echo ""
    echo "When ready to deploy to production:"
    echo "  ./scripts/deploy-with-validation.sh"
    exit 0
else
    print_error "SOME TESTS FAILED!"
    echo ""
    echo "Please fix the failing tests before proceeding."
    echo "Check the logs and fix any issues."
    exit 1
fi