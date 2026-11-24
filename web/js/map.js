/* MapForZZ7Z — 影像地图页面 */
const BOUNDS = [113.65929333037099, 34.82973882250004, 113.66564722300237, 34.83493116414319];
const CENTER = [113.66247017687114, 34.832335039886964];
const ZMIN = 15, ZMAX = 21;
// MapLibre 的 zoom 以 512 px 世界为单位：z 级时墨卡托 1 px = 78271.517 / 2^z 米，
// 再乘 cos(纬度) 就是地面米/像素。之前按 256 px 世界（156543.03）算，读数偏大一倍。
const Z0_RES = 78271.51696402048;

/* ---------- 主题（跟随系统深/浅色） ---------- */
const darkQuery = matchMedia('(prefers-color-scheme: dark)');
const MAP_BG = { light: '#e8e8ed', dark: '#0e0e11' };
const mapBg = () => (darkQuery.matches ? MAP_BG.dark : MAP_BG.light);

/* ---------- 初始视图：整幅影像完整可见（contain） ---------- */
// 影像约 580 × 574 m，几乎是正方形；视口比它宽，所以高度是瓶颈。
// 直接用墨卡托坐标算：让影像的经纬跨度刚好装进视口（留一点内边距），
// 取 x / y 两个方向更小的缩放级别 → 整幅完整居中，两侧留底色。
// （不用「米/度」近似，那样会有千分之几的误差，正好把上下边缘裁掉几像素。）
const PAD = 24;   // 视口内边距（px），保证影像不贴边
const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2));
// 尺寸优先取地图容器自身的（本页地图铺满视口，两者通常相同，但容器更可靠：
// 任何布局变化或浏览器界面差异都不会让算出的级别失真）。
function viewSize() {
  const el = document.getElementById('map');
  const w = el && el.clientWidth ? el.clientWidth : innerWidth;
  const h = el && el.clientHeight ? el.clientHeight : innerHeight;
  return [w, h];
}
function containZoom() {
  const [vw, vh] = viewSize();
  const W = Math.max(1, vw - PAD);
  const H = Math.max(1, vh - PAD);
  const dLon = BOUNDS[2] - BOUNDS[0];
  const dMerc = mercY(BOUNDS[3]) - mercY(BOUNDS[1]);
  const zX = Math.log2(W * 360 / (512 * dLon));           // 512 px 世界
  const zY = Math.log2(H * 2 * Math.PI / (512 * dMerc));
  return Math.min(zX, zY);
}

const map = new maplibregl.Map({
  container: 'map',
  style: {
    version: 8,
    sources: {},
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': mapBg() } }
    ]
  },
  center: CENTER,
  zoom: containZoom(),
  minZoom: ZMIN,
  maxZoom: ZMAX + 0.6,
  maxBounds: [
    [BOUNDS[0] - 0.02, BOUNDS[1] - 0.02],
    [BOUNDS[2] + 0.02, BOUNDS[3] + 0.02]
  ],
  attributionControl: false,
  dragRotate: false,
  pitchWithRotate: false,
  touchPitch: false,
  fadeDuration: 120,
  canvasContextAttributes: { antialias: true, preserveDrawingBuffer: false }
});

map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-left');

map.on('load', () => {
  map.addSource('ortho', {
    type: 'raster',
    tiles: ['./tiles/{z}/{x}/{y}.webp'],
    tileSize: 256,
    minzoom: ZMIN,
    maxzoom: ZMAX,
    bounds: BOUNDS,
    attribution: ''
  });

  map.addLayer({
    id: 'ortho',
    type: 'raster',
    source: 'ortho',
    paint: {
      'raster-resampling': 'linear',
      'raster-fade-duration': 160,
      'raster-opacity': 1
    }
  });

  // 整幅影像完整显示（contain）：缩放级别已由 containZoom() 在初始化时算好。
  // 窗口尺寸变化时重算，但用户已经自己拖动/缩放过就不再抢回视图。
  let userMoved = false;
  map.on('movestart', (e) => { if (e.originalEvent) userMoved = true; });
  window.addEventListener('resize', () => {
    if (!userMoved) map.jumpTo({ center: CENTER, zoom: containZoom() });
  });
});

/* ---------- UI ---------- */
const zoomLabel = document.getElementById('zoomLabel');
const resLabel = document.getElementById('resLabel');
const compassIcon = document.getElementById('compassIcon');

// 系统在浅色/深色之间切换时，同步地图留白底色（其余界面由 CSS 变量跟随）
darkQuery.addEventListener('change', () => {
  if (map.getLayer('bg')) map.setPaintProperty('bg', 'background-color', mapBg());
});

function mercRes(z, lat) {
  return Z0_RES * Math.cos(lat * Math.PI / 180) / Math.pow(2, z);
}
function fmtRes(m) {
  if (m >= 1) return m.toFixed(1) + ' m/px';
  if (m >= 0.1) return m.toFixed(2) + ' m/px';
  return (m * 100).toFixed(0) + ' cm/px';
}

function syncHud() {
  const z = map.getZoom();
  zoomLabel.textContent = 'z' + z.toFixed(1);
  resLabel.textContent = fmtRes(mercRes(z, map.getCenter().lat));
  compassIcon.style.transform = 'rotate(' + (-map.getBearing()) + 'deg)';
}
map.on('move', syncHud);
map.on('zoom', syncHud);
map.on('rotate', syncHud);
syncHud();

document.getElementById('btnZoomIn').onclick = () =>
  map.zoomIn({ duration: 300 });
document.getElementById('btnZoomOut').onclick = () =>
  map.zoomOut({ duration: 300 });
document.getElementById('btnCompass').onclick = () =>
  map.easeTo({ bearing: 0, pitch: 0, duration: 400 });

/* 双击 shift 放大手感 & 惯性已由 maplibre 提供 */

/* 预加载：在空闲时把下一级瓦片拉进浏览器缓存 */
// 只在影像覆盖的瓦片范围内预热，否则会去请求影像外的瓦片，白跑 404。
function tileRange(z) {
  const n = Math.pow(2, z);
  const x0 = Math.floor((BOUNDS[0] + 180) / 360 * n);
  const x1 = Math.floor((BOUNDS[2] + 180) / 360 * n);
  const yOf = (lat) => {
    const r = lat * Math.PI / 180;
    return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n);
  };
  const y0 = yOf(BOUNDS[3]);   // 北 → 行号小
  const y1 = yOf(BOUNDS[1]);
  return { x0, x1, y0, y1 };
}

map.once('idle', () => {
  const z = Math.round(map.getZoom()) + 1;
  if (z > ZMAX) return;
  const c = map.getCenter();
  const n = Math.pow(2, z);
  const x = Math.floor((c.lng + 180) / 360 * n);
  const latRad = c.lat * Math.PI / 180;
  const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
  const r = tileRange(z);
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const tx = x + dx, ty = y + dy;
      if (tx < r.x0 || tx > r.x1 || ty < r.y0 || ty > r.y1) continue;
      const img = new Image();
      img.src = `./tiles/${z}/${tx}/${ty}.webp`;
    }
  }
});

/* 键盘 */
window.addEventListener('keydown', (e) => {
  if (e.key === '=' || e.key === '+') map.zoomIn();
  if (e.key === '-') map.zoomOut();
});

/* 调试用句柄（控制台里可直接操作地图） */
window.__map = map;
