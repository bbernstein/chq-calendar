import React, { useState, createContext, useContext } from 'react';
import type { GlobalEventData } from '@/lib/types';

const GlobalEventDataContext = createContext<GlobalEventData | undefined>(undefined);

export function useGlobalEventData() {
  const context = useContext(GlobalEventDataContext);
  if (!context) {
    throw new Error('useGlobalEventData must be used within a GlobalEventDataProvider');
  }
  return context;
}

export function GlobalEventDataProvider({ children }: { children: React.ReactNode }) {
  const [globalEventData, setGlobalEventData] = useState<GlobalEventData>({
    events: null,
    categories: [],
    locations: [],
    tags: [],
    weeks: [],
    loadedAt: null,
  });

  return (
    <GlobalEventDataContext.Provider value={{ ...globalEventData, setGlobalEventData }}>
      {children}
    </GlobalEventDataContext.Provider>
  );
}
