// Light / dark switch for pages built on assets/tokens.css. Paper (light) is the default whatever the system
// setting; a click pins the other mode in localStorage. The <head>
// snippet reads the same key before first paint so the page never flashes the wrong mode.
// Pages whose header has no switch yet get one placed after the language toggle.
(function () {
  var KEY = 'sprag-theme';
  var root = document.documentElement;
  var ICONS = '<svg class="i-moon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M13.5 9.6A5.6 5.6 0 0 1 6.4 2.5a5.6 5.6 0 1 0 7.1 7.1Z"/></svg>' +
    '<svg class="i-sun" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="3"/><path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1"/></svg>';

  // Base look for headers that do not load site-header.css; header.site-hdr rules there take over.
  var st = document.createElement('style');
  st.textContent = '.theme-tg{display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;width:32px;height:28px;margin-left:8px;padding:0;' +
    'border:1px solid var(--line2);border-radius:0;background:transparent;color:var(--dim);cursor:pointer}' +
    '.theme-tg:hover{color:var(--ink);border-color:var(--line3)}.theme-tg svg{width:16px;height:16px;display:block}' +
    '.theme-tg .i-moon{display:none}:root[data-theme=dark] .theme-tg .i-moon{display:block}:root[data-theme=dark] .theme-tg .i-sun{display:none}' +
    '';
  document.head.appendChild(st);

  function place() {
    document.querySelectorAll('header .lang').forEach(function (lang) {
      if (lang.parentElement.querySelector('.theme-tg')) return;
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'theme-tg';
      b.setAttribute('aria-label', 'Light / dark theme'); b.title = 'Light / dark theme';
      b.innerHTML = ICONS;
      lang.insertAdjacentElement('afterend', b);
    });
  }
  function current() { return root.dataset.theme === 'dark' ? 'dark' : 'light'; }
  function syncMeta() {
    var meta = document.querySelector('meta[name=theme-color]');
    if (meta) meta.content = getComputedStyle(document.body).backgroundColor;
  }
  function set(mode) {
    if (mode === 'system' || mode === 'light') { delete root.dataset.theme; try { localStorage.removeItem(KEY); } catch (e) {} }
    else { root.dataset.theme = mode; try { localStorage.setItem(KEY, mode); } catch (e) {} }
    syncMeta();
    document.dispatchEvent(new CustomEvent('sprag:theme', { detail: current() }));
  }
  window.SpragTheme = { set: set, current: current, saved: function () { return root.dataset.theme || 'system'; } };

  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('.theme-tg');
    if (btn) set(current() === 'light' ? 'dark' : 'light');
  });
  place(); syncMeta();
})();
