/* fur.js pure functions: the cloth mask rule, the shell count by screen size and the cast gain (site/assets/scene/fur.js) */
import test from 'node:test';
import assert from 'node:assert/strict';
const load = () => import('../site/assets/scene/fur.js');

test('cloth colours: green, saturated blue, purple are cloth; warm and grey-blue fur is not', async () => {
  const { isClothRgb } = await load();
  assert.equal(isClothRgb(60, 160, 90), true);      /* green vest */
  assert.equal(isClothRgb(40, 80, 200), true);      /* blue shirt */
  assert.equal(isClothRgb(150, 110, 210), true);    /* lavender */
  assert.equal(isClothRgb(220, 170, 120), false);   /* cat orange */
  assert.equal(isClothRgb(240, 240, 235), false);   /* white fur */
  assert.equal(isClothRgb(120, 130, 135), false);   /* wolf grey-blue: green over red but under the threshold */
});
test('only skin, wings and tail tips grow fur', async () => {
  const { isFurMaterial } = await load();
  for(const n of ['skin', 'skin.001', 'wing', 'wingc', 'tailf', 'tailtip']) assert.equal(isFurMaterial(n), true, n);
  for(const n of ['eye', 'white', 'nose', 'beak', 'logo_a', 'acc_hat', '', undefined]) assert.equal(isFurMaterial(n), false, String(n));
});
test('shell count follows the fur length in screen pixels, 4 to 16, none when too small', async () => {
  const { furShellCount } = await load();
  assert.equal(furShellCount(0.056, 62 * 1.6, 16), 6);    /* office overview */
  assert.equal(furShellCount(0.056, 145 * 1.6, 16), 14);  /* office close-up */
  assert.equal(furShellCount(0.056, 400, 16), 16);        /* capped */
  assert.equal(furShellCount(0.056, 40, 16), 4);          /* floor */
  assert.equal(furShellCount(0.056, 20, 16), 0);          /* under 1.6 px of fur: off */
  assert.equal(furShellCount(0.056, 400, 0), 0);          /* shells disabled */
});
test('cast gain: warm by day, nearly neutral at night, clamped', async () => {
  const { castGain, GAIN_DAY, GAIN_NIGHT } = await load();
  assert.deepEqual(castGain(0), GAIN_DAY);
  assert.deepEqual(castGain(1), GAIN_NIGHT);
  assert.deepEqual(castGain(5), GAIN_NIGHT);
  assert.ok(castGain(0)[0] > castGain(0)[2]);
  assert.ok(castGain(1)[0] <= 1.05);
});
