/**
 * json-text: JSON parsing for files other tools write.
 *
 * Windows PowerShell saves UTF-8 files with a leading BOM (U+FEFF), and
 * JSON.parse rejects it ("Unexpected token"). Claude Code's own settings.json
 * reads fine with a BOM, so sprag must too. Leaf module: no imports.
 */

/** JSON.parse that first strips one leading U+FEFF. */
export function parseJsonText(text) {
  const s = String(text);
  return JSON.parse(s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);
}
