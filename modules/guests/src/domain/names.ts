/**
 * Guest names across scripts. Maldives source markets (China, Russia, India, GCC, Europe) mean names arrive in
 * Han, Cyrillic, Arabic, Devanagari and Latin scripts. Portico stores the name as written (native script) AND a
 * Latin transliteration (passport / transfer-manifest form), and compares names in both forms.
 * Pure functions only — no IO.
 */

export type NameScript =
  | 'Latn'
  | 'Cyrl'
  | 'Hani'
  | 'Arab'
  | 'Deva'
  | 'Thaa'
  | 'Grek'
  | 'Hang'
  | 'Kana'
  | 'Thai'
  | 'Hebr'
  | 'Other';

const SCRIPT_TESTS: Array<[NameScript, RegExp]> = [
  ['Latn', /\p{Script=Latin}/u],
  ['Cyrl', /\p{Script=Cyrillic}/u],
  ['Hani', /\p{Script=Han}/u],
  ['Arab', /\p{Script=Arabic}/u],
  ['Deva', /\p{Script=Devanagari}/u],
  ['Thaa', /\p{Script=Thaana}/u],
  ['Grek', /\p{Script=Greek}/u],
  ['Hang', /\p{Script=Hangul}/u],
  ['Kana', /[\p{Script=Hiragana}\p{Script=Katakana}]/u],
  ['Thai', /\p{Script=Thai}/u],
  ['Hebr', /\p{Script=Hebrew}/u],
];

/** Dominant script of a name: the script of the most letters (ties → first in the list above). */
export function detectScript(text: string): NameScript | null {
  const counts = new Map<NameScript, number>();
  for (const ch of text) {
    if (!/\p{L}/u.test(ch)) continue;
    const hit = SCRIPT_TESTS.find(([, re]) => re.test(ch));
    const s = hit ? hit[0] : 'Other';
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  let best: NameScript | null = null;
  let bestCount = 0;
  for (const [s, n] of counts) {
    if (n > bestCount) {
      best = s;
      bestCount = n;
    }
  }
  return best;
}

export function isLatin(text: string): boolean {
  const s = detectScript(text);
  return s === null || s === 'Latn';
}

// Letters that Unicode decomposition does not reduce to ASCII.
const SPECIAL_LATIN: Record<string, string> = {
  ß: 'ss',
  æ: 'ae',
  œ: 'oe',
  ø: 'o',
  ł: 'l',
  đ: 'd',
  ð: 'd',
  þ: 'th',
  ı: 'i',
  ħ: 'h',
};

/** Accent-, case- and punctuation-insensitive Latin form used for matching: "Müller-Lüdenscheidt" → "muller ludenscheidt". */
export function normalizeLatin(input: string): string {
  const lower = input
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase();
  let out = '';
  for (const ch of lower) out += SPECIAL_LATIN[ch] ?? ch;
  return out
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Native-script matching form: compatibility-normalized, lower-cased, punctuation removed. */
export function normalizeNative(input: string): string {
  return input
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

// ICAO Doc 9303 (7th ed., Part 3, §6 table B) transliteration of Cyrillic as printed in the MRZ / data page of
// Russian, Ukrainian and Belarusian passports.
const ICAO_CYRILLIC: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'i',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'kh',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'shch',
  ъ: 'ie',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'iu',
  я: 'ia',
  і: 'i',
  ї: 'i',
  є: 'ie',
  ґ: 'g',
  ў: 'u',
};

/**
 * Transliterate Cyrillic to Latin per ICAO 9303 (passport form). Non-Cyrillic characters pass through. The
 * first letter of each word keeps its capitalisation.
 */
export function transliterateCyrillic(input: string): string {
  let out = '';
  for (const ch of input) {
    const lower = ch.toLowerCase();
    const mapped = ICAO_CYRILLIC[lower];
    if (mapped === undefined) {
      out += ch;
      continue;
    }
    out += ch !== lower && mapped.length > 0 ? mapped.charAt(0).toUpperCase() + mapped.slice(1) : mapped;
  }
  return out;
}

/** Automatic transliteration is only offered where a single official standard exists (Cyrillic → ICAO). */
export function autoTransliterate(input: string): string | null {
  return detectScript(input) === 'Cyrl' ? transliterateCyrillic(input) : null;
}

export interface NameParts {
  givenName?: string | null;
  middleName?: string | null;
  familyName: string;
  nativeGivenName?: string | null;
  nativeFamilyName?: string | null;
}

export interface NameKeys {
  /** Latin matching key (given middle family), used for trigram search and fuzzy duplicates. */
  searchName: string;
  /** Native-script matching key, when a native-script name is stored. */
  searchNameNative: string | null;
}

export function nameKeys(n: NameParts): NameKeys {
  const latin = [n.givenName, n.middleName, n.familyName].filter((p): p is string => !!p?.trim()).join(' ');
  const native = [n.nativeGivenName, n.nativeFamilyName].filter((p): p is string => !!p?.trim()).join(' ');
  return {
    searchName: normalizeLatin(latin),
    searchNameNative: native ? normalizeNative(native) : null,
  };
}

/**
 * The postgres pg_trgm trigram model, reproduced exactly so that the database pre-filter (GIN index) and the
 * scoring in TypeScript agree: each word is lower-cased and padded with two leading spaces and one trailing
 * space; similarity = |shared trigrams| / |all distinct trigrams|. Word order does not matter.
 */
export function trigrams(input: string): Set<string> {
  const out = new Set<string>();
  const words = input.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  for (const w of words) {
    const chars = ['', '', ...Array.from(w), ''].map((c) => c || ' ');
    for (let i = 0; i + 2 < chars.length; i++) out.add(`${chars[i]}${chars[i + 1]}${chars[i + 2]}`);
  }
  return out;
}

export function trigramSimilarity(a: string, b: string): number {
  const ta = trigrams(a);
  const tb = trigrams(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / (ta.size + tb.size - shared);
}

/**
 * Name similarity across scripts: the better of Latin-vs-Latin and native-vs-native, so "王伟 / Wang Wei" matches
 * "Wei Wang" and "Иван Петров / Ivan Petrov" matches "Ivan Petrov". Given-name-only vs full-name records
 * (sparse DMC data) compare on the family name.
 */
export function nameSimilarity(a: NameKeys, b: NameKeys): number {
  let best = a.searchName && b.searchName ? trigramSimilarity(a.searchName, b.searchName) : 0;
  if (a.searchNameNative && b.searchNameNative) {
    best = Math.max(best, trigramSimilarity(a.searchNameNative, b.searchNameNative));
  }
  return best;
}

/** Display form: "Title Given Middle Family" (Latin) — native form is shown alongside by the UI. */
export function displayName(n: NameParts & { title?: string | null; preferredName?: string | null }): string {
  return [n.title, n.preferredName ?? n.givenName, n.familyName].filter((p) => !!p?.trim()).join(' ');
}
