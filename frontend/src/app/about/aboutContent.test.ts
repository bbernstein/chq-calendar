import { describe, it, expect } from 'vitest';
import {
  SHARED_HIGHLIGHTS, IOS_SCENARIOS, IOS_FEATURES,
  WEB_SCENARIOS, WEB_FEATURES, PLATFORMS, groupFeatures,
} from './aboutContent';
import { externalLinks } from '@/lib/quickLinks';

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

  // Both clients surface the same off-site Chautauqua destinations from
  // shared/links.json — the web header's "Chautauqua" menu and the iOS More
  // menu. Tying the guide back to that file is what stops a sixth link from
  // shipping undocumented: adding one fails here until someone writes a line
  // for it, on both platforms.
  describe('Chautauqua destinations', () => {
    it.each(externalLinks)('documents $title on the web guide', (link) => {
      const ids = WEB_FEATURES.map((f) => f.id);
      expect(ids, `no web guide entry for ${link.id}`).toContain(`web-chq-${link.id}`);
    });

    it.each(externalLinks)('documents $title on the iOS guide', (link) => {
      const ids = IOS_FEATURES.map((f) => f.id);
      expect(ids, `no iOS guide entry for ${link.id}`).toContain(`ios-chq-${link.id}`);
    });

    it('introduces the menu itself on both guides, not just its destinations', () => {
      // A list of five destinations is useless to someone who never finds the
      // control that holds them.
      expect(WEB_FEATURES.map((f) => f.id)).toContain('web-chq-menu');
      expect(IOS_FEATURES.map((f) => f.id)).toContain('ios-chq-menu');
    });

    it('gives each destination the same copy on both platforms', () => {
      for (const link of externalLinks) {
        const web = WEB_FEATURES.find((f) => f.id === `web-chq-${link.id}`);
        const ios = IOS_FEATURES.find((f) => f.id === `ios-chq-${link.id}`);
        expect(web?.blurb, `${link.id} blurb drifted between platforms`).toBe(ios?.blurb);
      }
    });

    it('titles each entry with the label the apps actually show', () => {
      for (const link of externalLinks) {
        for (const [platform, features] of [['web', WEB_FEATURES], ['ios', IOS_FEATURES]] as const) {
          const entry = features.find((f) => f.id === `${platform}-chq-${link.id}`);
          expect(entry?.title, `${platform} ${link.id} title`).toBe(link.title);
        }
      }
    });

    // Titles and order are derived from shared/links.json, but the prose is
    // hand-written per destination. A new link therefore renders with an
    // undefined blurb unless someone writes one.
    it('has copy for every destination, not just an entry', () => {
      for (const link of externalLinks) {
        const entry = WEB_FEATURES.find((f) => f.id === `web-chq-${link.id}`);
        expect(entry?.blurb, `no blurb written for ${link.id}`).toBeTruthy();
      }
    });

    // The group name is a string literal carrying a curly apostrophe. A plain
    // one anywhere would split these across two headings on the page without
    // failing anything else.
    it.each([
      ['web', WEB_FEATURES] as const,
      ['ios', IOS_FEATURES] as const,
    ])('files every %s destination under the same heading as its menu entry', (platform, features) => {
      const menuGroup = features.find((f) => f.id === `${platform}-chq-menu`)?.group;
      expect(menuGroup).toBeTruthy();
      for (const link of externalLinks) {
        const entry = features.find((f) => f.id === `${platform}-chq-${link.id}`);
        expect(entry?.group, `${platform} ${link.id} group`).toBe(menuGroup);
      }
    });

    it('lists the destinations in the order the menus show them', () => {
      const expected = externalLinks.map((l) => l.id);
      for (const [platform, features] of [['web', WEB_FEATURES], ['ios', IOS_FEATURES]] as const) {
        const listed = features
          .map((f) => f.id)
          .filter((id) => id.startsWith(`${platform}-chq-`) && id !== `${platform}-chq-menu`)
          .map((id) => id.replace(`${platform}-chq-`, ''));
        expect(listed, `${platform} order`).toEqual(expected);
      }
    });
  });
});
