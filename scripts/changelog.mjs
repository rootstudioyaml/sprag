/**
 * changelog — read one version's section out of CHANGELOG.md, and say whether a
 * notes draft is still waiting on a person.
 *
 * Separate from scripts/release-notes.mjs, which is a CLI: importing that file
 * runs its argument parsing and exits, so the extraction it depends on cannot be
 * tested through it. The boundary logic is the part worth pinning — a section
 * pulled one line short drops the release's last item, and one line long carries
 * the previous release's first, and the upgrade offer shows either without
 * complaint.
 *
 * The draft marker lives here for a reason. Two scripts gate on it — the one that
 * writes drafts and the one that deploys — and they used to carry the string
 * separately. Renaming it in one left the other looking for text that no longer
 * existed, and a gate that greps for an absent string does not fail: it passes,
 * and an unreviewed draft goes out as the release. One definition, imported.
 */

/**
 * The body of one version's section, heading excluded.
 *
 * @param {string} changelog - CHANGELOG.md contents
 * @param {string} version - e.g. "3.45.0"
 * @returns {string|null} the section text, or null when that version has none
 */
export function sectionFor(changelog, version) {
  const lines = String(changelog).split(/\r?\n/);
  // The version has to match to its end: without the boundary, "3.42.0" would
  // also match the "### v3.42.7" heading and publish the wrong notes.
  const head = new RegExp(`^### v${String(version).replace(/\./g, '\\.')}(\\s|$|\\()`);
  const start = lines.findIndex((l) => head.test(l));
  if (start < 0) return null;
  const out = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    // The next version heading ends this section, and so does a shallower one:
    // "## All releases" is a container, not part of any release.
    if (/^### v/.test(lines[i]) || /^## /.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out.join('\n').trim();
}

/**
 * The line `release-notes.mjs` writes at the top of a fresh draft, and the line
 * every gate refuses on. A draft still carrying it has not been through a person.
 */
export const DRAFT_MARKER =
  '<!-- REVIEW: edit this draft, add the English half, then delete this line -->';

/** Heading that opens the Korean half of a bilingual release body. */
export const KO_HEADING = '## 한국어';

/**
 * The opening of the marker, which is what the gate actually matches. Spelled out
 * rather than sliced off `DRAFT_MARKER`, so that editing the marker's front does
 * not silently change what is being tested for.
 */
const REVIEW_OPENING = '<!-- REVIEW:';

/**
 * Whether a draft still needs review. Matches on the `<!-- REVIEW:` opening
 * rather than the whole line, so editing the wording of the instruction does not
 * quietly disarm the gate.
 *
 * @param {string} draft - the draft file's contents
 * @returns {boolean} true while the draft is unreviewed
 */
export function needsReview(draft) {
  return String(draft || '').includes(REVIEW_OPENING);
}
