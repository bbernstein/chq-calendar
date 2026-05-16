import { useState, useRef, useCallback, useEffect } from 'react';

interface HScrollState {
  canScrollLeft: boolean;
  canScrollRight: boolean;
}

interface VScrollState {
  canScrollUp: boolean;
  canScrollDown: boolean;
}

export function useHorizontalScroll() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollState, setScrollState] = useState<HScrollState>({ canScrollLeft: false, canScrollRight: false });

  const updateScrollState = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    const { scrollLeft, scrollWidth, clientWidth } = element;
    setScrollState({
      canScrollLeft: scrollLeft > 0,
      canScrollRight: scrollLeft < scrollWidth - clientWidth - 1,
    });
  }, []);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const element = e.currentTarget;
    const { scrollLeft, scrollWidth, clientWidth } = element;
    setScrollState({
      canScrollLeft: scrollLeft > 0,
      canScrollRight: scrollLeft < scrollWidth - clientWidth - 1,
    });
  }, []);

  return { scrollRef, scrollState, updateScrollState, handleScroll };
}

export function useVerticalScroll() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollState, setScrollState] = useState<VScrollState>({ canScrollUp: false, canScrollDown: false });

  const updateScrollState = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    const { scrollTop, scrollHeight, clientHeight } = element;
    setScrollState({
      canScrollUp: scrollTop > 0,
      canScrollDown: scrollTop < scrollHeight - clientHeight - 1,
    });
  }, []);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const element = e.currentTarget;
    const { scrollTop, scrollHeight, clientHeight } = element;
    setScrollState({
      canScrollUp: scrollTop > 0,
      canScrollDown: scrollTop < scrollHeight - clientHeight - 1,
    });
  }, []);

  return { scrollRef, scrollState, updateScrollState, handleScroll };
}

export function useWeekDragSelection(
  currentWeekNumber: number | null,
  dateFilter: string,
  setDateFilter: (filter: 'all' | 'today' | 'next' | 'this-week') => void,
  selectedWeeks: number[],
  setSelectedWeeks: React.Dispatch<React.SetStateAction<number[]>>,
) {
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<number | null>(null);
  const [wasDragged, setWasDragged] = useState(false);

  const handleWeekMouseDown = useCallback((weekNum: number, event: React.MouseEvent) => {
    if (import.meta.env.DEV) {
      console.log('handleWeekMouseDown called for week', weekNum, { shift: event.shiftKey, cmd: event.metaKey || event.ctrlKey });
    }

    event.preventDefault();

    if (!(weekNum === currentWeekNumber && !event.shiftKey && !event.metaKey && !event.ctrlKey)) {
      setDateFilter('all');
    }

    if (event.metaKey || event.ctrlKey) {
      setSelectedWeeks(prev => {
        const isCurrentWeekActive = weekNum === currentWeekNumber && dateFilter === 'this-week';
        const isInSelection = prev.includes(weekNum) || isCurrentWeekActive;
        return isInSelection
          ? prev.filter(w => w !== weekNum)
          : [...prev, weekNum].sort((a, b) => a - b);
      });
      setDateFilter('all');
      return;
    }

    const hasExistingSelection = selectedWeeks.length > 0 || (dateFilter === 'this-week' && currentWeekNumber !== null);

    if (event.shiftKey && hasExistingSelection) {
      const existingWeeks = [...selectedWeeks];
      if (dateFilter === 'this-week' && currentWeekNumber !== null && !existingWeeks.includes(currentWeekNumber)) {
        existingWeeks.push(currentWeekNumber);
      }
      existingWeeks.sort((a, b) => a - b);
      const minExisting = existingWeeks[0];
      const maxExisting = existingWeeks[existingWeeks.length - 1];

      const newRange: number[] = [];
      if (weekNum < minExisting) {
        for (let i = weekNum; i <= maxExisting; i++) newRange.push(i);
      } else if (weekNum > maxExisting) {
        for (let i = minExisting; i <= weekNum; i++) newRange.push(i);
      } else {
        const distanceToMin = Math.abs(weekNum - minExisting);
        const distanceToMax = Math.abs(weekNum - maxExisting);
        if (distanceToMin <= distanceToMax) {
          for (let i = weekNum; i <= maxExisting; i++) newRange.push(i);
        } else {
          for (let i = minExisting; i <= weekNum; i++) newRange.push(i);
        }
      }
      setSelectedWeeks(newRange);
      setDateFilter('all');
      return;
    }

    setIsDragging(true);
    setDragStart(weekNum);
    setWasDragged(false);
    setSelectedWeeks([weekNum]);
    document.body.style.userSelect = 'none';
  }, [currentWeekNumber, dateFilter, selectedWeeks, setDateFilter, setSelectedWeeks]);

  const handleWeekMouseEnter = useCallback((weekNum: number) => {
    if (isDragging && dragStart !== null) {
      setWasDragged(true);
      const start = Math.min(dragStart, weekNum);
      const end = Math.max(dragStart, weekNum);
      const range = [];
      for (let i = start; i <= end; i++) range.push(i);
      setSelectedWeeks(range);
      setDateFilter('all');
    }
  }, [isDragging, dragStart, setSelectedWeeks, setDateFilter]);

  const handleWeekMouseUp = useCallback((weekNum: number) => {
    if (isDragging && dragStart !== null) {
      if (!wasDragged && weekNum === currentWeekNumber && weekNum === dragStart) {
        setDateFilter('this-week');
        setSelectedWeeks([]);
      }
    }
    setIsDragging(false);
    setDragStart(null);
    setWasDragged(false);
    document.body.style.userSelect = '';
  }, [isDragging, dragStart, wasDragged, currentWeekNumber, setDateFilter, setSelectedWeeks]);

  const handleWeekTap = useCallback((weekNum: number) => {
    if (weekNum === currentWeekNumber && selectedWeeks.length === 0) {
      setDateFilter('this-week');
      setSelectedWeeks([]);
      return;
    }
    // Touch has no shift/cmd modifiers, so tapping a week while a relative
    // date filter (Now / Today / This Week) is active should replace that
    // filter with the single tapped week — matching desktop click behavior.
    // Multi-week selection is only available once no relative filter is set.
    const isRelativeFilterActive =
      dateFilter === 'next' || dateFilter === 'today' || dateFilter === 'this-week';
    if (isRelativeFilterActive) {
      setDateFilter('all');
      setSelectedWeeks([weekNum]);
      return;
    }
    setSelectedWeeks(prev =>
      prev.includes(weekNum)
        ? prev.filter(w => w !== weekNum)
        : [...prev, weekNum].sort((a, b) => a - b),
    );
  }, [currentWeekNumber, dateFilter, selectedWeeks, setDateFilter, setSelectedWeeks]);

  // Global mouseup handler for drag
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      if (isDragging) {
        setIsDragging(false);
        setDragStart(null);
        setWasDragged(false);
        document.body.style.userSelect = '';
      }
    };
    document.addEventListener('mouseup', handleGlobalMouseUp);
    return () => document.removeEventListener('mouseup', handleGlobalMouseUp);
  }, [isDragging]);

  return {
    isDragging,
    handleWeekMouseDown,
    handleWeekMouseEnter,
    handleWeekMouseUp,
    handleWeekTap,
  };
}
