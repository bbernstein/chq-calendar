#!/usr/bin/env ts-node
import * as fs from 'fs';
import * as path from 'path';

interface RawEvent {
  category?: string;
  categories?: Array<{ name: string }>;
  venue?: { id?: number | string; name?: string; address?: string };
}

function slugify(input: string): string {
  return input.toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function deriveFromCache(cachePath: string) {
  const raw = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  const events: RawEvent[] = raw.data ?? raw;
  const categorySet = new Set<string>();
  const venueMap = new Map<string, { id: string; name: string; address?: string }>();

  for (const ev of events) {
    if (Array.isArray(ev.categories)) {
      for (const c of ev.categories) if (c?.name) categorySet.add(c.name.trim());
    }
    if (ev.category) categorySet.add(ev.category.trim());

    if (ev.venue?.name) {
      const id = slugify(ev.venue.name);
      if (!venueMap.has(id)) {
        venueMap.set(id, {
          id,
          name: ev.venue.name.trim(),
          ...(ev.venue.address ? { address: ev.venue.address } : {}),
        });
      }
    }
  }

  const categories = Array.from(categorySet).sort()
    .map(name => ({ id: slugify(name), name }));
  const venues = Array.from(venueMap.values())
    .sort((a, b) => a.name.localeCompare(b.name));

  return { categories, venues };
}

function main() {
  const input = process.argv[2];
  if (!input) {
    console.error('Usage: ts-node scripts/derive-publisher-references.ts <path-to-all-events-YYYY.json>');
    process.exit(1);
  }
  const { categories, venues } = deriveFromCache(input);
  const outDir = path.resolve(__dirname, '..', 'docs', 'publisher');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'categories.json'), JSON.stringify({ categories }, null, 2) + '\n');
  fs.writeFileSync(path.join(outDir, 'venues.json'), JSON.stringify({ venues }, null, 2) + '\n');
  console.log(`Wrote ${categories.length} categories and ${venues.length} venues to ${outDir}`);
}

main();
