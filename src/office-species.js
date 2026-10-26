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

/** `"<emoji> <name>"` for a grade key in the given language, or null for an unknown key. */
export function speciesLabel(grade, lang = 'en') {
  const s = Object.prototype.hasOwnProperty.call(SPECIES, grade) ? SPECIES[grade] : null;
  return s ? `${s.emoji} ${lang === 'ko' ? s.ko : s.en}` : null;
}
