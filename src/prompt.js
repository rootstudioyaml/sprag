/**
 * prompt — minimal yes/no prompting for the install flow.
 *
 * Everything here exists to answer one question: may we stop and ask, or must
 * we fall back to a default? Most installs of this package run as npm's
 * postinstall, where stdin is not a terminal and a readline prompt would either
 * hang the install or read garbage. So the rule is: ask only when a human is
 * demonstrably on the other end, and otherwise keep the previous
 * decide-it-for-them behavior untouched.
 */

import { createInterface } from 'node:readline';

/**
 * Whether it is safe to block on a question.
 *
 * `npm_lifecycle_event` is checked in addition to the TTY test because npm can
 * leave a TTY attached while still running the script unattended; CI is
 * checked because build agents deadlock rather than answer.
 */
export function canPrompt({ env = process.env, stdin = process.stdin, stdout = process.stdout } = {}) {
  if (env.CTS_NO_INPUT === '1') return false;
  if (env.CI && env.CI !== 'false') return false;
  if (env.npm_lifecycle_event === 'postinstall') return false;
  return Boolean(stdin.isTTY && stdout.isTTY);
}

/**
 * Ask a yes/no question and resolve to a boolean.
 *
 * An empty answer takes `defaultValue`, which is also what a closed stream
 * resolves to, so a prompt that somehow runs unattended still terminates with
 * the same choice the non-interactive path would have made.
 */
export function confirm(question, { defaultValue = true, input = process.stdin, output = process.stdout } = {}) {
  const hint = defaultValue ? '[Y/n]' : '[y/N]';
  return new Promise((resolve) => {
    const rl = createInterface({ input, output });
    let answered = false;
    rl.question(`${question} ${hint} `, (answer) => {
      answered = true;
      rl.close();
      const a = String(answer).trim().toLowerCase();
      if (a === 'y' || a === 'yes') return resolve(true);
      if (a === 'n' || a === 'no') return resolve(false);
      resolve(defaultValue); // empty line, or anything we do not recognize
    });
    // A stream that ends without a line — a closed pipe, Ctrl-D — must still
    // settle the promise, or the install would wait forever.
    rl.on('close', () => { if (!answered) resolve(defaultValue); });
  });
}

/**
 * Ask a multiple-choice question and resolve to the chosen `key`.
 *
 * Choices are printed as a numbered list; the answer may be the 1-based number
 * or the key itself. Like confirm(), anything unrecognized (empty line, typo,
 * closed stream) resolves to the default, so an unattended prompt ends with
 * the same choice the non-interactive path would have made.
 */
export function choose(question, choices, { defaultIndex = 0, defaultHint = '(default)', input = process.stdin, output = process.stdout } = {}) {
  const fallback = choices[defaultIndex]?.key ?? choices[0].key;
  const lines = choices.map((c, i) => `    ${i + 1}) ${c.label}${i === defaultIndex ? ` ${defaultHint}` : ''}`);
  return new Promise((resolve) => {
    const rl = createInterface({ input, output });
    let answered = false;
    output.write(`${question}\n${lines.join('\n')}\n`);
    rl.question(`  [1-${choices.length}] `, (answer) => {
      answered = true;
      rl.close();
      const a = String(answer).trim().toLowerCase();
      const n = Number(a);
      if (Number.isInteger(n) && n >= 1 && n <= choices.length) return resolve(choices[n - 1].key);
      const byKey = choices.find((c) => String(c.key).toLowerCase() === a);
      resolve(byKey ? byKey.key : fallback);
    });
    rl.on('close', () => { if (!answered) resolve(fallback); });
  });
}
