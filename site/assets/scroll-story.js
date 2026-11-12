/* Scroll story (references: heronaiapp.com, tresmarescapital.com). Full on the home page; on the other marketing pages
 * only the shared parts run: headings rise or fill, blocks slide up, the progress line.
 * The page unfolds as it scrolls:
 * - the intro stays pinned while its five steps tick past and the Sprag mark turns. Like the clutch it is named after,
 *   it only ever turns one way: scrolling back up keeps it going forward.
 * - headings rise word by word, blocks slide up once as they enter, figures count up, the limit bar fills,
 *   the terminal comparison opens from an inset to the full row, and the three steps of "How it works" play one at a time
 *   on a pinned stage while a second mark turns one click per step.
 * - a 2px accent line tracks the page.
 * Lenis (loaded before this file) smooths wheel scrolling when it is available; touch keeps native scrolling.
 * The head script adds html.story only when motion is allowed; under prefers-reduced-motion nothing here runs
 * and every element stays in its finished state. */
(function () {
  var root = document.documentElement;
  if (!root.classList.contains('story')) return;
  window.__story = true;
  var H = innerHeight;
  addEventListener('resize', function () { H = innerHeight; });
  var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };

  /* ---------- words ---------- */
  var n = 0;
  function split(el) {
    if (el.querySelector('.w')) return;
    var i = 0;
    (function walk(node) {
      Array.prototype.slice.call(node.childNodes).forEach(function (c) {
        if (c.nodeType === 3) {
          var frag = document.createDocumentFragment();
          c.textContent.split(/(\s+)/).forEach(function (p) {
            if (!p) return;
            if (/^\s+$/.test(p)) { frag.appendChild(document.createTextNode(p)); return; }
            var w = document.createElement('span'), s = document.createElement('span');
            w.className = 'w'; s.textContent = p; s.style.setProperty('--i', i++);
            w.appendChild(s); frag.appendChild(w);
          });
          c.parentNode.replaceChild(frag, c);
        } else if (c.nodeType === 1 && c.tagName !== 'BR') walk(c);
      });
    })(el);
    el.classList.add('is-split');
  }
  /* the intro headline rises word by word; section headings fill with ink in reading order as they pass */
  var home = !!document.querySelector('.intro');
  var splits = Array.prototype.slice.call(document.querySelectorAll(home ? '[data-split], body > section h2, .hero h3' : '[data-split], main h1, main h2'));
  var fills = [];
  splits.forEach(function (el) {
    if (!el.closest('.intro') && el.tagName !== 'H1') { el.setAttribute('data-fill', ''); fills.push(el); }
    el.setAttribute('data-split', ''); split(el);
  });
  var words = function (el) { return el._w || (el._w = Array.prototype.slice.call(el.querySelectorAll('.w > span'))); };
  document.addEventListener('sprag:lang', function () { splits.forEach(function (el) { el._w = null; split(el); }); });

  /* ---------- blocks ---------- */
  var groups = [
    '.numbers .num', '.hero .teamband', '.hero .compare figcaption', '.explain .ex-card', '.hero .demo',
    '.setup .agent-switch', '.setup .setup-panel:not([hidden])', '#how .wrap > p', '#routing .wrap > :not(h2)',
    '#features .wrap > :not(h2)', '#features .feat', '#faq details', '.docs-strip .wrap > *', '.cta .wrap > :not(h2)', 'footer .wrap'
  ];
  /* other pages: every block of a section slides up once */
  if (!home) groups = ['main section > :not(h1):not(h2)', 'main > .wrap > :not(h1):not(h2):not(section)', 'footer .wrap'];
  var rv = [];
  groups.forEach(function (sel) {
    Array.prototype.slice.call(document.querySelectorAll(sel)).forEach(function (el, k) {
      if (el.closest('.intro') || el.classList.contains('rv')) return;
      el.classList.add('rv'); el.style.setProperty('--i', Math.min(k, 6)); rv.push(el);
    });
  });

  /* ---------- figures ---------- */
  function countUp(b) {
    var m = b.textContent.match(/^(\D*)([\d,]+(?:\.\d+)?)(.*)$/);
    if (!m) return;
    var pre = m[1], num = parseFloat(m[2].replace(/,/g, '')), post = m[3], dec = (m[2].split('.')[1] || '').length, t0 = 0;
    var fmt = function (v) { return pre + v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }) + post; };
    b.style.fontVariantNumeric = 'tabular-nums';
    (function tick(t) {
      if (!t0) t0 = t;
      var k = clamp((t - t0) / 1400, 0, 1), e = 1 - Math.pow(2, -10 * k);
      b.textContent = fmt(k < 1 ? num * e : num);
      if (k < 1) requestAnimationFrame(tick);
    })(performance.now());
  }

  var io = new IntersectionObserver(function (es) {
    es.forEach(function (e) {
      if (!e.isIntersecting) return;
      var el = e.target; el.classList.add('in'); io.unobserve(el);
      if (el.matches('.numbers .num')) { var b = el.querySelector('b'); if (b) countUp(b); }
    });
  }, { rootMargin: '0px 0px -10% 0px', threshold: 0.12 });
  splits.filter(function (el) { return !el.hasAttribute('data-fill'); }).concat(rv).forEach(function (el) { io.observe(el); });
  var explain = document.querySelector('.explain'); if (explain) io.observe(explain);

  /* first load: two frames after the split so the starting states are painted before they transition */
  var introEl = document.querySelector('.intro');
  if (introEl) requestAnimationFrame(function () { requestAnimationFrame(function () { introEl.classList.add('booted'); }); });

  /* ---------- smooth wheel ---------- */
  var lenis = null;
  if (window.Lenis && !matchMedia('(pointer: coarse)').matches) {
    try {
      lenis = new window.Lenis({ lerp: 0.12, anchors: true,
        prevent: function (node) { return !!(node.closest && node.closest('#pd, .popover, .flow, dialog, [data-lenis-prevent]')); } });
    } catch (e) { lenis = null; }
  }

  /* ---------- per frame ---------- */
  var intro = document.querySelector('.intro');
  var items = intro ? Array.prototype.slice.call(intro.querySelectorAll('.hero-log li')) : [];
  var count = intro && intro.querySelector('.intro-count b');
  var mark = intro && intro.querySelector('.intro-mark');
  var cmp = document.querySelector('.hero .compare');
  /* the diagram's own part turns with the page too, instead of on a 34 s clock */
  var flowPart = document.querySelector('.flow .part'), fRot = 0, fTarget = 0;
  if (flowPart) { var smil = flowPart.querySelector('animateTransform'); if (smil) smil.remove(); }
  var track = document.querySelector('.steps-track');
  var stepEls = track ? Array.prototype.slice.call(track.querySelectorAll('.step')) : [];
  var rails = track ? Array.prototype.slice.call(track.querySelectorAll('.steps-rail i')) : [];
  var stepCount = track && track.querySelector('.steps-count b');
  var stepMark = track && track.querySelector('.steps-mark');
  var bar = document.createElement('div'); bar.className = 'page-progress'; bar.setAttribute('aria-hidden', 'true'); document.body.appendChild(bar);

  var lastY = scrollY, last = performance.now(), target = 0, rot = 0, step = -1, sIdx = -1, sTarget = 0, sRot = 0;
  function frame(now) {
    if (lenis) lenis.raf(now);
    var y = scrollY, dy = y - lastY, dt = Math.min(0.05, (now - last) / 1000); lastY = y; last = now;
    var docH = root.scrollHeight - H;
    root.style.setProperty('--pp', docH > 0 ? (y / docH).toFixed(4) : 0);
    if (y >= docH - 2) rv.forEach(function (el) { if (!el.classList.contains('in')) { el.classList.add('in'); io.unobserve(el); } });   /* the last blocks can never rise past the margin line */

    if (intro) {
      var r = intro.getBoundingClientRect();
      if (r.bottom > 0) {
        var total = r.height - H, p = total > 40 ? clamp(-r.top / total, 0, 1) : 1;
        var s = total > 40 ? (p < 0.04 ? 0 : Math.min(5, Math.floor((p - 0.04) / 0.15) + 1)) : 5;
        if (s !== step) {
          if (step >= 0 && s > step) target += 40 * (s - step);   /* each step is one click of the clutch */
          step = s;
          items.forEach(function (li, k) { li.classList.toggle('on', k < s); });
          if (count) count.textContent = ('0' + s).slice(-2);
        }
        intro.style.setProperty('--lp', clamp(p / 0.79, 0, 1).toFixed(3));
        root.classList.toggle('story-past', y > 24);
        target += Math.min(Math.abs(dy), 60) * 0.16 + dt * 5;                   /* one way only, whichever way you scroll */
        rot += (target - rot) * Math.min(1, dt * 7);
        if (mark) mark.style.setProperty('--rot', rot.toFixed(2) + 'deg');
      }
    }

    if (cmp) {
      var c = cmp.getBoundingClientRect();
      if (c.top < H && c.bottom > 0) cmp.style.setProperty('--cl', (14 * clamp((c.top - H * 0.22) / (H * 0.7), 0, 1)).toFixed(2));
    }

    if (track && stepEls.length) {
      var t = track.getBoundingClientRect(), stageH = H - 57, run = t.height - stageH;
      if (run > 40 && t.top < H && t.bottom > 0) {
        var q = clamp((57 - t.top) / run, 0, 0.9999), k3 = Math.floor(q * 3);
        if (k3 !== sIdx) {
          if (sIdx >= 0) sTarget += 60 * Math.abs(k3 - sIdx);
          sIdx = k3;
          stepEls.forEach(function (el, k) { el.classList.toggle('on', k === k3); el.classList.toggle('past', k < k3); });
          if (stepCount) stepCount.textContent = '0' + (k3 + 1);
        }
        rails.forEach(function (r, k) { r.style.setProperty('--f', clamp(q * 3 - k, 0, 1).toFixed(3)); });
        sTarget += Math.min(Math.abs(dy), 60) * 0.12 + dt * 4;
        sRot += (sTarget - sRot) * Math.min(1, dt * 7);
        if (stepMark) stepMark.style.setProperty('--rot', sRot.toFixed(2) + 'deg');
      } else if (run <= 40 && sIdx !== -2) { sIdx = -2; stepEls.forEach(function (el) { el.classList.add('on'); el.classList.remove('past'); }); }
    }

    if (flowPart) {
      var pr = flowPart.getBoundingClientRect();
      if (pr.bottom > 0 && pr.top < H) {
        fTarget += Math.min(Math.abs(dy), 60) * 0.14 + dt * 6;
        fRot += (fTarget - fRot) * Math.min(1, dt * 7);
        flowPart.setAttribute('transform', 'translate(560 250) rotate(' + fRot.toFixed(2) + ')');
      }
    }

    for (var fi = 0; fi < fills.length; fi++) {
      var el = fills[fi], fr = el.getBoundingClientRect();
      if (fr.top > H || fr.bottom < 0) continue;
      var ws = words(el), N = ws.length;
      /* a heading near the end of the page can never climb to the usual line, so its span shrinks to what is reachable */
      var reach = H * 0.88 - (fr.top - Math.max(0, docH - y));
      var span = Math.max(1, Math.min(H * 0.42 + fr.height, reach));
      var qq = clamp((H * 0.88 - fr.top) / span, 0, 1) * (N + 2);
      for (var wi = 0; wi < N; wi++) ws[wi].style.setProperty('--o', clamp(0.16 + (qq - wi) * 0.42, 0.16, 1).toFixed(3));
    }

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
