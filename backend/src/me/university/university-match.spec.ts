import {
  collapseWhitespace,
  findMatchingUniversity,
} from './university-match.js';

const universities = [
  {
    id: 'liu',
    name: 'Lebanese International University',
    shortName: 'LIU',
    country: 'Lebanon',
  },
  {
    id: 'aub',
    name: 'American University of Beirut',
    shortName: 'AUB',
    country: 'Lebanon',
  },
  {
    id: 'liu-other',
    name: 'Lebanese International University',
    shortName: null,
    country: 'Yemen',
  },
  {
    id: 'montreal',
    name: 'Université de Montréal',
    shortName: null,
    country: 'Canada',
  },
];

describe('findMatchingUniversity (v1: findUniversity)', () => {
  it.each([
    ['the exact name', 'Lebanese International University', 'Lebanon', 'liu'],
    [
      'another letter case and extra spaces',
      '  lebanese   INTERNATIONAL university ',
      'lebanon',
      'liu',
    ],
    ['the short name', 'liu', 'Lebanon', 'liu'],
    ['a leading "The"', 'The American University of Beirut', 'Lebanon', 'aub'],
    ['missing accents', 'Universite de Montreal', 'Canada', 'montreal'],
  ])('matches %s', (_case, name, country, id) => {
    expect(findMatchingUniversity(universities, { name, country })?.id).toBe(
      id,
    );
  });

  it('only matches within the same country', () => {
    expect(
      findMatchingUniversity(universities, { name: 'LIU', country: 'Yemen' }),
    ).toBeUndefined();
    expect(
      findMatchingUniversity(universities, {
        name: 'Lebanese International University',
        country: 'Yemen',
      })?.id,
    ).toBe('liu-other');
  });

  it('returns undefined for an unknown university', () => {
    expect(
      findMatchingUniversity(universities, {
        name: 'Unknown',
        country: 'Lebanon',
      }),
    ).toBeUndefined();
  });
});

describe('collapseWhitespace', () => {
  it('trims and collapses inner whitespace', () => {
    expect(collapseWhitespace('  Lebanese \t International\nUniversity ')).toBe(
      'Lebanese International University',
    );
  });
});
