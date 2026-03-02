export interface Event {
  id: string;
  title: string;
  description?: string;
  startDate: string;
  endDate: string;
  location?: string;
  venue?: {
    name: string;
    id?: number;
    address?: string;
    showMap?: boolean;
  };
  category?: string;
  categories?: Array<{ name: string }>;
  originalCategories?: string[];
  tags?: string[];
  presenter?: string;
  lastModified?: string;
  attachments?: Array<{
    url: string;
    type: string;
    isImage: boolean;
  }>;
  url?: string;
  // Pre-computed set containing lowercase versions of tags and categories
  // combined, used for efficient filtering
  _tagsLowerSet?: Set<string>;
}

export interface GlobalEventData {
  events: Event[] | null;
  categories: string[];
  locations: string[];
  tags: string[];
  weeks: number[];
  loadedAt: number | null;
  setGlobalEventData?: React.Dispatch<React.SetStateAction<GlobalEventData>>;
}

export interface SeasonWeek {
  number: number;
  start: Date;
  end: Date;
  label: string;
}
