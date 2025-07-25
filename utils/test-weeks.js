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
  
  if (!fourthSunday) {
    fourthSunday = new Date(2025, 5, 22);
  }
  
  // Find the Saturday before the 4th Sunday, and set it to noon
  // This will be the start of Week 1 at Saturday noon
  const firstWeekStart = new Date(fourthSunday);
  firstWeekStart.setDate(fourthSunday.getDate() - 1); // Go back to Saturday
  firstWeekStart.setHours(12, 0, 0, 0); // Set to noon
  
  const weeks = [];
  for (let i = 0; i < 9; i++) {
    const weekStart = new Date(firstWeekStart);
    weekStart.setDate(firstWeekStart.getDate() + (i * 7));
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 7); // Next Saturday at noon
    
    weeks.push({
      number: i + 1,
      start: weekStart,
      end: weekEnd,
      label: `Week ${i + 1} (${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} 12pm - ${weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} 12pm)`
    });
  }
  
  return weeks;
};

const weeks = getChautauquaSeasonWeeks();
console.log('Week 5:', weeks[4].label);
console.log('Week 5 start:', weeks[4].start.toISOString());
console.log('Week 5 end:', weeks[4].end.toISOString());
console.log();
console.log('Week 8:', weeks[7].label);
console.log('Week 8 start:', weeks[7].start.toISOString());
console.log('Week 8 end:', weeks[7].end.toISOString());
console.log();
console.log('Week 9:', weeks[8].label);
console.log('Week 9 start:', weeks[8].start.toISOString());
console.log('Week 9 end:', weeks[8].end.toISOString());