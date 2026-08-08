import { describe, it, expect } from 'vitest';
import {
  SHARED_HIGHLIGHTS, IOS_SCENARIOS, IOS_FEATURES,
  WEB_SCENARIOS, WEB_FEATURES, PLATFORMS, groupFeatures,
} from './aboutContent';

const allFeatures = [...SHARED_HIGHLIGHTS, ...IOS_FEATURES, ...WEB_FEATURES];
const allScenarios = [...IOS_SCENARIOS, ...WEB_SCENARIOS];

describe('aboutContent', () => {
  it('gives every feature a unique id', () => {
    const ids = allFeatures.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every scenario a unique id', () => {
    const ids = allScenarios.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has non-empty title and blurb on every feature', () => {
    for (const f of allFeatures) {
      expect(f.title.trim(), `${f.id} title`).not.toBe('');
      expect(f.blurb.trim(), `${f.id} blurb`).not.toBe('');
    }
  });

  it('has at least one paragraph in every scenario', () => {
    for (const s of allScenarios) {
      expect(s.body.length, `${s.id} body`).toBeGreaterThan(0);
      expect(s.body.every((p) => p.trim() !== ''), `${s.id} paragraphs`).toBe(true);
    }
  });

  it('gives every screenshot a non-empty alt text and real dimensions', () => {
    const shots = allScenarios.flatMap((s) => (s.screenshot ? [s.screenshot] : []));
    expect(shots.length).toBeGreaterThan(0);
    for (const shot of shots) {
      expect(shot.alt.trim(), `${shot.base} alt`).not.toBe('');
      expect(shot.width).toBeGreaterThan(0);
      expect(shot.height).toBeGreaterThan(0);
    }
  });

  it('covers both platforms with a guide link', () => {
    expect(PLATFORMS.map((p) => p.id).sort()).toEqual(['ios', 'web']);
    for (const p of PLATFORMS) {
      expect(p.guideHref.startsWith('/about/')).toBe(true);
    }
  });

  it('groups features preserving first-seen group order', () => {
    const grouped = groupFeatures([
      { id: 'a', title: 'A', blurb: 'a', group: 'One' },
      { id: 'b', title: 'B', blurb: 'b', group: 'Two' },
      { id: 'c', title: 'C', blurb: 'c', group: 'One' },
    ]);
    expect(grouped.map((g) => g.group)).toEqual(['One', 'Two']);
    expect(grouped[0].features.map((f) => f.id)).toEqual(['a', 'c']);
  });

  it('documents the non-obvious iOS features the App Store description promises', () => {
    const ids = IOS_FEATURES.map((f) => f.id);
    for (const id of [
      'ios-reminders', 'ios-widget-next', 'ios-widget-starred', 'ios-my-day',
      'ios-map', 'ios-siri', 'ios-spotlight', 'ios-offseason',
    ]) {
      expect(ids, `missing ${id}`).toContain(id);
    }
  });
});
