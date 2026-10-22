import { tracks } from './catalog.js';

// A small, explicit vocabulary for the prototype; Gemini will replace parsing later.
const vocabulary = [
  [/linkin\s+park/iu, ['alternative', 'metal', 'rock']],
  [/evanescence/iu, ['alternative', 'metal', 'rock']],
  [/within\s+temptation/iu, ['symphonic', 'metal', 'rock']],
  [/daft\s+punk/iu, ['funk', 'dance']],
  [/\brock\b|рок/iu, ['rock']],
  [/\bmetal\b|метал/iu, ['metal']],
  [/\balternative\b|альтернатив/iu, ['alternative']],
  [/\bsymphonic\b|симфонич/iu, ['symphonic']],
  [/\bpop\b|поп/iu, ['pop']],
  [/\bfunk\b|фанк/iu, ['funk']],
  [/\bdance\b|танцев/iu, ['dance']],
  [/\benergetic\b|энергич/iu, ['energetic']]
];

export function findTracks(description) {
  const tags = [...new Set(vocabulary.flatMap(([pattern, values]) =>
    pattern.test(description) ? values : []))];
  const female = /женск|\bfemale\b/iu.test(description);
  const male = /мужск|\bmale\b/iu.test(description);
  // Contradictory vocal constraints are intentionally not guessed.
  if (female && male) return [];
  const vocals = female ? 'female' : male ? 'male' : null;

  return tracks
    .filter(track => !vocals || track.vocals === vocals)
    .map(track => ({
      ...track,
      matchedTags: track.tags.filter(tag => tags.includes(tag))
    }))
    .filter(track => track.matchedTags.length > 0 || (vocals && tags.length === 0))
    .sort((a, b) => b.matchedTags.length - a.matchedTags.length);
}
