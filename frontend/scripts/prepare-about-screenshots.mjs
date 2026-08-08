/**
 * Downscales the App Store iOS captures into web-sized WebP for /about/.
 *
 * Source of truth is the existing App Store screenshot pipeline
 * (ios/Scripts/capture-screenshots.sh + compose-screenshots.py), which CI
 * already forces to be regenerated on any user-visible iOS change. Deriving
 * the guide's images from it means the iOS half of the site cannot silently
 * go stale.
 *
 * Outputs are committed, so `npm run build` never depends on this running.
 */
import sharp from 'sharp';
import { readdir, mkdir } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE_DIR = resolve(HERE, '../../docs/app-store/screenshots/review');
const OUT_DIR = resolve(HERE, '../public/about');
const WIDTHS = [420, 840];
const PREFIX = 'iphone-6.9-';

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const files = (await readdir(SOURCE_DIR))
    .filter((f) => f.startsWith(PREFIX) && f.endsWith('.png'))
    .sort();

  if (files.length === 0) {
    throw new Error(`No ${PREFIX}*.png found in ${SOURCE_DIR}. Run ios/Scripts/capture-screenshots.sh first.`);
  }

  for (const file of files) {
    const id = file.slice(PREFIX.length, -'.png'.length); // '01-season'
    for (const width of WIDTHS) {
      const out = resolve(OUT_DIR, `ios-${id}-${width}.webp`);
      await sharp(resolve(SOURCE_DIR, file))
        .resize({ width })
        .webp({ quality: 82 })
        .toFile(out);
      console.log(`ios-${id}-${width}.webp`);
    }
  }

  console.log(`\n${files.length} screenshots → ${files.length * WIDTHS.length} WebP files in public/about/`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
