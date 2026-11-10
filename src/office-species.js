/**
 * office-species — the animal each member gets in the team's virtual office
 * ("Sprag Town"), as the statusline shows it: an emoji and a name per grade.
 *
 * The keys are the GRADES keys of site/assets/scene/office-scene.js plus
 * 'ghost' (no uploaded data), and the names are the `of.g.<key>` strings of
 * site/team/index.html. test/office-species.test.js pins both, so the console
 * and the terminal cannot drift apart.
 */

export const SPECIES = {
  dragon: { emoji: '🐉', en: 'Dragon', ko: '용' },
  unicorn: { emoji: '🦄', en: 'Unicorn', ko: '유니콘' },
  lion: { emoji: '🦁', en: 'Lion', ko: '사자' },
  tiger: { emoji: '🐯', en: 'Tiger', ko: '호랑이' },
  eagle: { emoji: '🦅', en: 'Eagle', ko: '독수리' },
  wolf: { emoji: '🐺', en: 'Wolf', ko: '늑대' },
  cheetah: { emoji: '🐆', en: 'Cheetah', ko: '치타' },
  fox: { emoji: '🦊', en: 'Fox', ko: '여우' },
  owl: { emoji: '🦉', en: 'Owl', ko: '부엉이' },
  husky: { emoji: '🐕', en: 'Husky', ko: '허스키' },
  panda: { emoji: '🐼', en: 'Panda', ko: '판다' },
  koala: { emoji: '🐨', en: 'Koala', ko: '코알라' },
  penguin: { emoji: '🐧', en: 'Penguin', ko: '펭귄' },
  raccoon: { emoji: '🦝', en: 'Raccoon', ko: '너구리' },
  cat: { emoji: '🐱', en: 'Cat', ko: '고양이' },
  dog: { emoji: '🐶', en: 'Dog', ko: '강아지' },
  bear: { emoji: '🐻', en: 'Bear', ko: '곰' },
  monkey: { emoji: '🐵', en: 'Monkey', ko: '원숭이' },
  deer: { emoji: '🦌', en: 'Deer', ko: '사슴' },
  elephant: { emoji: '🐘', en: 'Elephant', ko: '코끼리' },
  pig: { emoji: '🐷', en: 'Pig', ko: '돼지' },
  sheep: { emoji: '🐑', en: 'Sheep', ko: '양' },
  rabbit: { emoji: '🐰', en: 'Rabbit', ko: '토끼' },
  duck: { emoji: '🦆', en: 'Duck', ko: '오리' },
  hedgehog: { emoji: '🦔', en: 'Hedgehog', ko: '고슴도치' },
  squirrel: { emoji: '🐿️', en: 'Squirrel', ko: '다람쥐' },
  hamster: { emoji: '🐹', en: 'Hamster', ko: '햄스터' },
  frog: { emoji: '🐸', en: 'Frog', ko: '개구리' },
  mouse: { emoji: '🐭', en: 'Mouse', ko: '생쥐' },
  chick: { emoji: '🐤', en: 'Chick', ko: '병아리' },
  ghost: { emoji: '👻', en: 'Ghost', ko: '유령' },
};

/**
 * The species ladder, best first: the overall-score percentile a species starts
 * at (`minSr`), its tier, and whether it also needs the delegation share at or
 * above the company median (`needDlg`). `gt` marks a strict floor. Copied from
 * GRADES in site/assets/scene/office-scene.js, and test/office-species.test.js
 * pins the two, so `sprag team status` and the office page show one ladder.
 * The chick is the idle row (no spend in the period) and has no floor.
 */
const row = (key, minSr, tier, needDlg = false, gt = false) => ({ key, minSr, tier, needDlg, gt });
export const GRADES = [
  row('dragon', 0.98, 'power', true), row('unicorn', 0.95, 'power', true), row('lion', 0.92, 'power', true),
  row('tiger', 0.89, 'power', true), row('eagle', 0.85, 'power', true), row('wolf', 0.8, 'power', true),
  row('cheetah', 0.77, 'active'), row('fox', 0.74, 'active'), row('owl', 0.71, 'active'), row('husky', 0.68, 'active'),
  row('panda', 0.65, 'active'), row('koala', 0.62, 'active'), row('penguin', 0.58, 'active'), row('raccoon', 0.54, 'active'),
  row('cat', 0.5, 'active'),
  row('dog', 0.47, 'normal'), row('bear', 0.44, 'normal'), row('monkey', 0.41, 'normal'), row('deer', 0.38, 'normal'),
  row('elephant', 0.35, 'normal'), row('pig', 0.32, 'normal'), row('sheep', 0.29, 'normal'), row('rabbit', 0.25, 'normal', false, true),
  row('duck', 0.22, 'low'), row('hedgehog', 0.19, 'low'), row('squirrel', 0.16, 'low'), row('hamster', 0.12, 'low'),
  row('frog', 0.08, 'low'), row('mouse', 0.04, 'low'), row('chick', -1, 'low'),
];

/**
 * Below `n` ranked people the score percentile is squeezed into [lo, hi], so two
 * people never land on the chick by percentile alone. Copied from SMALL_TEAM and
 * squeezeSr in site/assets/scene/office-scene.js; test/office-species.test.js
 * pins the two.
 */
export const SMALL_TEAM = { n: 5, lo: 0.3, hi: 0.7 };
export function squeezeSr(sr, n) {
  return n < SMALL_TEAM.n ? SMALL_TEAM.lo + (SMALL_TEAM.hi - SMALL_TEAM.lo) * sr : sr;
}

/** Tier names as the office page shows them (`of.tier.<tier>` in site/team/index.html). */
export const TIER_NAMES = {
  power: { en: 'AI power user', ko: 'AI 파워 유저' },
  active: { en: 'Active', ko: '활발' },
  normal: { en: 'Normal', ko: '보통' },
  low: { en: 'Getting started', ko: '활용 장려 필요' },
};

/**
 * `"<emoji> <name>"` for a grade key in the given language, or null for an unknown key.
 * `emoji: false` leaves just the name, for terminals whose font has no animal emoji (IntelliJ).
 */
export function speciesLabel(grade, lang = 'en', { emoji = true } = {}) {
  const s = Object.prototype.hasOwnProperty.call(SPECIES, grade) ? SPECIES[grade] : null;
  if (!s) return null;
  const name = lang === 'ko' ? s.ko : s.en;
  return emoji ? `${s.emoji} ${name}` : name;
}
