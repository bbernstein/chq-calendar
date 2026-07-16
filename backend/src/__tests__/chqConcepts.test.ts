import { conceptsFor, conceptsInBody } from '../services/chqConcepts';

describe('conceptsFor', () => {
  test.each([
    ['cso', 'cso'],
    ['CSO', 'cso'],
    ['Symphony', 'cso'],
    ['Chautauqua Symphony Orchestra', 'cso'],
    ['Chautauqua Symphony Orchestra/Classical Concerts', 'cso'],
    ['CTC', 'ctc'],
    ['Chautauqua Theater Company', 'ctc'],
    ['CLSC', 'clsc'],
    ['Chautauqua Literary and Scientific Circle', 'clsc'],
    ['Opera', 'opera'],
    ['Interfaith Lecture', 'interfaith'],
  ])('%s resolves to concept %s', (input, key) => {
    expect(conceptsFor(input).has(key)).toBe(true);
  });

  test('unrelated categories map to no concept', () => {
    expect(conceptsFor('Community Group Event').size).toBe(0);
    expect(conceptsFor('Movies').size).toBe(0);
    expect(conceptsFor('Recreation').size).toBe(0);
  });

  test('bare "theater" is not a surface (too ambiguous — only acronym/full name resolve to ctc)', () => {
    expect(conceptsFor('Theater').has('ctc')).toBe(false);
  });

  test('surfaces match only as whole words, never glued inside a longer word', () => {
    // "dance" inside "Attendance", "opera" inside "Operation" — the space-padded
    // whole-phrase match must NOT resolve these to the dance/opera concepts.
    expect(conceptsFor('Attendance').has('dance')).toBe(false);
    expect(conceptsFor('Operation').has('opera')).toBe(false);
    expect(conceptsFor('Attendance').size).toBe(0);
  });
});

describe('conceptsInBody', () => {
  test('multi-word canonical phrase in prose resolves to its concept', () => {
    const body = ' the chautauqua symphony orchestra performs tonight ';
    expect(conceptsInBody(body).has('cso')).toBe(true);
  });

  test('a bare generic word in prose does not resolve (surfaces are not body phrases)', () => {
    const body = ' a symphony of color filled the gallery ';
    expect(conceptsInBody(body).has('cso')).toBe(false);
  });
});
