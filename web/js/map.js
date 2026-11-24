/* MapForZZ7Z — 影像地图页面 */
const BOUNDS = [113.65929333037099, 34.82973882250004, 113.66564722300237, 34.83493116414319];
const CENTER = [113.66247017687114, 34.832335039886964];
const ZMIN = 16, ZMAX = 21;

const map = new maplibregl.Map({
  container: 'map',
  style: {
    version: 8,
    sources: {},
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#e8e8ed' } }
    ]
  },
  center: CENTER,
  zoom: 17.2,
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
});

/* ---------- UI ---------- */
const zoomLabel = document.getElementById('zoomLabel');
const resLabel = document.getElementById('resLabel');
const compassIcon = document.getElementById('compassIcon');

function mercRes(z, lat) {
  return 156543.03392804097 * Math.cos(lat * Math.PI / 180) / Math.pow(2, z);
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
map.once('idle', () => {
  const z = Math.round(map.getZoom()) + 1;
  if (z > ZMAX) return;
  const c = map.getCenter();
  const n = Math.pow(2, z);
  const x = Math.floor((c.lng + 180) / 360 * n);
  const latRad = c.lat * Math.PI / 180;
  const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const img = new Image();
      img.src = `./tiles/${z}/${x + dx}/${y + dy}.webp`;
    }
  }
});

/* 键盘 */
window.addEventListener('keydown', (e) => {
  if (e.key === '=' || e.key === '+') map.zoomIn();
  if (e.key === '-') map.zoomOut();
});
