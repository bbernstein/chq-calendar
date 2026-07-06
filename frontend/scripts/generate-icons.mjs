// Generate raster PWA / home-screen icons from the source SVG.
//
// iOS Safari ignores SVG `apple-touch-icon`s and falls back to a blurry
// auto-generated icon, so we rasterize a PNG. The source art is transparent
// and tall/narrow, so we composite it onto a solid background (iOS fills
// transparent pixels with black otherwise) with padding for a clean frame.
//
// Run: npm run generate:icons   (from frontend/)
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dirname, '..', 'public');
const SOURCE = join(PUBLIC, 'chq-calendar-icon.svg'); // 1024x1024 master

// Lavender — matches manifest `background_color`.
const BG = { r: 0xee, g: 0xf2, b: 0xff, alpha: 1 };

// One entry per file we emit. `pad` is the fraction of the canvas kept as
// empty margin around the artwork. Maskable icons need a larger safe-zone
// margin because Android crops the corners to a circle/squircle.
const TARGETS = [
  { file: 'apple-touch-icon.png', size: 180, pad: 0.12 },
  { file: 'icon-192.png', size: 192, pad: 0.12 },
  { file: 'icon-512.png', size: 512, pad: 0.12 },
  { file: 'icon-192-maskable.png', size: 192, pad: 0.2 },
  { file: 'icon-512-maskable.png', size: 512, pad: 0.2 },
];

async function render({ file, size, pad }) {
  const inner = Math.round(size * (1 - pad * 2));
  // Render the SVG at high density (~3600px for the 1024pt master) so
  // downscaling to the target size stays crisp.
  const art = await sharp(SOURCE, { density: 256 })
    .resize({ height: inner, width: inner, fit: 'inside' })
    .png()
    .toBuffer();

  await sharp({
    create: { width: size, height: size, channels: 4, background: BG },
  })
    .composite([{ input: art, gravity: 'center' }])
    .png()
    .toFile(join(PUBLIC, file));

  console.log(`  wrote public/${file} (${size}x${size})`);
}

console.log('Generating home-screen / PWA icons...');
for (const target of TARGETS) {
  await render(target);
}
console.log('Done.');
