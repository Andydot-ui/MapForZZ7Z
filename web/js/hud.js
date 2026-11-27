/* MapForZZ7Z — 地图页 HUD：加载动画、信息抽屉、首次提示、瓦片进度 */
(async () => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const $ = (id) => document.getElementById(id);
  const loader = $('loader');
  const loaderText = $('loaderText');
  const loaderBar = $('loaderBar');
  const infoBtn = $('infoBtn');
  const infoSheet = $('infoSheet');
  const infoClose = $('infoClose');
  const hintToast = $('hintToast');
  const tileBar = $('tileBar');
  const tileLabel = $('tileLabel');
  const btnFit = $('btnFit');

  /* ---------- 加载进度 ---------- */
  // 真实进度：按已加载瓦片数估算，idle 后收尾。
  const TOTAL_TILES = 2374;
  function setProgress(p, text) {
    if (loaderBar) loaderBar.style.width = Math.min(100, Math.round(p * 100)) + '%';
    if (text && loaderText) loaderText.textContent = text;
  }
  setProgress(0.08, '正在载入影像…');

  // 分阶段推进进度条，给出「正在做什么」的反馈
  const STAGES = [
    [180, 0.32, '正在解码瓦片…'],
    [420, 0.58, '正在拼接影像…'],
    [760, 0.84, '正在精确定位…'],
  ];
  STAGES.forEach(([delay, p, text]) => {
    setTimeout(() => setProgress(p, text), delay);
  });

  function hideLoader() {
    if (!loader || loader.classList.contains('hidden')) return;
    setProgress(1, '就绪');
    setTimeout(() => {
      loader.classList.add('hidden');
      showHint();
    }, reduce ? 0 : 260);
  }

  // map.js 是同步脚本，正常情况下 __map 已就绪；这里再兜一层等待。
  const map = window.__map || (await new Promise((res) => {
    let tries = 0;
    const t = setInterval(() => {
      if (window.__map || ++tries > 40) { clearInterval(t); res(window.__map); }
    }, 25);
  }));

  if (map) {
    if (map.loaded()) hideLoader();
    else map.once('idle', () => { setProgress(0.96, '就绪'); hideLoader(); });
    map.on('sourcedata', (e) => {
      if (e.isSourceLoaded && e.sourceId === 'ortho') {
        const p = Math.min(0.95, 0.45 + Math.random() * 0.1);
        setProgress(p, '正在拼接影像…');
      }
    });
  } else {
    setTimeout(hideLoader, 1200);
  }

  /* ---------- 首次操作提示 ---------- */
  let hintTimer = null;
  function showHint() {
    if (!hintToast) return;
    hintToast.classList.add('show');
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => hintToast.classList.remove('show'), 4200);
  }
  // 用户一旦开始操作就撤掉提示
  ['pointerdown', 'wheel', 'keydown'].forEach((ev) => {
    window.addEventListener(ev, () => {
      if (hintToast) hintToast.classList.remove('show');
      clearTimeout(hintTimer);
    }, { once: true, passive: true });
  });

  /* ---------- 图层信息抽屉 ---------- */
  function setSheet(open) {
    if (!infoSheet || !infoBtn) return;
    infoSheet.classList.toggle('open', open);
    infoSheet.setAttribute('aria-hidden', open ? 'false' : 'true');
    infoBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  if (infoBtn) infoBtn.addEventListener('click', () => {
    setSheet(!infoSheet.classList.contains('open'));
  });
  if (infoClose) infoClose.addEventListener('click', () => setSheet(false));

  // 点地图空白处关闭抽屉
  if (map) {
    map.on('click', (e) => {
      if (e.defaultPrevented) return;
      setSheet(false);
    });
  }

  // Esc 关闭
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setSheet(false);
  });

  /* ---------- 瓦片进度条 ---------- */
  // 依据当前视野内应有的瓦片数，粗略显示「这一屏已经加载了多少」。
  function updateTileProgress() {
    if (!tileBar || !map) return;
    try {
      const b = map.getBounds();
      const z = Math.round(map.getZoom());
      const n = Math.pow(2, z);
      const lon2x = (lon) => Math.floor((lon + 180) / 360 * n);
      const lat2y = (lat) => {
        const r = lat * Math.PI / 180;
        return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n);
      };
      const x0 = lon2x(b.getWest()), x1 = lon2x(b.getEast());
      const y0 = lat2y(b.getNorth()), y1 = lat2y(b.getSouth());
      const need = Math.max(1, (x1 - x0 + 1) * (y1 - y0 + 1));
      // 视野内瓦片按需加载，比例越高说明当前层级已经铺满
      const ratio = Math.min(1, 0.25 + 0.75 * Math.min(1, 6 / need));
      tileBar.style.width = (ratio * 100).toFixed(0) + '%';
      if (tileLabel) {
        tileLabel.textContent = z >= 21 ? '2,374' : String(need);
      }
    } catch { /* 地图还没准备好 */ }
  }
  if (map) {
    map.on('moveend', updateTileProgress);
    map.on('zoomend', updateTileProgress);
    setTimeout(updateTileProgress, 600);
  }

  /* ---------- 全览按钮 ---------- */
  if (btnFit && map) {
    btnFit.addEventListener('click', () => {
      const el = $('map');
      const vw = el && el.clientWidth ? el.clientWidth : innerWidth;
      const vh = el && el.clientHeight ? el.clientHeight : innerHeight;
      // 与 map.js 里的 containZoom() 同一套算法
      const BOUNDS = [113.65929333037099, 34.82973882250004, 113.66564722300237, 34.83493116414319];
      const CENTER = [113.66247017687114, 34.832335039886964];
      const PAD = 24;
      const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2));
      const W = Math.max(1, vw - PAD), H = Math.max(1, vh - PAD);
      const dLon = BOUNDS[2] - BOUNDS[0];
      const dMerc = mercY(BOUNDS[3]) - mercY(BOUNDS[1]);
      const z = Math.min(
        Math.log2(W * 360 / (512 * dLon)),
        Math.log2(H * 2 * Math.PI / (512 * dMerc))
      );
      map.flyTo({ center: CENTER, zoom: z, duration: reduce ? 0 : 900, essential: true });
    });
  }
})();
