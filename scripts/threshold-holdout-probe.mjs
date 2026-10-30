#!/usr/bin/env node
// Offline probe: do the output thresholds route-scan recalibrates on every
// scan hold up on days they were not fitted on?
//
// JEV-as-a-Judge (arXiv 2609.26550) freezes its confidence threshold before
// looking at the evaluation data and validates it on held-out pairs. route-scan
// instead refits t2Out/t1Out/t1hOut from the current window on each scan, so
// the window that sets a threshold is also the window it is applied to. This
// probe freezes thresholds on the older part of the window, applies them to
// the most recent days, and counts how many episodes would land in a different
// tier than under thresholds fitted the way the scan fits them.
//
// Read-only. Usage: node scripts/threshold-holdout-probe.mjs [days=30] [holdoutDays=7]

import { categorize, tierOf, calibrateThresholds, isSkippable, episodeRank, worthDelegating } from '../src/route-scan.js';
import { fold, loadEpisodes } from './lib/episodes.mjs';

const nums = process.argv.slice(2).filter((a) => /^\d+$/.test(a)).map(Number);
const days = nums[0] || 30;
const holdoutDays = nums[1] || 7;
const DAY = 86400000;

const eps = (await loadEpisodes(days)).map((e) => fold(e.recs, e.text)).filter((ep) => Number.isFinite(ep.startedAt));
const now = Math.max(...eps.map((ep) => ep.startedAt));
const cut = now - holdoutDays * DAY;
const train = eps.filter((ep) => ep.startedAt < cut);
const hold = eps.filter((ep) => ep.startedAt >= cut);

const fitted = {
  frozen: calibrateThresholds(train.map((ep) => ep.out)),
  // What route-scan does on the day the held-out window ends: the last 14 days, held-out days included.
  scan: calibrateThresholds(eps.filter((ep) => ep.startedAt >= now - 14 * DAY).map((ep) => ep.out)),
  holdout: calibrateThresholds(hold.map((ep) => ep.out)),
};

const tierable = hold.filter((ep) => !isSkippable(ep.text) && worthDelegating('T2', episodeRank(ep)))
  .map((ep) => ({ ep, cat: categorize(ep.text, ep.tools) }))
  .filter((x) => x.cat);
const tiersUnder = (th) => tierable.map((x) => tierOf(x.ep, x.cat, th));
const frozenTiers = tiersUnder(fitted.frozen);
const disagree = (th) => tiersUnder(th).filter((t, i) => t !== frozenTiers[i]).length;

const fmt = (th) => `t2Out ${th.t2Out} · t1Out ${th.t1Out} · t1hOut ${th.t1hOut}${th.calibrated ? '' : ' (defaults: under 100 episodes)'}`;
console.log(`window ${days}d · train ${train.length} episodes · held-out last ${holdoutDays}d ${hold.length} episodes (${tierable.length} tierable)`);
for (const [name, th] of Object.entries(fitted)) console.log(`  ${name.padEnd(8)} ${fmt(th)}`);
console.log(`tier changes on held-out episodes vs frozen: scan-style ${disagree(fitted.scan)}/${tierable.length} · refit on held-out ${disagree(fitted.holdout)}/${tierable.length}`);

// Week-by-week drift of the thresholds themselves.
for (let w = 0; w * 7 < days; w++) {
  const hi = now - w * 7 * DAY;
  const slice = eps.filter((ep) => ep.startedAt < hi && ep.startedAt >= hi - 7 * DAY);
  if (slice.length) console.log(`  week -${w}: ${String(slice.length).padStart(4)} episodes · ${fmt(calibrateThresholds(slice.map((ep) => ep.out)))}`);
}
