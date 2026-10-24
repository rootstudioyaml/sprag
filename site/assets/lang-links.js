/* Points every /docs/ link at /docs/ko/ while the page is in Korean, and back in English.
 * Each page's setLang sets <html lang>, so this only watches that attribute; links a page
 * re-renders later are caught at click time. Relative docs/ links on the home page keep
 * their own handling there. */
(function(){
  function target(href, ko){
    if(!/^\/docs\//.test(href)) return null;
    const rest = href.replace(/^\/docs\/(?:ko\/)?/, '');
    return (ko ? '/docs/ko/' : '/docs/') + rest;
  }
  function sync(){
    const ko = document.documentElement.lang === 'ko';
    document.querySelectorAll('a[href^="/docs/"]').forEach(a => {
      const to = target(a.getAttribute('href'), ko);
      if(to && to !== a.getAttribute('href')) a.setAttribute('href', to);
    });
  }
  sync();
  new MutationObserver(sync).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  document.addEventListener('click', e => {
    const a = e.target.closest && e.target.closest('a[href^="/docs/"]');
    if(!a) return;
    const to = target(a.getAttribute('href'), document.documentElement.lang === 'ko');
    if(to && to !== a.getAttribute('href')) a.setAttribute('href', to);
  }, true);
})();
