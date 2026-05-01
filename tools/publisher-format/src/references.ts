import * as fs from 'fs';
import * as path from 'path';

export interface CategoryRef { id: string; name: string; }
export interface VenueRef { id: string; name: string; address?: string; }

export interface References {
  categoryNames: Set<string>;
  venueIds: Set<string>;
  categories: CategoryRef[];
  venues: VenueRef[];
}

const DEFAULT_DOCS_DIR = path.resolve(__dirname, '..', '..', '..', 'docs', 'publisher');

export function loadReferences(docsDir = DEFAULT_DOCS_DIR): References {
  const cats = JSON.parse(fs.readFileSync(path.join(docsDir, 'categories.json'), 'utf8')).categories as CategoryRef[];
  const vens = JSON.parse(fs.readFileSync(path.join(docsDir, 'venues.json'), 'utf8')).venues as VenueRef[];
  return {
    categoryNames: new Set(cats.map(c => c.name)),
    venueIds: new Set(vens.map(v => v.id)),
    categories: cats,
    venues: vens,
  };
}
