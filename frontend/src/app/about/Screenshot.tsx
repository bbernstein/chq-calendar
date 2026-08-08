import type { ScreenshotRef } from './aboutContent';

interface ScreenshotProps {
  shot: ScreenshotRef;
  /** The two prepared widths, small first. Must match the emitted WebP files. */
  widths: [number, number];
  /** Above-the-fold images load eagerly; everything else lazily. */
  priority?: boolean;
}

export function Screenshot({ shot, widths, priority }: ScreenshotProps) {
  const [small, large] = widths;
  return (
    <img
      src={`/about/${shot.base}-${large}.webp`}
      srcSet={`/about/${shot.base}-${small}.webp ${small}w, /about/${shot.base}-${large}.webp ${large}w`}
      // 384px matches the `max-w-sm` cap ScenarioBlock wraps this image in
      // (Scenario.tsx) — keep these in sync if either changes.
      sizes="(min-width: 768px) 384px, 100vw"
      alt={shot.alt}
      width={shot.width}
      height={shot.height}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      className="w-full h-auto rounded-xl shadow-lg ring-1 ring-black/5 dark:ring-white/10"
    />
  );
}
