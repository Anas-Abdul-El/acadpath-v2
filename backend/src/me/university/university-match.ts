// Matching what a student typed to a university already in the database
// (v1: findUniversity in select-university.service.ts).

export const collapseWhitespace = (value: string): string =>
  value.trim().replace(/\s+/g, ' ');

/** Lowercase, no accents, single spaces, no leading "the": "The Université" → "universite". */
const normalizeForComparison = (value: string): string =>
  collapseWhitespace(value)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/^the /, '');

export interface UniversityKey {
  id: string;
  name: string;
  shortName: string | null;
  country: string;
}

/** Same country, and the same name or short name, ignoring case, accents and spacing. */
export function findMatchingUniversity<T extends UniversityKey>(
  universities: T[],
  input: { name: string; country: string },
): T | undefined {
  const name = normalizeForComparison(input.name);
  const country = normalizeForComparison(input.country);

  return universities.find(
    (university) =>
      normalizeForComparison(university.country) === country &&
      (normalizeForComparison(university.name) === name ||
        (university.shortName !== null &&
          normalizeForComparison(university.shortName) === name)),
  );
}
