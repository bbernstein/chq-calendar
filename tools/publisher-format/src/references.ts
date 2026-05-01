import * as fs from 'fs';
import * as path from 'path';

export interface CategoryReference { id: string; name: string; }
export interface VenueReference { id: string; name: string; address?: string; }

export interface References {
  categoryNames: Set<string>;
  venueIds: Set<string>;
  categories: CategoryReference[];
  venues: VenueReference[];
}

const BUNDLED_REFS_DIR = path.resolve(__dirname, 'refs');
const REPO_DOCS_DIR = path.resolve(__dirname, '..', '..', '..', 'docs', 'publisher');

function defaultRefsDir(): string {
  if (fs.existsSync(path.join(BUNDLED_REFS_DIR, 'categories.json'))) return BUNDLED_REFS_DIR;
  return REPO_DOCS_DIR;
}

export function loadReferences(docsDir?: string): References {
  const dir = docsDir ?? defaultRefsDir();
  const cats = JSON.parse(fs.readFileSync(path.join(dir, 'categories.json'), 'utf8')).categories as CategoryReference[];
  const vens = JSON.parse(fs.readFileSync(path.join(dir, 'venues.json'), 'utf8')).venues as VenueReference[];
  return {
    categoryNames: new Set(cats.map(c => c.name)),
    venueIds: new Set(vens.map(v => v.id)),
    categories: cats,
    venues: vens,
  };
}
