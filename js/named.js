// Rhythms named in Lascabettes & Bloch (2024). Onsets use the paper's
// convention: pulses numbered 0…n−1, first onset at 0. The UI shows pulses
// as 1…n, so pulse numbers written in the notes below are 1-based.

export const GROUPS = [
  {
    id: 'toussaint',
    title: 'Toussaint’s six distinguished rhythms',
    blurb:
      'Five onsets over sixteen pulses. Toussaint studied these timelines to ask what makes a “good” rhythm good (Fig. 1 and Table 1 of the paper).',
  },
  {
    id: 'other',
    title: 'Other rhythms from the paper',
    blurb:
      'Musically important rhythms that the method ranks first, or close to first, for their k and n (Section 4).',
  },
];

export const NAMED = [
  {
    id: 'son',
    name: 'Son clave',
    group: 'toussaint',
    n: 16,
    onsets: [0, 3, 6, 10, 12],
    tagline: 'Cuba',
    notes: [
      'Toussaint predicted it would be the best of the six, and it has the highest score of all 1,365 rhythms with k = 5 and n = 16.',
      'It has the best balance of any (5, 16) rhythm, and it is the only one of the six that maximizes shadow.',
    ],
  },
  {
    id: 'bossa-nova',
    name: 'Bossa-nova',
    group: 'toussaint',
    n: 16,
    onsets: [0, 3, 6, 10, 13],
    tagline: 'Brazil',
    notes: [
      'A rotation of the Euclidean rhythm E(5, 16): it maximizes evenness, area and deepness, but it is less balanced than the son.',
      'It is ranked 20th in the paper’s Figure 2.',
    ],
  },
  {
    id: 'gahu',
    name: 'Gahu',
    group: 'toussaint',
    n: 16,
    onsets: [0, 3, 6, 10, 14],
    tagline: 'Ghana',
    notes: ['Onsets 7 and 15 are exactly half a cycle apart, which costs it on oddity. It also has the lowest possible deepness for (5, 16).'],
  },
  {
    id: 'rumba',
    name: 'Rumba clave',
    group: 'toussaint',
    n: 16,
    onsets: [0, 3, 7, 10, 12],
    tagline: 'Cuba',
    notes: ['It is ranked 11th in the paper’s Figure 2. It differs from the son clave only in its third onset.'],
  },
  {
    id: 'shiko',
    name: 'Shiko',
    group: 'toussaint',
    n: 16,
    onsets: [0, 4, 6, 10, 12],
    tagline: 'African timeline',
    notes: ['It is deep and symmetric, but its second onset falls on a strong beat (pulse 5), so it has almost no aperture.'],
  },
  {
    id: 'soukous',
    name: 'Soukous',
    group: 'toussaint',
    n: 16,
    onsets: [0, 3, 6, 10, 11],
    tagline: 'Central Africa',
    notes: ['Its last onset is on an odd pulse, so it has no closure. It has the lowest score of the six.'],
  },
  {
    id: 'tresillo',
    name: 'Tresillo',
    group: 'other',
    n: 8,
    onsets: [0, 3, 6],
    tagline: 'Latin & Afro-Cuban music',
    notes: [
      'The highest-scoring rhythm with k = 3 and n = 8.',
      'Its second onset (4) is on a weak beat, which creates tension (aperture). Its last onset (7) is not, which reads as a resolution (closure).',
    ],
  },
  {
    id: 'fume-fume',
    name: 'Fume-fume',
    group: 'other',
    n: 12,
    onsets: [0, 2, 4, 7, 9],
    tagline: 'West Africa',
    notes: ['The highest-scoring rhythm with k = 5 and n = 12.'],
  },
  {
    id: 'samba',
    name: 'Samba',
    group: 'other',
    n: 16,
    onsets: [0, 2, 5, 7, 9, 12, 14],
    tagline: 'Brazil',
    notes: [
      'The samba necklace scores highest for k = 7 and n = 16, in the rotation {1, 4, 6, 8, 11, 13, 15}.',
      'The samba as it is actually played is that rotation shifted by 2 pulses, shown here.',
    ],
    related: [{ label: 'Top-scoring rotation', onsets: [0, 3, 5, 7, 10, 12, 14] }],
  },
  {
    id: 'reich',
    name: 'Steve Reich’s signature rhythm',
    group: 'other',
    n: 12,
    onsets: [0, 1, 2, 4, 5, 7, 9, 10],
    tagline: 'Clapping Music (1972)',
    notes: ['The highest-scoring rhythm with k = 8 and n = 12. Reich uses it in Clapping Music and many other works.'],
  },
  {
    id: 'bembe',
    name: 'Bembé',
    group: 'other',
    n: 12,
    onsets: [0, 2, 4, 5, 7, 9, 11],
    tagline: 'Afro-Cuban 12/8 bell pattern',
    notes: [
      'One of the most popular rhythms with k = 7 and n = 12, but not the highest scoring: it does poorly on closure and aperture.',
      'Its rotation by one pulse, {1, 2, 4, 6, 7, 9, 11}, is the top-scoring rhythm for k = 7 and n = 12.',
    ],
    related: [{ label: 'Top-scoring rotation', onsets: [0, 1, 3, 5, 6, 8, 10] }],
  },
];

export const NAMED_BY_ID = new Map(NAMED.map((r) => [r.id, r]));

/** (k, n) spaces needed to score the named rhythms. */
export function namedSpaces() {
  const spaces = new Map();
  for (const r of NAMED) {
    const key = `${r.onsets.length},${r.n}`;
    if (!spaces.has(key)) spaces.set(key, { k: r.onsets.length, n: r.n, rhythms: [] });
    spaces.get(key).rhythms.push(r);
  }
  return [...spaces.values()];
}
