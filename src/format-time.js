/**
 * Shared "resets in" countdown formatter. The 7-day window can be ~5 days
 * away, so we promote whole-day spans into a `Xd Yh` shape; otherwise it's
 * `Xh Ym` for ≥1h and `Xm` under that.
 *
 * @param {number} resetsAt - Unix-epoch seconds when the window resets.
 * @param {Date} [now=new Date()]
 * @returns {string|null} formatted countdown, or null when the input isn't usable.
 */
export function formatResetIn(resetsAt, now = new Date()) {
  if (!Number.isFinite(resetsAt)) return null;
  const remainingSec = Math.max(0, resetsAt - Math.floor(now.getTime() / 1000));
  if (remainingSec <= 0) return '0m';
  const d = Math.floor(remainingSec / 86400);
  const h = Math.floor((remainingSec % 86400) / 3600);
  const m = Math.floor((remainingSec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/**
 * Wall-clock time at which the window resets, in the user's local timezone.
 * Same-day resets show `HH:MM`; resets that cross midnight prepend the weekday
 * (e.g. `Sat 21:30`) so a glance at the statusline doesn't mislead.
 *
 * @param {number} resetsAt - Unix-epoch seconds.
 * @param {Date} [now=new Date()]
 * @returns {string|null}
 */
export function formatResetClock(resetsAt, now = new Date()) {
  if (!Number.isFinite(resetsAt)) return null;
  const reset = new Date(resetsAt * 1000);
  if (Number.isNaN(reset.getTime())) return null;
  const hh = String(reset.getHours()).padStart(2, '0');
  const mm = String(reset.getMinutes()).padStart(2, '0');
  const sameDay =
    reset.getFullYear() === now.getFullYear() &&
    reset.getMonth() === now.getMonth() &&
    reset.getDate() === now.getDate();
  if (sameDay) return `${hh}:${mm}`;
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][reset.getDay()];
  return `${dow} ${hh}:${mm}`;
}
