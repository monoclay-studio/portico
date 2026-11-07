import { describe, expect, it } from 'vitest';
import {
  autoTransliterate,
  detectScript,
  displayName,
  nameKeys,
  nameSimilarity,
  normalizeLatin,
  normalizeNative,
  transliterateCyrillic,
  trigramSimilarity,
  trigrams,
} from './names';

describe('script detection', () => {
  it.each([
    ['Ivan Petrov', 'Latn'],
    ['Иван Петров', 'Cyrl'],
    ['王伟', 'Hani'],
    ['أحمد علي', 'Arab'],
    ['प्रिया शर्मा', 'Deva'],
    ['އަޙްމަދު', 'Thaa'],
    ['Γιώργος', 'Grek'],
  ])('%s → %s', (text, script) => {
    expect(detectScript(text)).toBe(script);
  });

  it('returns null for text without letters', () => {
    expect(detectScript('123 -')).toBeNull();
  });

  it('picks the dominant script of mixed input', () => {
    expect(detectScript('Иван Petrov Петрович')).toBe('Cyrl');
  });
});

describe('normalization', () => {
  it('folds accents, case, punctuation and special letters', () => {
    expect(normalizeLatin('  Müller-Lüdenscheidt ')).toBe('muller ludenscheidt');
    expect(normalizeLatin('Straße')).toBe('strasse');
    expect(normalizeLatin("O'Brien")).toBe('o brien');
    expect(normalizeLatin('Søren Łukasz')).toBe('soren lukasz');
    expect(normalizeLatin('José  María')).toBe('jose maria');
  });

  it('keeps native scripts intact but canonical', () => {
    expect(normalizeNative('  王  伟 ')).toBe('王 伟');
    expect(normalizeNative('ИВАН')).toBe('иван');
  });
});

describe('ICAO 9303 Cyrillic transliteration', () => {
  it.each([
    ['Иван Петров', 'Ivan Petrov'],
    ['Юлия Щербакова', 'Iuliia Shcherbakova'],
    ['Алексей Хрущёв', 'Aleksei Khrushchev'],
    ['Наталья', 'Natalia'],
    ['Цой', 'Tsoi'],
    ['Подъячев', 'Podieiachev'],
  ])('%s → %s', (cyr, latin) => {
    expect(transliterateCyrillic(cyr)).toBe(latin);
  });

  it('only auto-transliterates Cyrillic (no single standard for Han or Arabic)', () => {
    expect(autoTransliterate('Иван')).toBe('Ivan');
    expect(autoTransliterate('王伟')).toBeNull();
    expect(autoTransliterate('أحمد')).toBeNull();
    expect(autoTransliterate('Ivan')).toBeNull();
  });
});

describe('trigram similarity (pg_trgm model)', () => {
  it('produces pg_trgm trigrams with padding', () => {
    expect([...trigrams('cat')].sort()).toEqual(['  c', ' ca', 'at ', 'cat']);
  });

  it('is word-order insensitive', () => {
    expect(trigramSimilarity('wang wei', 'wei wang')).toBe(1);
  });

  it('scores identical strings 1 and disjoint strings 0', () => {
    expect(trigramSimilarity('ahmed ali', 'ahmed ali')).toBe(1);
    expect(trigramSimilarity('abc', 'xyz')).toBe(0);
    expect(trigramSimilarity('', 'xyz')).toBe(0);
  });

  it('tolerates a typo', () => {
    expect(trigramSimilarity('jonh smith', 'john smith')).toBeGreaterThan(0.45);
    expect(trigramSimilarity('jonh smith', 'john smith')).toBeLessThan(1);
  });

  it('works on non-Latin scripts', () => {
    expect(trigramSimilarity('王伟', '王伟')).toBe(1);
    expect(trigramSimilarity('王伟', '李娜')).toBe(0);
  });
});

describe('name similarity across scripts', () => {
  it('matches a native-script record against its transliteration through the native key', () => {
    const a = nameKeys({
      givenName: 'Wei',
      familyName: 'Wang',
      nativeGivenName: '伟',
      nativeFamilyName: '王',
    });
    const b = nameKeys({ givenName: 'Wei', familyName: 'Wang' });
    expect(nameSimilarity(a, b)).toBe(1);
    const c = nameKeys({
      givenName: 'Wei',
      familyName: 'Wong',
      nativeGivenName: '伟',
      nativeFamilyName: '王',
    });
    expect(nameSimilarity(a, c)).toBe(1); // different romanization, same native name
  });

  it('builds search keys from all name parts', () => {
    expect(nameKeys({ givenName: 'Anna-Lena', middleName: 'M.', familyName: 'Groß' })).toEqual({
      searchName: 'anna lena m gross',
      searchNameNative: null,
    });
  });

  it('formats display names with preferred name and title', () => {
    expect(displayName({ title: 'Dr', givenName: 'Robert', preferredName: 'Bob', familyName: 'Hale' })).toBe(
      'Dr Bob Hale',
    );
    expect(displayName({ familyName: 'Rossi' })).toBe('Rossi');
  });
});
