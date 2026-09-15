/**
 * changelog — read one version's section out of CHANGELOG.md.
 *
 * Separate from scripts/release-notes.mjs, which is a CLI: importing that file
 * runs its argument parsing and exits, so the extraction it depends on cannot be
 * tested through it. The boundary logic is the part worth pinning — a section
 * pulled one line short drops the release's last item, and one line long carries
 * the previous release's first, and the upgrade offer shows either without
 * complaint.
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
