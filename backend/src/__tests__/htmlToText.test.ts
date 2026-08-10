import { htmlToText } from '../utils/htmlToText';

describe('htmlToText', () => {
  test('strips tags and collapses whitespace', () => {
    expect(htmlToText('<p>Hello <strong>world</strong></p>\n<p>Second&nbsp;para</p>'))
      .toBe('Hello world Second para');
  });

  test('decodes HTML entities', () => {
    expect(htmlToText('Fiedler &amp; Capretta &#8212; 10:45 a.m.')).toBe('Fiedler & Capretta — 10:45 a.m.');
  });

  test('returns empty string for empty/undefined-ish input', () => {
    expect(htmlToText('')).toBe('');
  });
});
