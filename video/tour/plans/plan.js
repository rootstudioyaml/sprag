/* Shared timeline of the 30 s plan promos. fades: [[selector, start], ...] crossfades each later clip in over the one
   below it; close: when the closing card starts. One tween per property per element: entrances on the inner element,
   exits on the outer wrapper. Returns the paused timeline; each page registers it on
   window.__timelines inline, where the HyperFrames lint looks for it. */
function planTimeline(fades, close) {
  const tl = gsap.timeline({ paused: true });
  fades.forEach(([id, t]) => tl.fromTo(id, { opacity: 0 }, { opacity: 1, duration: 0.45, ease: "none" }, t));

  document.querySelectorAll(".cap").forEach((el) => {
    const s = +el.dataset.start, d = +el.dataset.duration;
    tl.fromTo(el.querySelector(".cap-in"), { opacity: 0, y: 22 }, { opacity: 1, y: 0, duration: 0.55, ease: "power2.out" }, s);
    tl.to(el, { opacity: 0, duration: 0.35, ease: "none" }, s + d - 0.35);
  });

  const b = document.getElementById("badge"), bs = +b.dataset.start, bd = +b.dataset.duration;
  tl.fromTo("#badge-in", { opacity: 0, y: -14 }, { opacity: 1, y: 0, duration: 0.5, ease: "power2.out" }, bs);
  tl.to("#badge", { opacity: 0, duration: 0.35, ease: "none" }, bs + bd - 0.35);

  tl.fromTo("#logo", { opacity: 0, scale: 0.94 }, { opacity: 1, scale: 1, duration: 0.7, ease: "power2.out" }, close + 0.3);
  tl.fromTo("#close-plan", { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.55, ease: "power2.out" }, close + 0.8);
  tl.fromTo("#close-price", { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.5, ease: "power2.out" }, close + 1.2);
  tl.fromTo("#close-url", { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.5, ease: "power2.out" }, close + 1.6);

  tl.seek(0);
  return tl;
}
