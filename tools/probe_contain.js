(() => {
  const m = window.__map;
  const el = document.getElementById('map');
  const c = m.getCanvas();
  // 影像实际范围（与 map.js 的 BOUNDS 一致）
  const W = 113.65929333037099, S = 34.82973882250004;
  const E = 113.66564722300237, N = 34.83493116414319;
  const nw = m.project([W, N]);
  const ne = m.project([E, N]);
  const sw = m.project([W, S]);
  const se = m.project([E, S]);
  const x0 = Math.min(nw.x, sw.x), x1 = Math.max(ne.x, se.x);
  const y0 = Math.min(nw.y, ne.y), y1 = Math.max(sw.y, se.y);
  return JSON.stringify({
    z: +m.getZoom().toFixed(3),
    cw: el.clientWidth, ch: el.clientHeight, dpr: devicePixelRatio,
    boxW: Math.round(x1 - x0), boxH: Math.round(y1 - y0),
    mL: Math.round(x0), mR: Math.round(el.clientWidth - x1),
    mT: Math.round(y0), mB: Math.round(el.clientHeight - y1),
  });
})()
