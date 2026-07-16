import { normalize } from '../services/textNormalize';

describe('normalize', () => {
  test('folds diacritics to their ASCII base letters (issue #138)', () => {
    expect(normalize('Grgić')).toBe('grgic');
    expect(normalize('Dvořák')).toBe('dvorak');
    expect(normalize('Peña')).toBe('pena');
    expect(normalize('Antonín Dvořák')).toBe('antonin dvorak');
  });

  test('still lowercases, strips punctuation to spaces, and collapses whitespace', () => {
    expect(normalize('  Hello,   World!  ')).toBe('hello world');
    expect(normalize('CSO/Classical Concerts')).toBe('cso classical concerts');
  });
});
