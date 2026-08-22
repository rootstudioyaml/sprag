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
