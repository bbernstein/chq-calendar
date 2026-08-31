/**
 * Browser verification for phase 3a's day rail.
 *
 * Everything this phase risks is geometry, and jsdom computes none of it.
 * Phase 2's browser pass found a 3,903px jump that three green unit tests had
 * no opinion about, so this exists to produce numbers rather than impressions.
 *
 * Each check prints PASS/FAIL plus the value it measured. Run against a dev
 * server on :3000.
 */
import { chromium } from 'playwright';
import { pinClock, atMidMorning, FIXED_NOW } from './fixedNow.mjs';
import { check, skip, finish } from './results.mjs';
import { enterList, currentRegime, surveyPinnableToday } from './regime.mjs';

const URL = process.env.URL ?? 'http://localhost:3000/';

const browser = await chromium.launch();


async function newPage(
  { width = 900, height = 900, storage, seedsOwnFilter = false, clock = FIXED_NOW } = {}
) {
  // Chautauqua's own timezone, kept for belt-and-braces — it is no longer
  // load-bearing. The paragraph that used to be here claimed the app "treats
  // the browser's clock as event-time" because `startDate`s are
  // Institution-local and carry no offset. True when written; #243 ("resolve
  // every date in the Institution's timezone") made it false — `parseEventDate`
  // reads a naive `startDate` as Institution wall time, `dayKeyOf` resolves the
  // day key in `CHQ_ZONE`, `chqDateAt` builds instants from Institution parts.
  // Confirmed by running this whole suite under `Asia/Tokyo`: 36/36, identical
  // to Eastern. It is recorded as wrong rather than deleted because it
  // outlived its truth long enough to convince a later reader there was an
  // unfixed product bug.
  //
  // The *hour*, though, was load-bearing, and pinning the timezone never
  // addressed it. `11c ⟳ Now hides once back on today` failed on `main` at
  // 01:31Z, again at 01:58Z on a re-run, and passed on the same commit at
  // 10:17Z. Pinning the clock to that failing instant reproduces it exactly:
  //
  //     today=2026-08-19 anchor=2026-08-27
  //     mounted=2026-08-20,2026-08-21,2026-08-22 button=1
  //
  // Today is not mounted at all — once today's last event plus `Now`'s
  // one-hour grace has passed, today leaves the window, so ⟳ Now cannot land
  // on it and correctly stays visible. The app was right; the check's
  // assumption that today is always reachable was wrong.
  //
  // The boundary tracks the day's programming rather than the clock, which is
  // why no fixed "fails after N o'clock" rule ever fit: pinned to 01:30Z that
  // night `2026-08-19` is still mounted and `11c` passes; at 01:31Z it is gone
  // and it fails.
  //
  // So the clock is pinned below, and that — not the timezone — is what makes
  // these checks independent of when they run. It fixes a harness problem, not
  // a product one: whether `now` is evaluated in the Institution's timezone is
  // already settled in the app, and `verify-timezone.mjs` holds the standing
  // proof across `America/New_York`, `UTC`, `America/Los_Angeles` and
  // `Asia/Tokyo`.
  const ctx = await browser.newContext({
    viewport: { width, height },
    timezoneId: 'America/New_York',
  });
  const page = await ctx.newPage();
  // Shared with `verify-timezone.mjs`; see `fixedNow.mjs` for what is pinned
  // and, more importantly, what deliberately is not.
  //
  // `clock` overrides the run's shared instant. Checks 9 and 11 are its
  // callers (both via `navClock()`): each needs a `today` the reader can be
  // parked on, or a day the reader can navigate away from, which the real
  // today stops being once the season's tail goes sparse.
  await pinClock(page, clock);
  // Tie the context's lifetime to the page's. Callers only ever `page.close()`,
  // so without this every check leaks a whole `BrowserContext` — roughly twenty
  // of them across a run, each holding its own browser process resources.
  page.once('close', () => { ctx.close().catch(() => {}); });
  if (storage) {
    await page.addInitScript(([k, v]) => localStorage.setItem(k, v), storage);
  }
  await page.goto(URL, { waitUntil: 'networkidle' });
  // Off-season the default screen is the landing, not a day list; see
  // `regime.mjs` for what this does about it, and for why a page that seeded
  // a filter into storage has to opt out of reporting the regime (#287).
  await enterList(page, { seedsOwnFilter });
  return page;
}

const railChips = p => p.$$eval('[data-day-rail] [data-chip]', els => els.map(e => e.dataset.chip));
const anchorChip = p => p.$$eval('[data-day-rail] [data-chip][aria-current="date"]', e => e[0]?.dataset.chip ?? null);

/**
 * A rail chip far from where the reader is standing that a user can actually
 * tap.
 *
 * Checks 9 and 11 need "a day a long way from here" to prove that a tap
 * navigates and lands clear of the rail. Until #274 phase 4 that meant "past
 * the render window", and the anchor was the last *mounted* day. Every day of
 * the year is mounted now, so that anchor resolves to the last day of the
 * feed, every fallback below it is unreachable, and the target is always the
 * document's final day — which bottoms out against maximum scroll and makes
 * 9b/9c measure the clamp rather than the app.
 *
 * The anchor is therefore the day the reader actually lands on (`aria-current`
 * on the rail, i.e. today in season), and the target is picked from what the
 * rail itself declares tappable, in falling order of preference:
 *
 *  1. The first enabled chip at least 6 chips past the anchor with >= 10
 *     events on it and after it — a floor of content below the landing point
 *     so "scrolled to it" (9b) measures a real scroll rather than a
 *     document-bottom clamp (the season's last day has 1 event; jumping there
 *     bottoms out ~470px short of the rail through no fault of the app's).
 *  2. The farthest enabled chip past the anchor meeting the same content
 *     floor — the season's tail, where nothing 6+ days out is viable but
 *     nearer days are.
 *  3. The farthest enabled chip past the anchor — almost nothing left ahead;
 *     the tap is still exercised, and 9b's bottomed-out disjunct absorbs the
 *     clamp.
 *  4. The anchor itself — nothing enabled ahead of the reader at all
 *     (the season's final day). The checks degrade to the tap-lands-clear and
 *     ⟳-Now mechanics on a day that is already under them.
 *
 * A chip is picked from what the rail declares tappable, never by index: the
 * rail spans every calendar day in the navigable bounds, and a day with no
 * events is `aria-disabled` with a guarded onClick — tapping it does nothing,
 * by documented design (see DayRail.tsx and checks 14a2/14b, which assert
 * exactly that contract).
 */
async function pickFarTarget(page) {
  const chips = await page.$$eval('[data-day-rail] [data-chip]', els => els.map(e => ({
    key: e.dataset.chip,
    enabled: e.getAttribute('aria-disabled') !== 'true',
    // "…, 32 events" / "…, 1 event" / "…, no events" — the label format
    // checks 14a/14b hold stable. "no events" parses to 0 by falling
    // through the match.
    count: Number(/(\d+) events?$/.exec(e.getAttribute('aria-label') ?? '')?.[1] ?? 0),
  })));
  // Where the reader is standing, not where the document ends. Falls back to
  // the first chip when nothing is current (the archived-year and off-season
  // routes `enterList` takes), which keeps the whole rail ahead of the anchor.
  const anchor = await anchorChip(page);
  const from = Math.max(chips.findIndex(c => c.key === anchor), 0);
  // suffix[i] = events on chip i and every chip after it — an upper bound on
  // what can end up mounted below the landing point.
  const suffix = new Array(chips.length).fill(0);
  for (let i = chips.length - 1, acc = 0; i >= 0; i--) { acc += chips[i].count; suffix[i] = acc; }
  const qualifies = i => chips[i].enabled && suffix[i] >= 10;
  for (let i = from + 6; i < chips.length; i++) if (qualifies(i)) return chips[i].key;
  for (let i = chips.length - 1; i > from; i--) if (qualifies(i)) return chips[i].key;
  for (let i = chips.length - 1; i > from; i--) if (chips[i].enabled) return chips[i].key;
  return chips[from]?.key ?? null;
}
const railHeight = p => p.evaluate(() =>
  parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--day-rail-h')) || 0);

// Checks 1-5 are deleted, not skipped: #274 phase 4 removed their subjects
// from the app entirely, so there is nothing left for them to be right or
// wrong about.
//
//  - 1 "four scopes present" / 2 "mutual exclusion" — the `Now`/`Today`/
//    `All Season`/`All Year` date scopes no longer exist. `openFilters()`
//    went with them; it had no other caller.
//  - 3 "a persisted `this-week` migration" — `dateFilter` is no longer read
//    from storage at all, so the seed proved nothing. Its
//    `currentRegime() === 'off-season'` skip went with it.
//  - 4/5 "show earlier" — the render window is gone, so every day of the
//    year is mounted on load and there is no earlier to show. The button is
//    absent from `page.tsx`.

// -------------------------------------------------------------- 8. rail exists
{
  const page = await newPage();
  const chips = await railChips(page);
  check('8a rail renders chips', chips.length > 0, `${chips.length} chips, ${chips[0]}..${chips[chips.length - 1]}`);
  const h = await railHeight(page);
  check('8b --day-rail-h is measured, not 0', h > 0, `${h}px`);
  const role = await page.$eval('[data-day-rail]', e => `${e.getAttribute('role')}/${e.getAttribute('aria-label')}`);
  check('8c rail is a labelled group', role === 'group/Days', role);
  check('8d no role=menu anywhere', (await page.$$('[role=menu]')).length === 0);

  // Highlight tracks scroll.
  //
  // Two things about this are load-bearing since #274 phase 4, and both of
  // them made it fail on a correct app first.
  //
  // **It moves from wherever the reader landed, not from the top.** The
  // document is the whole year now and the load lands on today, so the
  // second day section of the document (`secs[1]`, early January) is ~149,000px
  // BEHIND the reader. Scrolling to it measured `2026-08-26 → 2026-08-26`:
  // the highlight had not failed to track, the check had asked it to track a
  // move it never made.
  //
  // **It scrolls with a wheel, not `window.scrollTo`.** The load landing arms
  // `useDayAnchor`'s settle hold on today, and that hold re-asserts the day's
  // position on any later layout change until a real gesture cancels it — a
  // programmatic scroll is not one, so the app simply pulls the reader back.
  // This is the same trap `regime.mjs`'s `settleAtTop` documents from the
  // other direction.
  //
  // **The direction is chosen from the document's own headroom.** It was
  // hardcoded forward until the 2026 season's tail went sparse, and then
  // forward stopped existing. Measured on 2026-08-31 against the live feed,
  // at the instant `enterList` returned:
  //
  //     scrollY 161,024   scrollHeight 161,924   innerHeight 900
  //     maxScroll 161,024   remaining 0px
  //     2026-08-30 top -1,414 (17 events)   2026-08-31 top 213 (2 events)
  //     2026-09-10 top 468 (1 event, the season's last)
  //
  // The reader lands at the very bottom of the document because the landing
  // scrolls toward today and the clamp stops it there: today's section plus
  // the one day left after it is 371px of content, and it takes 900 to fill
  // the viewport. A 333px wheel forward moved the page 0px, so the highlight
  // had nothing to follow and the check reported `2026-08-30 → 2026-08-30`
  // on an app doing exactly the right thing.
  //
  // Backwards there were 161,024px of headroom, and it is the same mechanism:
  // `resolveAnchor` walks the day tops against the sticky offset on a
  // rAF-throttled scroll listener, and it does not care which way the reader
  // went. So the check asks the document which way it can still move, moves
  // that way, and prints the direction it chose.
  //
  // **The plan is computed from the document, never from the rail.** The
  // first version of this fix asked "which side of the reported anchor has
  // headroom", and falsifying it caught that immediately: with
  // `useDayAnchor`'s scroll listener deleted the rail reported a stale
  // `2026-01-03` while the reader stood at the bottom of the document, so the
  // anchor's own index said there was nothing behind it, and the check SKIPPED
  // on the one build it exists to catch. The rail's answer is the thing under
  // test; it cannot also be the thing that decides whether the test can run.
  // `geo` below is therefore the last header at or above the sticky line as
  // the DOM actually lays it out, and every delta is measured from that.
  const a0 = await anchorChip(page);
  const plan = await page.evaluate(anchor => {
    const secs = [...document.querySelectorAll('[data-day-key]')];
    const railH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--day-rail-h')) || 0;
    const top = j => secs[j].getBoundingClientRect().top;
    const ahead = Math.round(
      document.documentElement.scrollHeight - window.innerHeight - window.scrollY);
    const behind = Math.round(window.scrollY);
    // The section the geometry says is current — the same walk `resolveAnchor`
    // performs, done here independently. `-1` when the reader is above every
    // header.
    let geo = -1;
    for (let j = 0; j < secs.length; j++) if (top(j) <= railH + 1) geo = j;
    const at = j => (secs[j] ? { key: secs[j].dataset.dayKey, top: Math.round(top(j)) } : null);
    // Forward: push the first header BELOW the line just past it — the exact
    // moment the highlight must advance. Overshoot generously; a 5px margin is
    // inside the noise of a settling document, and day sections run to
    // thousands of px, so +200 still crosses only this one header.
    //
    // The target skips over any header that already carries the reported
    // anchor, because moving that one cannot change what the rail says either
    // way. That case is the whole off-season bootstrap: `settleAtTop` leaves
    // the reader ABOVE every header, so `geo` is -1 while the rail still
    // reports the year's first day — and targeting `geo + 1` there would have
    // aimed at that very day and stood the check down on a page it can
    // perfectly well measure. It aims one further instead.
    let fj = geo + 1;
    while (secs[fj] && secs[fj].dataset.dayKey === anchor) fj++;
    const f = secs[fj] ? Math.round(top(fj) - railH + 200) : null;
    if (f !== null && f > 0 && f <= ahead) {
      return { delta: f, direction: 'forward', ahead, behind, geo: at(geo), to: at(fj) };
    }
    // Backward: pull the current header back down below the line, which hands
    // the highlight to some earlier day. WHICH earlier day is not asserted and
    // must not be — a thin predecessor can be stepped over — only that the
    // highlight left `a0`. 400px of slack so there is real content left above
    // to anchor on: `useDayAnchor` leaves the anchor untouched when its walk
    // resolves nothing, and an anchor that did not move is how this fails.
    //
    // Symmetric with the forward walk above, and for the same reason: if the
    // rail is reporting the day BELOW where the geometry says the reader is —
    // one frame of lag is enough — then pushing `secs[geo]` down would land the
    // highlight on the very day `a0` already names, and the check would report
    // a false FAIL against a rail that is merely a frame behind. So it keeps
    // walking back past any header whose predecessor already carries `a0`.
    let bj = geo;
    while (bj >= 1 && secs[bj - 1].dataset.dayKey === anchor) bj--;
    const b = bj >= 1 ? Math.round(top(bj) - railH - 200) : null;
    if (b !== null && b < 0 && -b + 400 <= behind) {
      return { delta: b, direction: 'backward', ahead, behind, geo: at(geo), to: at(bj - 1) };
    }
    return { delta: null, direction: null, ahead, behind, geo: at(geo), to: null };
  }, a0);
  if (plan.delta === null) {
    // Not a failure and not silent. The whole document fits inside the
    // viewport, or the reader is pinned against both ends of it, so there is
    // no scroll for a highlight to follow in either direction and the check
    // has no subject at all. `8a` and `enterList` are what would catch an
    // empty list; this is only about headroom.
    skip('8e highlight follows scroll',
      `no day header can be moved across the sticky line in either direction — ` +
      `${plan.ahead}px ahead, ${plan.behind}px behind, ` +
      `geometry says ${JSON.stringify(plan.geo)}, rail says ${a0}`);
  } else {
    await page.mouse.move(450, 500);
    await page.mouse.wheel(0, plan.delta);
    await page.waitForTimeout(900);
    const a1 = await anchorChip(page);
    check('8e highlight follows scroll', !!a0 && !!a1 && a0 !== a1,
      `${a0} → ${a1} (wheeled ${plan.delta}px ${plan.direction} toward ` +
      `${plan.to.key}; ${plan.ahead}px ahead, ${plan.behind}px behind)`);
  }
  await page.close();
}

// ------------------------------------ a `today` the reader can be PARKED on
//
// Surveyed once, here, because two blocks below need it: check 9 (does a rail
// tap navigate) and check 11 (⟳ Now). Both are about a reader moving away from
// today and both stop having a subject at the end of a season — see
// `surveyPinnableToday` in `regime.mjs` for the measurements and the reasoning.
//
// Placed after check 8 so an ordinary unpinned page has already established
// the regime; this survey page is itself ordinary and would establish it
// equally well, but a reader following the file top to bottom should meet the
// regime before the first thing that branches on it.
const survey = await newPage();
const PIN = await surveyPinnableToday(survey);
await survey.close();

// `after >= 7`, and the number is not arbitrary: `pickFarTarget`'s first rule
// looks for a tappable chip at least **6** chips past the anchor, so a day with
// fewer than 7 days behind it can only ever reach that rule's fallbacks. Chips
// span every calendar day and event days are a subset of them, so this is the
// weaker of the two questions — it cannot guarantee rule 1 lands, only that it
// is not arithmetically excluded. (`verify-full-list` asks the same survey for
// `>= 3`: its landing checks need the pinned day to sit comfortably inside the
// document, not to support a navigation away from it.)
const pinnable = !!PIN && PIN.parkable && PIN.after >= 7;
const pinTell = PIN ? `clock pinned to ${PIN.key}` : 'no day sections mounted at all';
const unpinnable = PIN
  ? `the middle mounted day ${PIN.key} is not a viable today: docTop=${PIN.docTop} ` +
    `maxScroll=${PIN.maxScroll} parkable=${PIN.parkable} days after it=${PIN.after}`
  : 'no day sections mounted at all';
/**
 * ...and never off-season.
 *
 * Pinning a page to a mid-season day during an off-season run would make it the
 * one page in that run to find a day list on the default screen, `enterList`
 * would announce `in-season`, and `announce`'s consistency rule would take the
 * suite — and the five chained after it — down mid-run with a stack trace and
 * no summary. That is #287, reached from a new direction; it was measured
 * happening in `verify-full-list` before this guard existed there.
 *
 * Nothing is lost by it. Check 11 skips off-season on its own account, and
 * check 9's off-season page navigates perfectly well unpinned: `enterList`
 * leaves the reader at the top of a ~161,000px document, so a far tap has
 * somewhere to go and cannot bottom out.
 */
const pinNav = pinnable && currentRegime() !== 'off-season';
const navClock = () => (pinNav ? { clock: atMidMorning(PIN.key) } : {});

// --------------------------------------------------- 9. rail tap lands clear
//
// **Pinned like check 11, and it took a review to notice that it had to be.**
// This block runs `pickFarTarget` on the same live feed, and at the season's
// tail the tap is a no-op for the same reason: the reader lands bottomed out,
// every enabled chip left is at or below where they already are, and the page
// does not move. 9b then passed through its own `bottomedOut` disjunct and 9c
// passed because the target's top (468) happened to clear the rail (80).
//
// Measured, by deleting `onSelectDay(chip.key)` from the chip's `onClick` and
// rebuilding: `PASS 9b top=468.0px bottomedOut=true` / `PASS 9c top=468.0
// railH=80` — **two checks green against a rail tap that navigated nowhere.**
// Exactly the vacuity diagnosed one block below for 11a, in the same file,
// against the same helper.
if (!pinNav && currentRegime() !== 'off-season') {
  skip('9b scrolled to it', unpinnable);
  skip('9c lands below the rail, not under it', unpinnable);
} else {
  const page = await newPage(navClock());
  // A tappable day a long way from where the reader is standing. See
  // pickFarTarget for why "tappable" is load-bearing.
  const target = await pickFarTarget(page);
  await page.evaluate(k => document.querySelector(`[data-day-rail] [data-chip="${k}"]`).click(), target);
  await page.waitForTimeout(1800);
  // `9a tapped day mounts` was DELETED here rather than left green. It
  // asserted that `[data-day-key="<target>"]` was in the DOM after the tap,
  // which was a real claim while a render window decided which days existed:
  // the tap had to outrun it, and the header above still said so. #274 phase
  // 4 mounts every day of the year on load, so the section is in the DOM
  // BEFORE the click — the check passes with the chip's entire `onClick` body
  // removed. What the tap must still do is move the reader to that section,
  // and that is 9b and 9c, which do fail on that defect.
  //
  // The measurement below returns null rather than throwing when the section
  // is absent: an exception inside `evaluate` aborts the whole script, where
  // a missing target should fail 9b and 9c by name, with the reason printed.
  const m = await page.evaluate(k => {
    const el = document.querySelector(`[data-day-key="${k}"]`);
    if (!el) return null;
    return {
      top: el.getBoundingClientRect().top,
      railH: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--day-rail-h')) || 0,
      // This RELAXES 9b: the strict form is "section top within 400px of the
      // viewport top", and this alternative accepts "the page scrolled to the
      // very end of a document it actually had to scroll" instead.
      //
      // **It is a floor now, not a working branch, and the clock pin above is
      // why.** It was written for the season's last days, where the target is
      // so near the rail's end that less than a viewport of content lies below
      // it and the scroll clamps before the section reaches the rail
      // (2026-08-28 with the live feed: target 09-10 stopped 468px short). That
      // is precisely the regime in which it was ABSORBING a dead rail tap
      // rather than tolerating a clamp — so in season the page is now pinned to
      // a mid-season day, where `pickFarTarget`'s first rule finds a target with
      // a floor of content below it and this disjunct cannot fire at all.
      //
      // Kept rather than deleted because one reachable path is still unpinned:
      // off-season, where `enterList` has to tap a rail chip to produce a list
      // and pinning would break the run's regime consistency (see `pinNav`).
      // Both conditions below stay required: without the scrollHeight guard a
      // document that simply fits the viewport satisfies `scrollY(0) +
      // innerHeight >= scrollHeight` untouched.
      bottomedOut: document.documentElement.scrollHeight > window.innerHeight + 2
        && window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2,
    };
  }, target);
  const missing = `${target} is not mounted at all`;
  check('9b scrolled to it', !!m && (Math.abs(m.top) < 400 || m.bottomedOut),
    m ? `top=${m.top.toFixed(1)}px bottomedOut=${m.bottomedOut} (${pinTell})` : missing);
  check('9c lands below the rail, not under it', !!m && m.top >= m.railH - 2,
    m ? `top=${m.top.toFixed(1)} railH=${m.railH} (${pinTell})` : missing);
  await page.close();
}

// ------------------------------------------- 10. narrow-phone chip count
//
// #274 phase 2's follow-up: an iPhone 13 mini (375pt) user reported the day
// strip down to one full chip and two slivers. Measured cause: the two
// chevrons (`min-w-11` each) plus a text-sized `⟳ Now` (no `min-w-11`, the
// rail's one non-square control) were eating ~148px of a 375px rail before a
// single chip was drawn. Both chevrons are now gone and `⟳ Now` is
// icon-only, which is what checks 10a-10c used to guard directly — they
// asserted the chevrons existed and moved the anchor, which no longer means
// anything once the controls are gone.
//
// This replaces them with a check on the property the user actually cares
// about: how much of a 375pt rail the day strip itself gets. Not hard-coded
// to 44px — a chip's width is read from the rendered DOM, so this keeps
// working if the chip's own size is ever changed on purpose. Falsified by
// temporarily adding a wide control back to the rail and confirming this
// drops below 4 (see the narrow-phone-rail plan doc and commit history for
// that run).
//
// Measured with every optional control present, not on the fresh, unscrolled
// landing state: a first load has the anchor on today, so `⟳ Now` is hidden,
// which understates real crowding and would leave this check unable to catch
// the very regression it exists for. A far chip tap moves the anchor off
// today, revealing it (same as check 11).
//
// **Threshold raised from 4 to 5 in #274 phase 3**, and the raise is the
// point. That phase moved the Filters funnel off the rail and into the site
// header, freeing its 44px plus a 4px gutter: measured 191px of strip (4.06
// chips) before, 239px (5.06) after. A threshold left at 4 would be a guard
// that had stopped guarding — it would pass with the funnel put straight back
// and the reader down to four chips again, which is the state the bug report
// was about.
//
// `filtersVisible` is asserted rather than merely reported for the same
// reason: it is now a claim about where that control lives, not a note about
// which controls happened to be on screen.
{
  const page = await newPage({ width: 375, height: 812 });
  const far = await pickFarTarget(page);
  await page.evaluate(k => document.querySelector(`[data-day-rail] [data-chip="${k}"]`).click(), far);
  await page.waitForTimeout(1200);
  await page.mouse.wheel(0, 2000);
  await page.waitForTimeout(700);
  const { stripWidth, chipWidth, pitch, nowVisible, filtersVisible } = await page.evaluate(() => {
    const strip = document.querySelector('[data-rail-strip]');
    const chips = [...document.querySelectorAll('[data-day-rail] [data-chip]')];
    const [a, b] = chips;
    return {
      stripWidth: strip ? strip.getBoundingClientRect().width : 0,
      chipWidth: a ? a.getBoundingClientRect().width : 0,
      // The distance from one chip's left edge to the next one's — the real
      // repeat unit, chip plus gutter. MEASURED from two adjacent chips rather
      // than read from `RAIL_CHIP_GUTTER_PX`, for the same reason the chip
      // width is measured: a constant the browser turned out not to honour is
      // exactly what this check exists to catch.
      pitch: a && b
        ? b.getBoundingClientRect().left - a.getBoundingClientRect().left
        : 0,
      nowVisible: !!document.querySelector('[data-day-rail] button[aria-label="Go to today"]'),
      filtersVisible: !!document.querySelector('[data-day-rail] button[aria-label="Filters"]'),
    };
  });
  // How many chips actually FIT, which is not `strip / chipWidth`: chips are
  // laid out with a gutter between them, so n of them occupy
  // `n*chip + (n-1)*gutter`. Dividing by the chip alone silently credits the
  // strip with the gutters it also has to pay for, and overstates the count by
  // roughly 8% at these sizes — enough to let the guard read 4.0 while the
  // reader can see fewer than four. Solving that inequality for n gives
  // `(strip + gutter) / pitch`.
  const gutter = pitch > 0 && chipWidth > 0 ? pitch - chipWidth : 0;
  const chipsWorth = pitch > 0 ? (stripWidth + gutter) / pitch : 0;
  check('10 day strip holds at least 5 chips at 375pt, with no funnel on the rail',
    chipsWorth >= 5 && !filtersVisible,
    `strip=${stripWidth.toFixed(1)}px chip=${chipWidth.toFixed(1)}px ` +
    `gutter=${gutter.toFixed(1)}px pitch=${pitch.toFixed(1)}px ≈ ${chipsWorth.toFixed(2)} chips ` +
    `(⟳Now=${nowVisible} Filters=${filtersVisible})`);
  await page.close();
}

// ------------------------------------------------------------------ 11. ⟳ Now
if (currentRegime() === 'off-season') {
  skip('11 ⟳ Now',
    'today is outside navBounds off-season, so reachableTodayKey is null and ' +
    'the button is correctly absent (page.tsx) — there is no navigation back ' +
    'to today left to test');
} else if (!pinnable) {
  // Narrow, measured, and self-describing — and, unlike the off-season skip
  // above, not a state any real season reaches: it needs the year's MIDDLE
  // mounted day to be unparkable or to have fewer than 7 days behind it. The
  // sparse tail this block exists to survive is at the END of a year, with
  // half a document of margin between it and the middle.
  skip('11 ⟳ Now', unpinnable);
} else {
  // ---------------------------------------------------------------------
  // This check pins its own clock, and that is the second thing #249 had to
  // remove to keep it honest.
  //
  // `⟳ Now` renders on `todayKey && anchorDay !== todayKey` (DayRail.tsx), so
  // the whole of check 11 — appears when away, changes no filter, hides when
  // back — needs a `today` the reader can actually be parked on. #249 removed
  // the *hour* from that assumption after 11c went red at night and green in
  // the morning on the same commit. What went red on `main` on 2026-08-31 is
  // the *date*: the season's tail ran out of content, and once it has, no
  // scroll position exists that puts today's header under the rail.
  //
  // Measured against the live feed at the instant `enterList` returned:
  //
  //     today 2026-08-31, mounted, 2 events; 2026-09-10 after it, 1 event
  //     scrollY 161,024 === maxScroll   scrollHeight 161,924   innerHeight 900
  //     today's section top 213px, sticky offset 81px, shortfall 133px
  //
  // Nothing in check 11 moved the page at all. The far tap could not (rule 3
  // picked 2026-09-10, which is below today in an already-bottomed-out
  // document), so 11a passed on a button that had been on screen since load
  // and 11b compared a state to itself across a navigation that never
  // happened — both vacuous — and 11c asked for an anchor the document cannot
  // reach and correctly failed. The app is right in every one of those.
  //
  // So the check runs on a day where its own subject exists, derived from the
  // live feed each run rather than hardcoded: the middle mounted day of the
  // year, which by construction has about half the season on each side of it.
  // Everything below the clock is unchanged and strict — the button must
  // appear, must preserve the reader's state, and must hide again.
  //
  // What this gives up, plainly: check 11 no longer says anything about the
  // real today. It cannot — that is the finding, not a shortcut around it.
  // The one path is pinned every run rather than only in the tail, because a
  // branch that runs two weeks a year is a branch that rots between Septembers
  // (`verify-offseason.mjs` exists for that exact reason, and derives its
  // pinned instants from the feed the same way).
  //
  // `surveyPinnableToday` (regime.mjs) picks the day and carries the rest of
  // the reasoning, including why a page pinned to the run's own clock can
  // measure the document the pinned page will get. `verify-full-list`'s
  // landing checks pin the same way for the same reason.
  //
  // Seeded with a value the reader could plausibly have left behind, and
  // that is 11b's whole subject — see the comment on `filterState` below.
  // `expandedDescriptions` is chosen because it is persisted and restored
  // like every other field but filters nothing, so the seed cannot disturb
  // 11a or 11c by narrowing the list. The id matches no event in any feed.
  const SENTINEL = 'e2e-11b-sentinel';
  // `lastSaved` from the PAGE's pinned instant, never Node's `Date.now()`.
  // #290 found the other two seeds in this file discarded outright whenever
  // the two clocks were more than `USER_STATE_EXPIRY_MS` apart, and this one
  // is pinned further from the wall clock than either of those.
  const PINNED_TODAY = atMidMorning(PIN.key);
  const page = await newPage({
    clock: PINNED_TODAY,
    storage: ['chq-calendar-user-state', JSON.stringify({
      expandedDescriptions: [SENTINEL], lastSaved: PINNED_TODAY.getTime(),
    })],
  });
  // Same tappable-target rule as check 9 — the old blind index landed on an
  // aria-disabled chip in the season's tail and the tap was a no-op, so ⟳
  // Now never had a navigation to appear after.
  const far = await pickFarTarget(page);
  await page.evaluate(k => document.querySelector(`[data-day-rail] [data-chip="${k}"]`).click(), far);
  await page.waitForTimeout(1500);
  const nowBtn = page.getByRole('button', { name: 'Go to today' });
  const appeared = await nowBtn.count() > 0;
  // 11a is STRICT: the button appeared, full stop.
  //
  // It used to carry a `bottomedOut` alternative that accepted the button's
  // absence when the anchor was still on today and the page had scrolled to
  // the end of a document it actually had to scroll. That was written for "the
  // season's last mounted days", and the clock pin above deletes that regime
  // from this block entirely — the day is chosen with half a year behind it, so
  // the disjunct could no longer fire under any input.
  //
  // Deleted rather than documented as unreachable, and the distinction matters:
  // an unreachable disjunct is a path that silently starts absorbing defects
  // the day something upstream changes, and the `pinnable` guard above already
  // covers every degenerate feed the relaxation was standing in for. It also
  // described the wrong failure. It predicted this exact date — "2026-08-31
  // with the live feed: today has 2 events, one 1-event day follows" — and
  // predicted that the anchor would STAY on today with the button correctly
  // absent. What actually happened is that the anchor never REACHES today, so
  // the button was permanently present and 11a passed on a button that had been
  // on screen since load, across a tap that moved the page 0px.
  const [anchorNow, todayNow] = await Promise.all([
    anchorChip(page),
    page.evaluate(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())),
  ]);
  check('11a ⟳ Now appears once away from today', appeared,
    `far=${far} anchor=${anchorNow} today=${todayNow} button=${appeared} (${pinTell})`);
  if (appeared) {
    // Read from persisted state, not from `button[aria-pressed]`.
    //
    // This check used to diff the pressed date-scope buttons. #274 phase 4
    // deleted every one of them, and no other control in the app carries
    // `aria-pressed`, so both sides of that comparison became the empty
    // string and the check passed no matter what ⟳ Now did — it could not
    // fail. The filters that survive the phase (search, categories, venues,
    // favourites) are all in `chq-calendar-user-state`, so that is what
    // "changes no filter" now means, plus the day set the list renders.
    //
    // That first repair was not enough on its own, which is the point of the
    // SENTINEL above. Read on a page nobody has filtered, every field in the
    // payload is already at its default — so a ⟳ Now that wiped the reader's
    // state outright would write those same defaults back and the comparison
    // would still hold. The check had a real subject and no VALUE to lose.
    // Seeding one non-default field before the navigation gives it one.
    //
    // The whole payload is compared rather than a hand-picked four fields,
    // minus `lastSaved` (which the persistence effect rewrites on every
    // commit, so it differs across any two reads and would fail always).
    // Keys are sorted so the comparison cannot turn on property order.
    const filterState = () => page.evaluate(() => {
      const raw = localStorage.getItem('chq-calendar-user-state');
      const s = raw ? JSON.parse(raw) : {};
      delete s.lastSaved;
      const sorted = {};
      for (const k of Object.keys(s).sort()) sorted[k] = s[k];
      sorted.days = document.querySelectorAll('[data-day-key]').length;
      return JSON.stringify(sorted);
    });
    const scopeBefore = await filterState();
    await nowBtn.click();
    await page.waitForTimeout(1500);
    const scopeAfter = await filterState();
    check('11b ⟳ Now changes no filter',
      scopeBefore === scopeAfter && scopeBefore.includes(SENTINEL),
      scopeBefore.includes(SENTINEL)
        ? `${scopeBefore} → ${scopeAfter}`
        : `the seeded sentinel never reached persisted state, so this check ` +
          `had nothing to preserve: ${scopeBefore}`);

    // Reported with its state on purpose. `11c` has failed on `main` at night
    // and passed the same commit in the morning, and every previous
    // investigation had to guess at the cause because this check printed
    // nothing but its own name — the log line was `11c ⟳ Now hides once back
    // on today:` with an empty detail. Whatever the cause turns out to be,
    // the next failure should be able to state it: what the app thinks today
    // is, where the anchor actually landed, and which days are mounted.
    const stillThere = await page.getByRole('button', { name: 'Go to today' }).count();
    const landedOn = await anchorChip(page);
    // Summarised, not listed. The original failure this diagnostic was
    // written for was "today is not mounted at all", and it printed every
    // mounted day key uncapped so that today could not be truncated out of
    // the evidence — a short array back when a render window decided what
    // existed. #274 phase 4 mounts the whole year, so the honest form of the
    // same evidence is the count, the ends, and the one membership question
    // that was ever being asked.
    const [appToday, mounted] = await page.evaluate(() => {
      const keys = [...document.querySelectorAll('[data-day-key]')].map(e => e.dataset.dayKey);
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
      return [today, {
        count: keys.length,
        first: keys[0] ?? null,
        last: keys[keys.length - 1] ?? null,
        todayMounted: keys.includes(today),
      }];
    });
    check('11c ⟳ Now hides once back on today', stillThere === 0,
      `today=${appToday} anchor=${landedOn} mounted=${mounted.count} ` +
      `(${mounted.first}..${mounted.last}, todayMounted=${mounted.todayMounted}) ` +
      `button=${stillThere}`);
  } else {
    // Printed, not silent. 11b and 11c live inside this branch, and before
    // #297's successor a false `appeared` simply erased both of them from the
    // run — 44 lines of output with no hint that two checks had not happened.
    // With the clock pinned to a parkable day this should be unreachable; if
    // it is ever reached, the log has to say which checks did not run and why.
    const reason = '⟳ Now never appeared, so there was no navigation back to ' +
      'today to test — see 11a for the geometry that produced it';
    skip('11b ⟳ Now changes no filter', reason);
    skip('11c ⟳ Now hides once back on today', reason);
  }
  await page.close();
}

// ------------------------------------------- 12. sticky stack, narrow + zoomed
for (const [label, width, zoom] of [['320px', 320, 1], ['200% zoom', 900, 2]]) {
  const page = await newPage({ width, height: 800 });
  if (zoom !== 1) {
    await page.evaluate(z => { document.documentElement.style.fontSize = `${16 * z}px`; }, zoom);
    await page.waitForTimeout(600);
  }

  // Take ownership of the scroll position before parking anywhere.
  //
  // `enterList` returns as soon as the first day section exists, which is
  // BEFORE the app has finished moving: in season it lands the reader on
  // today, and `useDayAnchor`'s hold then re-asserts that position on every
  // later layout change. Neither is cancelled by `window.scrollBy`, which is
  // all the parking loop below uses — so the harness would park on a day in
  // June, and the app would put the reader back on today underneath it.
  //
  // With the whole year mounted (#274 phase 4) that is a ~149,000px
  // correction, and `roomy()` picks the first tall day of the YEAR rather
  // than one near today, so the two are now always far apart. Measured on
  // this list: parked at scrollY 3,561, measured 300ms later at 152,663 —
  // `headerTop -148,557` against a `railBottom` of 140. CI failed on exactly
  // that, at 320px, on two commits running.
  //
  // One real wheel tick settles it in either order: arriving before the
  // landing it arms `useInitialLanding`'s takeover guard, and arriving after
  // it cancels the hold. Reproduced and fixed at 1x, 4x and 8x CPU throttle —
  // it is an ordering bug, not a slow-machine one, which is why it passed
  // locally and failed in CI on identical code.
  //
  // A wheel, not `window.scrollTo`, for the reason `settleAtTop` records:
  // only a real gesture cancels the hold.
  await page.mouse.move(Math.round(width / 2), 400);
  await page.mouse.wheel(0, 1);
  await page.waitForTimeout(800);

  // Park deliberately inside a day whose header is genuinely stuck, rather
  // than scrolling a fixed distance and measuring whatever is there.
  //
  // `mouse.wheel(0, 1800)` used to do the latter, and where 1800px lands
  // depends on how many events the current scope is showing — so it depended
  // on the wall-clock hour. At 200% zoom it landed in the gap between two
  // days: the outgoing header was being pushed up by the end of its own
  // section (correct `position: sticky` behaviour, bounded by its containing
  // block) while the next day's header had not reached the rail yet. Nothing
  // was stuck, so there was nothing for the assertion below to be about, and
  // it failed on `main` as well as on every branch.
  //
  // Iterated rather than scrolled once: sections carry `content-visibility:
  // auto`, so a section's real height replaces its `contain-intrinsic-size`
  // estimate as it comes into view — which moves the target out from under a
  // single computed delta. (Until #274 phase 4 the render window mounting
  // more days as the reader descended did the same thing, and was the reason
  // recorded here.) Loop until the section is actually in position, then
  // stop.
  const parked = await page.evaluate(async () => {
    const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    // Null-returning rather than throwing: an exception inside `evaluate`
    // aborts the whole script, where every other failure in this harness is
    // reported as a named check with the value it measured.
    const railBottom = () => {
      const rail = document.querySelector('[data-day-rail]');
      return rail ? rail.getBoundingClientRect().bottom : null;
    };
    // `[data-day-header]` rather than `.sticky`: the attribute is the declared
    // DOM contract (`DAY_SECTION_ATTR`'s neighbour in `daySections.ts`), while
    // the class is a Tailwind utility that would silently match any other
    // sticky descendant a section gained later.
    const headerOf = (sec) => sec.querySelector('[data-day-header]');

    if (railBottom() === null) return { ok: false, why: 'no day rail on the page' };

    // A day tall enough that its header is still stuck once we are inside it:
    // it must outlast the rail, its own header, and the margin we park at.
    const MARGIN = 120;
    const roomy = () => [...document.querySelectorAll('[data-day-key]')].find((e) => {
      const header = headerOf(e);
      if (!header) return false;
      const bottom = railBottom();
      if (bottom === null) return false;
      return e.getBoundingClientRect().height
        > bottom + header.getBoundingClientRect().height + MARGIN * 2;
    });

    // Search across everything mounted, retrying as the document settles.
    //
    // This loop was written for a list that grew: the first render mounted
    // only enough days to reach RENDER_BATCH_EVENTS, and more arrived as an
    // IntersectionObserver on a bottom sentinel was tripped, so choosing a
    // target from the initially-mounted set alone made the check depend on
    // whether the first batch happened to contain a tall day. #274 phase 4
    // deleted the render window, the sentinel and the observer: every day of
    // the year is mounted in the first commit, so `roomy()` finds its target
    // on the first call and the loop below exits without ever scrolling.
    //
    // It is kept rather than deleted because its exit condition is still the
    // honest one — it stops the moment the mounted count stops changing,
    // which is now immediately — and because `roomy()` reads
    // `getBoundingClientRect().height` on sections the browser may have
    // SKIPPED under `content-visibility: auto`, where that height is the
    // `contain-intrinsic-size` estimate rather than a real measurement. The
    // estimate is close enough for this purpose (measured 2,988px against a
    // real 2,851px on the same section, ~5%), so a day picked by estimate is
    // genuinely tall — but the retry is the thing that would absorb it if
    // that ever stopped being true.
    let target = roomy();
    for (let grow = 0; grow < 20 && !target; grow++) {
      const before = Math.round(window.scrollY);
      window.scrollBy(0, window.innerHeight);
      await frame();
      await frame();
      target = roomy();
      // The document will not scroll any further and nothing tall enough has
      // come into view — more scrolling cannot help, so stop rather than spin
      // out the loop.
      //
      // Keyed on the SCROLL POSITION. It used to break when the mounted day
      // COUNT stopped growing, which said the same thing while a render
      // window mounted days as the reader descended. #274 phase 4 mounts
      // every day up front, so that count is a constant and this loop broke
      // after its FIRST scroll — having scanned one viewport of a list it
      // exists to scan the length of.
      if (!target && Math.round(window.scrollY) === before) break;
    }
    if (!target) {
      return { ok: false, why: 'no mounted day was tall enough to hold a stuck header, even after scrolling to the end of the list' };
    }

    const key = target.dataset.dayKey;

    // How far the target is from where we want it. Aim to sit MARGIN pixels
    // past the section's start, so the header has stuck and the section has
    // not yet begun pushing it back out.
    const offBy = () => {
      const sec = document.querySelector(`[data-day-key="${key}"]`);
      if (!sec) return { why: `target day ${key} left the DOM while homing in on it` };
      const bottom = railBottom();
      if (bottom === null) return { why: 'the day rail left the page while homing in' };
      return { delta: sec.getBoundingClientRect().top - bottom + MARGIN };
    };

    // Wait until the document stops growing under us. Returns whether it
    // actually stopped, so a page that never settles is reported as that
    // rather than as a scroll that missed.
    // Bounded at 4s per call (40 samples), and only an attempt that has
    // already parked pays it — so a normal run spends one or two of these at
    // the ~400ms floor and a pathological one exhausts the 25 attempts in
    // well under two minutes and fails with a reason.
    //
    // The floor is 400ms and four samples, not 300 and three: the first
    // sample only sets `last` (it compares against the -1 sentinel), so
    // three *consecutive equal* readings need a baseline before them.
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const heightHolds = async () => {
      let last = -1, same = 0;
      for (let i = 0; i < 40 && same < 3; i++) {
        await sleep(100);
        const h = document.documentElement.scrollHeight;
        if (h === last) same++; else { same = 0; last = h; }
      }
      return same >= 3;
    };

    let stalled = false;
    for (let i = 0; i < 25; i++) {
      const at = offBy();
      if (at.why) return { ok: false, why: at.why };
      if (Math.abs(at.delta) > 2) {
        window.scrollBy(0, at.delta);
        await frame();
        continue;
      }

      // Parked — but only for this frame, and that was #290.
      //
      // `enterList` lands the reader on today, which with the whole year
      // mounted (#274 phase 4) is ~158,000px down a ~172,000px document,
      // while `roomy()` picks the first tall day of the YEAR. So the scroll
      // above is a ~152,000px jump back up, and it lands among ninety day
      // sections the browser has never laid out: they carry
      // `content-visibility: auto`, so each is still reporting its
      // `contain-intrinsic-size` estimate rather than a measured height.
      // Coming into view they swap one for the other and the document grows
      // — measured here, 169,546 to 172,664, ~3,100px of it ABOVE the target.
      // Chromium's scroll anchoring absorbs some of that (+478px of the
      // +2,292 in the run below) and the remainder moves the target down.
      //
      // Which frame the growth lands in is the whole of the flake. It used to
      // arrive after this loop returned, inside the caller's 300ms wait, and
      // check 12 then measured a header 277 to 547px below the rail on a page
      // that had already confirmed it flush — roughly one run in four:
      //
      //     i=0 y=158,026 delta=-152,828 h=169,546
      //     i=1 y=  5,198 delta=       0 h=169,546   <- old loop returned here
      //         y=  5,676 delta=     547 h=172,716   <- 17ms later
      //
      // The app is not exposed to this: `useDayAnchor`'s hold exists for
      // exactly this ("a scroll decision invalidated by content changing
      // height after it was made") and re-asserts the tapped day on every
      // resize. The harness disarms it on purpose with the `mouse.wheel(0, 1)`
      // above, because it would otherwise pull the reader back to today
      // underneath this loop — so having disarmed it, the loop has to do the
      // hold's job itself. It is the same correction, driven by a settled
      // document height rather than by a ResizeObserver.
      //
      // BOTH conditions, and `held` is not decoration. A document that never
      // stopped growing can still read `<= 2` for the one frame it is
      // sampled in — which is the same coincidence this whole block exists to
      // stop trusting, merely made four seconds less likely. Requiring the
      // height to have actually held is what makes the code enforce what the
      // paragraph above claims. An unsettled page loops instead, and if it
      // never settles it exhausts the attempts and is reported as that,
      // rather than passing on a lucky sample.
      const held = await heightHolds();
      stalled = !held;
      const after = offBy();
      if (after.why) return { ok: false, why: after.why };
      if (held && Math.abs(after.delta) <= 2) return { ok: true, key };
    }
    // Distinct from the search failure above: a day WAS found, the scroll just
    // never settled on it. Worth telling apart — one is about the fixture, the
    // other about the page moving under the scroll.
    return {
      ok: false,
      why: `scroll did not settle on ${key} within 25 attempts` +
        (stalled ? ' — the document never stopped changing height' : ''),
    };
  });
  await page.waitForTimeout(300);

  const geom = !parked.ok ? null : await page.evaluate((key) => {
    const rail = document.querySelector('[data-day-rail]');
    const sec = document.querySelector(`[data-day-key="${key}"]`);
    const header = sec?.querySelector('[data-day-header]');
    if (!rail || !header) return null;
    const r = rail.getBoundingClientRect(), h = header.getBoundingClientRect();
    return { day: key, railBottom: r.bottom, headerTop: h.top };
  }, parked.key);

  if (!geom) {
    // Said out loud rather than skipped: "no day was tall enough to park in"
    // is a fact about the fixture the next reader needs, not a pass.
    check(`12 header clears the rail @ ${label}`, false, parked.why ?? 'rail or header missing');
    await page.close();
    continue;
  }
  // Stuck AT the rail's bottom edge, not merely somewhere below it.
  // `headerTop >= railBottom - 2` was the old form and is satisfied by a
  // header sitting a thousand pixels down the page, having never stuck at
  // all — so it could pass while proving nothing. Equality is the property
  // this check exists for: the day title comes to rest flush under the rail
  // rather than sliding beneath it.
  check(`12 header clears the rail @ ${label}`, Math.abs(geom.headerTop - geom.railBottom) <= 2,
    `day=${geom.day} railBottom=${geom.railBottom.toFixed(1)} headerTop=${geom.headerTop.toFixed(1)}`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(`12 no horizontal page overflow @ ${label}`, overflow <= 1, `${overflow}px`);
  await page.close();
}

// ---------------------------------------------------------------- 13. keyboard
{
  const page = await newPage();
  const chips = await railChips(page);
  await page.evaluate(k => document.querySelector(`[data-day-rail] [data-chip="${k}"]`).focus(), chips[0]);
  const f0 = await page.evaluate(() => document.activeElement?.dataset?.chip ?? null);

  // `13b arrowing does not refilter the list` used to sit at the bottom of
  // this block, comparing the mounted day count either side of a keypress.
  // That was a real claim while a date scope decided which days were mounted:
  // arrowing must not act like a tap. #274 phase 4 mounts every day of the
  // year and no rail control filters anything, so both sides of that
  // comparison are now the same constant and it cannot fail.
  //
  // What survives is the invariant a reader would actually notice: arrowing
  // moves FOCUS along the rail and must not move the READER. Wire ArrowRight
  // to `onSelectDay` and the page jumps to that day; this catches that, and
  // it spans both presses below rather than only the second.
  //
  // Settled first, and that is not belt-and-braces. In season the app scrolls
  // itself to today on load and `useDayAnchor` then HOLDS that position
  // against late layout changes (sections carry `content-visibility: auto`,
  // so real heights replace their estimates as they come into view). A
  // baseline taken before that finishes is a moving number, and the check
  // would report the app's own landing scroll as the keypress's doing.
  // `focus()` above can scroll too, so the settle goes after it.
  const settled = await page.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    let last = null;
    for (let i = 0; i < 12; i++) {
      const y = Math.round(window.scrollY);
      if (y === last) return y;
      last = y;
      await wait(300);
    }
    return null;
  });

  await page.keyboard.press('ArrowRight');
  const f1 = await page.evaluate(() => document.activeElement?.dataset?.chip ?? null);
  check('13a ArrowRight moves focus along the rail', !!f1 && f0 !== f1, `${f0} → ${f1}`);

  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(400);
  if (settled === null) {
    // Skipped rather than measured against a number that was still moving —
    // a pass read off a drifting baseline is the vacuum this whole sweep is
    // about.
    skip('13b arrowing moves focus, not the reader',
      'the page was still scrolling on its own after 3.6s, so nothing the ' +
      'keypresses did could be told apart from it');
  } else {
    const after = await page.evaluate(() => Math.round(window.scrollY));
    check('13b arrowing moves focus, not the reader', Math.abs(after - settled) <= 2,
      `scrollY ${settled} → ${after} across two ArrowRight presses`);
  }
  await page.close();
}

// ------------------------------------------------------------ 14. accessibility
{
  const page = await newPage();
  const chips = await page.$$eval('[data-day-rail] [data-chip]', els => els.map(e => ({
    label: e.getAttribute('aria-label'),
    unavailable: e.getAttribute('aria-disabled') === 'true',
  })));
  // A reachable chip names its destination; an unavailable one names the day
  // as a FACT and must not promise a destination it cannot deliver.
  const reachable = chips.filter(c => !c.unavailable);
  const unavailable = chips.filter(c => c.unavailable);
  check('14a every reachable chip labelled by target', reachable.length > 0
    && reachable.every(c => c.label && c.label.startsWith('Go to ')),
    `${reachable.length} reachable, e.g. ${reachable[0]?.label}`);
  check('14a2 no unavailable chip promises a destination', unavailable.every(c => !/^Go to /.test(c.label)),
    `${unavailable.length} unavailable, e.g. ${unavailable[0]?.label ?? 'none'}`);
  const empty = chips.map(c => c.label).find(l => /no events/.test(l));
  check('14b an empty day says so', !!empty, empty ?? 'no empty day in range');
  const bad = chips.map(c => c.label).filter(l => /\bnext\b|\bprevious\b/.test(l));
  check('14c no chip labelled by direction', bad.length === 0, bad.join(' | ') || 'none');
  await page.close();
}

// ------------------------------------------- 15. tap targets on a phone
//
// Measured on production before this check existed: 245 of 255 rail controls
// were under the 44px minimum — the prev/next chevrons at 21x32 and ⟳ Now at
// 57x28, with every day chip one pixel short at 44x43. This is a phone-first
// app and the rail is its primary navigation, so the numbers are asserted
// rather than the classes: a class can be present and still lose to a
// competing rule, and only the rendered box is what a thumb hits.
{
  const page = await newPage({ width: 390, height: 844 });
  await page.mouse.wheel(0, 2000);
  await page.waitForTimeout(700);
  const controls = await page.evaluate(() => {
    const rail = document.querySelector('[data-day-rail]');
    if (!rail) return null;
    return [...rail.querySelectorAll('button')]
      // The band is 16px tall by design — a full-height band would dominate a
      // rail whose whole job is the chips. It is carved out here rather than
      // silently passing because nothing is reachable ONLY through it: every
      // week is also reachable from its own day chips, which 15a measures at
      // the full 44px, and 15b below is what keeps that true.
      .filter(el => !el.hasAttribute('data-week-band-button'))
      .map(el => {
        const r = el.getBoundingClientRect();
        return {
          name: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 24),
          w: Math.round(r.width), h: Math.round(r.height),
        };
      });
  });
  if (!controls?.length) {
    check('15a rail tap targets meet the 44px minimum', false, 'no rail controls found');
  } else {
    const under = controls.filter(c => c.w < 44 || c.h < 44);
    check('15a every rail control meets the 44px minimum',
      under.length === 0,
      under.length
        ? `${under.length}/${controls.length} under: ` +
          under.slice(0, 4).map(c => `${c.name} ${c.w}x${c.h}`).join(', ')
        : `${controls.length} controls, smallest ` +
          `${Math.min(...controls.map(c => c.w))}x${Math.min(...controls.map(c => c.h))}`);
  }

  // The carve-out's premise, asserted rather than approximated: the band's
  // 16px button is never the ONLY way to reach the day it goes to. Every
  // reachable week names a destination day, and that day's own chip is a
  // full-size control — so a thumb that cannot hit the band has a 44px route
  // to exactly the same place.
  //
  // This needs the destination in the DOM, which is why the labelled band
  // button carries `data-week-band-target`. Deriving it in the browser instead
  // would mean re-implementing `weekBandDestinations` in the check — a second
  // copy of the rule, which is the thing this whole design keeps refusing to
  // have.
  const carveOut = await page.evaluate(() => {
    const rail = document.querySelector('[data-day-rail]');
    const targets = [...rail.querySelectorAll('[data-week-band-button]')]
      .filter(b => b.getAttribute('aria-disabled') !== 'true')
      .map(b => b.dataset.weekBandTarget)
      .filter(Boolean);
    const missing = targets.filter(day => {
      const chip = rail.querySelector(`[data-chip="${day}"]`);
      if (!chip) return true;
      const r = chip.getBoundingClientRect();
      return r.width < 44 || r.height < 44;
    });
    return { offered: targets.length, missing };
  });
  check('15b every week the band offers has a 44px chip for the same day',
    carveOut.offered > 0 && carveOut.missing.length === 0,
    carveOut.offered === 0
      ? 'no reachable week band button found'
      : `${carveOut.offered} weeks offered, ${carveOut.missing.length} without a full-size chip` +
        (carveOut.missing.length ? `: ${carveOut.missing.join(', ')}` : ''));
  await page.close();
}

// ------------------------------------------------------------ 16. the week band
//
// Alignment is claimed to be structural — the band cell and the chip are
// block-level children of one flex column, so the cell's width EQUALS the
// chip's rather than matching it. A structural claim is still worth measuring
// once: `w-max`, `shrink-0` and a stray `min-width` on a future descendant can
// all break "equals" without breaking the markup.
{
  const page = await newPage();
  const geometry = await page.evaluate(() => {
    const rail = document.querySelector('[data-day-rail]');
    if (!rail) return null;
    const columns = [...rail.querySelectorAll('[data-rail-content] > [data-rail-column]')];
    const cells = columns.map(col => {
      const cell = col.querySelector('[data-band-cell]');
      const chip = col.querySelector('[data-chip]');
      const run = col.querySelector('[data-band-run]');
      const bars = [...col.querySelectorAll('[data-band-bar]')].map(b => {
        const r = b.getBoundingClientRect();
        return {
          left: r.left, right: r.right,
          opacity: Number(getComputedStyle(b).opacity),
          // Ground truth for "same week", independent of the geometry 16b
          // tests: the ramp step is a pure function of week number and
          // `rampPercent` rounds to whole percent, so two touching bars in
          // the same week resolve to byte-identical computed colour.
          color: getComputedStyle(b).backgroundColor,
        };
      });
      return {
        day: chip?.dataset.chip ?? null,
        cellW: cell?.getBoundingClientRect().width ?? null,
        chipW: chip?.getBoundingClientRect().width ?? null,
        runLeft: run?.getBoundingClientRect().left ?? null,
        runRight: run?.getBoundingClientRect().right ?? null,
        cellLeft: cell?.getBoundingClientRect().left ?? null,
        cellRight: cell?.getBoundingClientRect().right ?? null,
        bars,
      };
    });
    const pill = document.querySelector('[data-rail-pill]')?.getBoundingClientRect();
    const bandBottom = cells[0] ? document.querySelector('[data-band-cell]').getBoundingClientRect().bottom : null;
    const labels = [...rail.querySelectorAll('[data-week-band-button]')]
      .map(b => b.dataset.weekBandButton);
    // The copy layer must lay out its CHIP BOXES pixel-identically to the
    // real row — that is what a highlighted digit is clipped against. The
    // COLUMNS themselves are `absolute inset-0` + `items-stretch`, so their
    // own rects always match regardless of what is inside them; comparing
    // columns rather than chip boxes would pass even if the copy's band
    // spacer drifted from `--rail-band-h` and pushed every chip below it
    // out of line with the real row.
    const copyChipBoxes = [...rail.querySelectorAll('[data-rail-clip] > [data-rail-column]')]
      .map(col => col.querySelector(':scope > div:not([data-band-spacer])')?.getBoundingClientRect() ?? null);
    const realChipBoxes = columns.map(col => col.querySelector('[data-chip]')?.getBoundingClientRect() ?? null);
    const worstCopyDelta = Math.max(0, ...realChipBoxes.map((r, i) => {
      const c = copyChipBoxes[i];
      if (!r || !c) return 999;
      return Math.max(
        Math.abs(r.left - c.left), Math.abs(r.width - c.width),
        Math.abs(r.top - c.top), Math.abs(r.height - c.height),
      );
    }));
    return { cells, pill, bandBottom, labels, worstCopyDelta, columns: columns.length };
  });

  if (!geometry) {
    check('16 week band present', false, 'no rail');
  } else {
    const { cells, pill, bandBottom, labels, worstCopyDelta } = geometry;
    const widthDrift = Math.max(...cells.map(c => Math.abs((c.cellW ?? 0) - (c.chipW ?? -1))));
    check('16a every band cell is exactly its chip\'s width', widthDrift < 0.5,
      `worst ${widthDrift.toFixed(2)}px over ${cells.length} columns`);

    // A week is drawn as ONE run: inside a week the fill bridges the gutter,
    // and the only break in the whole band is the seam through the Saturday
    // two weeks share. Measured off the OUTER bar on each side of the
    // gutter — the last bar of the column to the left, the first bar of the
    // column to the right — so a boundary Saturday's split cell is included
    // rather than excluded: the join between a weekday and its boundary
    // Saturday is the riskiest geometry in the design, and a
    // `bars.length === 1` filter would never measure it. "Same week" is
    // ground-truthed independently, off the bars' own computed colour (a
    // pure function of week number, rounded to whole percent — see above),
    // so the count asserted below is not just "at least one gutter touched".
    const gutters = cells.slice(0, -1).map((c, i) => {
      const next = cells[i + 1];
      if (c.bars.length === 0 || next.bars.length === 0) return { touching: false, sameWeek: false };
      const leftEdge = c.bars[c.bars.length - 1];
      const rightEdge = next.bars[0];
      return {
        touching: Math.abs(leftEdge.right - rightEdge.left) < 0.5,
        sameWeek: leftEdge.color === rightEdge.color,
      };
    });
    const bridged = gutters.filter(g => g.touching).length;
    const sameWeekGutters = gutters.filter(g => g.sameWeek).length;
    check('16b the fill bridges the gutters inside a week',
      bridged > 0 && bridged === sameWeekGutters,
      `${bridged} bridged of ${sameWeekGutters} same-week gutters`);

    const split = cells.filter(c => c.bars.length === 2);
    const seams = split.map(c => c.bars[1].left - c.bars[0].right);
    check('16c a boundary Saturday is split, and only there',
      split.length > 0 && seams.every(s => s > 0.5 && s < 6),
      `${split.length} split days, seams ${seams.map(s => s.toFixed(1)).join(', ')}`);

    check('16d WEEK n appears at most once per week',
      labels.length === new Set(labels).size && labels.length > 0,
      `${labels.length} labels: ${labels.join(',')}`);

    // Risk 1 from the design, measured rather than assumed.
    check('16e the highlight pill does not paint over the band',
      !!pill && !!bandBottom && pill.top >= bandBottom - 0.5,
      pill ? `pill.top=${pill.top.toFixed(1)} band.bottom=${bandBottom.toFixed(1)}` : 'no pill');

    // Risk 1's other half: the two layers must stay in step, or the seam the
    // shared chip-box class exists to prevent comes back one level up.
    check('16f the clipped copy lays out column for column', worstCopyDelta < 0.5,
      `worst ${worstCopyDelta.toFixed(2)}px`);
  }
  await page.close();
}

// ------------------------------------------- 17. a band tap navigates
{
  const page = await newPage();
  const before = await anchorChip(page);
  const jumped = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('[data-week-band-button]')]
      .filter(b => b.getAttribute('aria-disabled') !== 'true');
    // The furthest reachable week from wherever the rail opened, so the check
    // cannot pass on a one-chip move.
    const target = buttons[buttons.length - 1];
    if (!target) return null;
    target.click();
    return { week: target.dataset.weekBandButton, label: target.getAttribute('aria-label') };
  });
  if (!jumped) {
    check('17a a band tap navigates', false, 'no reachable week band button');
  } else {
    await page.waitForTimeout(700);
    const after = await anchorChip(page);
    check('17a a band tap navigates', !!after && after !== before, `${before} → ${after}`);
    // Named by destination, and the destination is where it actually landed.
    const named = /Go to Week \d+, (opens|first events) (.+), \d+ events?$/.exec(jumped.label ?? '');
    check('17b the band names the day it actually lands on',
      !!named && !!after && jumped.label.includes(new Date(`${after}T12:00:00`)
        .toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric' })),
      `${jumped.label} → landed ${after}`);
  }
  await page.close();
}

// ------------------------------------------- 18. an unreachable week is inert
//
// The default, unfiltered feed fills every in-season week, so this check has
// to construct the unreachable state itself rather than hope for one. It is
// narrowed through PERSISTED FILTER STATE — a storage seed reaches the rail's
// own week destinations with no dependency on the filter panel's own markup,
// which the drive-the-UI alternative would have. (The route was shared with a
// check 3 that seeded a `'this-week'` date scope; #274 phase 4 deleted the
// scopes and that check with them, so this is now the only user of it.)
//
// The term is 'williamsburg': Colonial Williamsburg's themed week-6
// residency, a whole week of named partner programming rather than one
// event a routine feed refresh could drop, which is what "stable against
// feed churn" means here — not that the exact match count is fixed (it
// isn't: the local dev fixture carries 4 matching events, live production
// 9, both entirely inside week 6), but that the THEME is a fixture of the
// season rather than a coincidence of today's snapshot. It leaves every
// other in-season week with zero matches, which is the unreachable state
// 18a/18b need, and it never fully empties the reachable side either (see
// 18-pre), which is what keeps 18a from going vacuous.
//
// The seed used to carry `dateFilter: 'all'` as well, because week 6 is in
// the past relative to `now` this season and the default `next` scope would
// have emptied the list. #274 phase 4 deleted the date scopes: the list is
// the whole year unconditionally, so the search term is the only thing
// narrowing it and the date keys are ignored on read. Re-verified after
// removing them — 1 reachable week, 8 unreachable, unchanged.
{
  const page = await newPage({
    // The seed suppresses the off-season landing, so this page's screen says
    // nothing about the run's regime — see `enterList` (#287).
    seedsOwnFilter: true,
    storage: ['chq-calendar-user-state', JSON.stringify({
      searchTerm: 'williamsburg',
      selectedTags: [], selectedLocations: [], expandedDescriptions: [],
      recentLocations: [], recentCategories: [], showFavoritesOnly: false,
      // The PAGE's now, not Node's. `useFilterState` discards a payload
      // older than `USER_STATE_EXPIRY_MS` (30 days), and `Date.now()` inside
      // the page is whatever `pinClock` pinned — so a `Date.now()` evaluated
      // out here reads as 30+ days stale the moment `E2E_NOW` is set that far
      // ahead, and the seed is dropped in silence. Measured at
      // `E2E_NOW=2026-09-30` (34 days on): six red checks reporting "9
      // reachable, 0 unreachable", which is not a finding about the app but
      // about a seed that never arrived. The state is "saved" at the same
      // instant the page believes it is.
      lastSaved: FIXED_NOW.getTime(),
    })],
  });
  const state = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('[data-week-band-button]')];
    const disabled = buttons.filter(b => b.getAttribute('aria-disabled') === 'true');
    const reachable = buttons.filter(b => b.getAttribute('aria-disabled') !== 'true');
    return {
      count: disabled.length,
      reachableCount: reachable.length,
      labels: disabled.map(b => b.getAttribute('aria-label')),
      // The FILL is faded; the label is not. Fading the label is what took an
      // empty iOS chip's text to a sampled ~3.7:1.
      fillOpacity: disabled[0]
        ? Number(getComputedStyle(disabled[0].closest('[data-band-cell]')
            .querySelector('[data-band-bar]')).opacity)
        : null,
      labelOpacity: disabled[0]
        ? Number(getComputedStyle(disabled[0].querySelector('span')).opacity)
        : null,
    };
  });
  // The check now controls its own precondition — a search that failed to
  // narrow anything is a FAILURE of this check, not a reason to stand down.
  // Both counts are asserted: zero unreachable is the original gap, and zero
  // reachable would mean the term matched nothing at all (an empty
  // `weekDestinations` map dims nothing, by design — see WeekBandCell — so a
  // term with no matches would make 18a vacuously true instead of failing).
  check('18-pre the search term narrows to exactly one theme week',
    state.count > 0 && state.reachableCount > 0,
    `${state.reachableCount} reachable, ${state.count} unreachable`);
  check('18a an unreachable week says so rather than offering a trip',
    state.count > 0 && state.labels.every(l => /^Week \d+, no events$/.test(l ?? '')),
    state.labels.slice(0, 3).join(' | ') || 'no unreachable week found');
  check('18b the fill is faded and the label is not',
    state.fillOpacity !== null && state.fillOpacity < 1 && state.labelOpacity === 1,
    `fill=${state.fillOpacity} label=${state.labelOpacity}`);
  await page.close();
}

// ------------------------------------------- 19. axe over the rail
//
// `aria-hidden-focus` is the rule this design has to prove clean, not assume:
// ~64 decorative segments carry the band's pointer handlers, and every one of
// them is `aria-hidden`. A single focusable descendant among them would put a
// hidden control in the tab order.
{
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const page = await newPage();
  await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
  const results = await page.evaluate(async () => {
    const run = await window.axe.run('[data-day-rail]', {
      runOnly: { type: 'rule', values: [
        'aria-hidden-focus', 'button-name', 'aria-allowed-attr', 'nested-interactive',
      ] },
    });
    return run.violations.map(v => `${v.id} x${v.nodes.length}`);
  });
  check('19 axe is clean over the rail with the band present',
    results.length === 0, results.join(', ') || 'no violations');
  await page.close();
}

// ------------------------------------------- 20. the week chooser
//
// The acceptance criterion for this phase, measured rather than asserted: any
// week of the season reachable in TWO interactions from anywhere in the list.
// The rail is sticky, so the trigger is on screen at any scroll position — that
// is the property this opens from a deep scroll to test, because it is the one
// the whole design rests on and the one a sticky regression would silently take
// away (a wrapper div gave `position: sticky` zero travel in #238, and eleven
// green task reviews missed it).
{
  const page = await newPage({ width: 390, height: 844 });
  // Deep enough that the top of the document is nowhere near the viewport.
  await page.mouse.wheel(0, 6000);
  await page.waitForTimeout(700);
  const before = await anchorChip(page);

  const triggerBox = await page.evaluate(() => {
    const el = document.querySelector('[data-week-chooser-trigger]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: r.top, w: Math.round(r.width), h: Math.round(r.height),
             onScreen: r.top >= 0 && r.bottom <= window.innerHeight };
  });
  check('20a the chooser is on screen after a deep scroll',
    !!triggerBox && triggerBox.onScreen,
    triggerBox ? `top=${triggerBox.top.toFixed(0)} ${triggerBox.w}x${triggerBox.h}` : 'no trigger');

  await page.click('[data-week-chooser-trigger]');
  await page.waitForSelector('[data-week-chooser-popover]', { timeout: 3000 });
  const opened = await page.evaluate(() => {
    const pop = document.querySelector('[data-week-chooser-popover]');
    const r = pop.getBoundingClientRect();
    return {
      cells: pop.querySelectorAll('[data-week-cell]').length,
      // Nine 44px cells in a ROW would be 396px, wider than this 390px viewport.
      // The 3x3 is what makes the control fit a phone at all, so its box is the
      // measurement, not its class list.
      width: Math.round(r.width),
      withinViewport: r.left >= 0 && r.right <= window.innerWidth
        && r.top >= 0 && r.bottom <= window.innerHeight,
    };
  });
  check('20b the popover holds every week of the season', opened.cells === 9,
    `${opened.cells} cells`);
  check('20c the popover fits a 390px phone', opened.withinViewport && opened.width < 390,
    `${opened.width}px wide, within=${opened.withinViewport}`);

  // The jump itself: the furthest reachable week from wherever the rail opened,
  // so the check cannot pass on a one-week nudge.
  const jumped = await page.evaluate(() => {
    const cells = [...document.querySelectorAll('[data-week-cell]')]
      .filter(c => c.getAttribute('aria-disabled') !== 'true');
    const target = cells[cells.length - 1];
    if (!target) return null;
    target.click();
    return { week: target.dataset.weekCell, day: target.dataset.weekCellTarget,
             label: target.getAttribute('aria-label') };
  });
  if (!jumped) {
    check('20d a chooser tap navigates', false, 'no reachable week cell');
  } else {
    await page.waitForTimeout(900);
    const after = await anchorChip(page);
    check('20d a chooser tap navigates', !!after && after !== before,
      `${before} → ${after} (week ${jumped.week})`);
    // Where it SAID it would go, not merely somewhere. The rail's standing rule:
    // a control names its destination, and the destination is where it lands.
    check('20e it lands on the day it named', after === jumped.day,
      `named ${jumped.day}, landed ${after}`);
    const closed = await page.$$('[data-week-chooser-popover]');
    check('20f the popover closes on a choice', closed.length === 0,
      `${closed.length} popovers still open`);

    // The lit cell followed. This is the trigger's whole job — position in the
    // season, spatially — and it is downstream of `anchorDay`, which is
    // scroll-derived, so nothing but a real scroll can test it.
    const lit = await page.evaluate(() => {
      const cells = [...document.querySelectorAll('[data-week-chooser-cell][data-lit]')];
      return { count: cells.length, week: cells[0]?.dataset.weekChooserCell ?? null };
    });
    check('20g the lit cell followed the jump',
      lit.count === 1 && lit.week === jumped.week,
      `lit=${lit.week} expected=${jumped.week} (${lit.count} lit)`);
  }
  await page.close();
}

// ------------------------------------------- 20h. an unreachable week is inert
//
// Same storage seed as check 18, and for the same reason: the default feed
// fills every in-season week, so this state has to be CONSTRUCTED rather than
// hoped for. A check that never creates the state it names can only skip.
// 'williamsburg' leaves week 6 reachable and every other in-season week empty,
// in both the local dev fixture and live production.
{
  const page = await newPage({
    width: 390, height: 844,
    // As in check 18: a seeded filter beats the landing, so this page cannot
    // report the regime (#287).
    seedsOwnFilter: true,
    storage: ['chq-calendar-user-state', JSON.stringify({
      searchTerm: 'williamsburg',
      selectedTags: [], selectedLocations: [], expandedDescriptions: [],
      recentLocations: [], recentCategories: [], showFavoritesOnly: false,
      // The PAGE's now, not Node's — see check 18's seed.
      lastSaved: FIXED_NOW.getTime(),
    })],
  });
  await page.click('[data-week-chooser-trigger]');
  await page.waitForSelector('[data-week-chooser-popover]', { timeout: 3000 });
  const state = await page.evaluate(() => {
    const cells = [...document.querySelectorAll('[data-week-cell]')];
    const dim = cells.filter(c => c.getAttribute('aria-disabled') === 'true');
    return {
      dim: dim.length,
      reachable: cells.length - dim.length,
      labels: dim.map(c => c.getAttribute('aria-label')),
      fillOpacity: dim[0]
        ? Number(getComputedStyle(dim[0].querySelector('[data-week-cell-fill]')).opacity)
        : null,
      numberOpacity: dim[0]
        ? Number(getComputedStyle(dim[0].querySelector('[data-week-cell-number]')).opacity)
        : null,
    };
  });
  // Both counts, as in 18-pre: zero unreachable is the original gap, and zero
  // reachable would mean the term matched nothing at all and 20h passes
  // vacuously.
  check('20h-pre the seed narrows to exactly one theme week',
    state.dim > 0 && state.reachable > 0,
    `${state.reachable} reachable, ${state.dim} unreachable`);
  check('20h an unreachable week in the grid says so rather than offering a trip',
    state.dim > 0 && state.labels.every(l => /^Week \d+, no events$/.test(l ?? '')),
    state.labels.slice(0, 3).join(' | ') || 'none');
  check('20i the grid fades the fill and not the numeral',
    state.fillOpacity !== null && state.fillOpacity < 1 && state.numberOpacity === 1,
    `fill=${state.fillOpacity} number=${state.numberOpacity}`);
  await page.close();
}

// ------------------------------------------- 21. axe over the open chooser
//
// This check scopes itself to `[data-week-chooser-popover]`: the `role="dialog"`
// containing nine controls, portalled to `document.body`. Check 19 already
// audits the trigger itself — including its `aria-hidden` icon of nine
// decorative spans — because the trigger lives inside `[data-day-rail]`, which
// is check 19's scope. Only the portalled popover is outside that scope and
// needs its own pass here.
{
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const page = await newPage();
  await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
  await page.click('[data-week-chooser-trigger]');
  await page.waitForSelector('[data-week-chooser-popover]', { timeout: 3000 });
  const results = await page.evaluate(async () => {
    const run = await window.axe.run('[data-week-chooser-popover]', {
      runOnly: { type: 'rule', values: [
        'aria-hidden-focus', 'button-name', 'aria-allowed-attr',
        'nested-interactive', 'aria-dialog-name', 'aria-required-children',
      ] },
    });
    return run.violations.map(v => `${v.id} x${v.nodes.length}`);
  });
  check('21 axe is clean over the open week chooser',
    results.length === 0, results.join(', ') || 'no violations');
  await page.close();
}

await browser.close();
finish();
