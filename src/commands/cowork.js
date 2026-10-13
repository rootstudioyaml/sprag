/**
 * Subcommand: cowork : keep the Claude app's Cowork tab on the same ratchet rules.
 *
 *   sprag cowork                  status
 *   sprag cowork sync             discover connected folders and write the copies now
 *   sprag cowork on | off         turn the sync on (and sync) or off (and remove the copies)
 *   sprag cowork exclude <dir>    never write into <dir> (removes its copy)
 *   sprag cowork include <dir>    undo exclude (and sync)
 */

import { resolve } from 'node:path';
import { realpathSync } from 'node:fs';

const REASONS = {
  ko: {
    'not-absolute': '절대 경로가 아님', missing: '폴더가 없음', 'not-a-directory': '디렉터리가 아님',
    'home-or-ancestor': '홈 디렉터리 또는 그 상위 경로', 'inside-claude-dir': '~/.claude 안',
    'inside-library': '~/Library 안', 'inside-sprag-data': 'sprag 데이터 폴더 안', excluded: '제외 목록에 있음',
    'not-owned': '같은 이름의 사용자 파일이 있어 덮어쓰지 않음', 'no-source': '복사할 원본 래칫 파일이 없음',
  },
  en: {
    'not-absolute': 'not an absolute path', missing: 'folder does not exist', 'not-a-directory': 'not a directory',
    'home-or-ancestor': 'the home directory or one of its parents', 'inside-claude-dir': 'inside ~/.claude',
    'inside-library': 'inside ~/Library', 'inside-sprag-data': 'inside the sprag data folder', excluded: 'on the exclude list',
    'not-owned': 'a user file of the same name exists, not overwritten', 'no-source': 'no source ratchet file to copy',
  },
};

const norm = (p) => {
  const abs = resolve(p);
  try { return realpathSync(abs); } catch { return abs; }
};

export async function run({ args }) {
  const cw = await import('../cowork-sync.js');
  const { userLanguage } = await import('../config.js');
  const ko = userLanguage() === 'ko';
  const why = (r) => (REASONS[ko ? 'ko' : 'en'][r] || r);
  const sub = args[1];

  const summarize = (r) => {
    console.log(ko
      ? `Cowork 래칫 동기화: 새로 씀 ${r.written.length}, 변경 없음 ${r.unchanged.length}, 건너뜀 ${r.skipped.length}, 제거 ${r.removed.length}`
      : `Cowork ratchet sync: written ${r.written.length}, unchanged ${r.unchanged.length}, skipped ${r.skipped.length}, removed ${r.removed.length}`);
    for (const d of r.written) console.log(`  + ${d}`);
    for (const d of r.removed) console.log(`  - ${d}`);
    for (const s of r.skipped) console.log(`  ! ${s.dir} (${why(s.reason)})`);
  };

  if (sub === 'sync') return summarize(cw.syncCoworkRatchets({ discover: true }));

  if (sub === 'off') {
    cw.saveCoworkConfig({ sync: false });
    console.log(ko ? 'Cowork 래칫 동기화를 껐습니다. 만들어 둔 사본을 지웁니다.' : 'Cowork ratchet sync is off. Removing the copies it made.');
    return summarize(cw.removeCoworkRatchets());
  }

  if (sub === 'on') {
    cw.saveCoworkConfig({ sync: true });
    console.log(ko ? 'Cowork 래칫 동기화를 켰습니다.' : 'Cowork ratchet sync is on.');
    return summarize(cw.syncCoworkRatchets({ discover: true }));
  }

  if (sub === 'exclude' || sub === 'include') {
    const target = args.slice(2).find((a) => !a.startsWith('-'));
    if (!target) {
      console.error(ko ? '폴더 경로를 지정하십시오.' : 'Pass a folder path.');
      process.exitCode = 1;
      return;
    }
    const dir = norm(target);
    const list = cw.coworkConfig().exclude;
    if (sub === 'exclude') {
      if (!list.includes(dir)) cw.saveCoworkConfig({ exclude: [...list, dir] });
      const removed = cw.removeCoworkRatchetIn(dir);
      console.log(ko
        ? `제외 목록에 추가했습니다: ${dir}${removed ? ' (사본을 지웠습니다)' : ''}`
        : `Added to the exclude list: ${dir}${removed ? ' (copy removed)' : ''}`);
      return;
    }
    cw.saveCoworkConfig({ exclude: list.filter((x) => x !== dir && norm(x) !== dir) });
    console.log(ko ? `제외 목록에서 뺐습니다: ${dir}` : `Removed from the exclude list: ${dir}`);
    return summarize(cw.syncCoworkRatchets({ discover: true }));
  }

  if (sub !== undefined) {
    console.error(ko ? `알 수 없는 하위 명령입니다: ${sub}` : `Unknown subcommand: ${sub}`);
    process.exitCode = 1;
    return;
  }

  const st = cw.coworkStatus();
  console.log(ko ? `Cowork 래칫 동기화: ${st.enabled ? '켜짐' : '꺼짐'}` : `Cowork ratchet sync: ${st.enabled ? 'on' : 'off'}`);
  console.log(ko ? `마지막 동기화: ${st.lastSync || '없음'}` : `Last sync: ${st.lastSync || 'never'}`);
  if (st.folders.length === 0) {
    console.log(ko ? '발견한 Cowork 연결 폴더가 없습니다.' : 'No Cowork folders discovered.');
    return;
  }
  console.log(ko ? '연결 폴더:' : 'Connected folders:');
  for (const f of st.folders) {
    const state = f.hasCopy ? (ko ? '사본 있음' : 'copy present')
      : f.foreign ? why('not-owned')
      : f.eligible ? (ko ? '사본 없음' : 'no copy yet')
      : (ko ? `제외: ${why(f.reason)}` : `skipped: ${why(f.reason)}`);
    console.log(`  ${f.dir}  [${state}]`);
  }
}
