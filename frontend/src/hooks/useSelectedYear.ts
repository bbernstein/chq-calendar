import { useState, useCallback } from 'react';

interface UseSelectedYearProps {
  years: number[];
  defaultYear: number;
}

interface UseSelectedYearResult {
  selectedYear: number;
  setSelectedYear: (year: number) => void;
}

function getYearFromUrl(availableYears: number[], defaultYear: number): number {
  const params = new URLSearchParams(window.location.search);
  const yearParam = params.get('year');
  if (yearParam) {
    const parsed = parseInt(yearParam, 10);
    if (!isNaN(parsed) && availableYears.includes(parsed)) {
      return parsed;
    }
  }
  return defaultYear;
}

export function useSelectedYear({ years, defaultYear }: UseSelectedYearProps): UseSelectedYearResult {
  const [selectedYear, setSelectedYearState] = useState(() =>
    getYearFromUrl(years, defaultYear)
  );

  const setSelectedYear = useCallback((year: number) => {
    setSelectedYearState(year);

    // Update URL without page reload
    const url = new URL(window.location.href);
    if (year === defaultYear) {
      url.searchParams.delete('year');
    } else {
      url.searchParams.set('year', year.toString());
    }
    window.history.replaceState({}, '', url.toString());
  }, [defaultYear]);

  return { selectedYear, setSelectedYear };
}
