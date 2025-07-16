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
  
  const weeks = [];
  for (let i = 0; i < 9; i++) {
    const weekStart = new Date(fourthSunday);
    weekStart.setDate(fourthSunday.getDate() + (i * 7));
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    
    weeks.push({
      number: i + 1,
      start: weekStart,
      end: weekEnd,
      label: `Week ${i + 1} (${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})`
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