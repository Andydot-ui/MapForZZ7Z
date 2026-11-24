/* ===========================================================
   MapForZZ7Z · 三维模型 + 点云查看器

   坐标约定（与 GLB / LAZ 一致，Z-up）：
     X = UTM Easting（东）
     Y = UTM Northing（北）
     Z = 高程
   原点 = CESIUM_RTC 中心 (743487, 3857689, 0)
   =========================================================== */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

/* ---------- 常量 ---------- */
const GROUND = {
  x0: -289.9076069545699, x1: 275.9959063875722,
  y0: -302.21506110951304, y1: 289.2352097206749,
};
const GROUND_Z = 88.9;                 // 模型地形底部 z≈89.2，影像面略低于此
const HOME_POS = new THREE.Vector3(430, -430, 470);
const HOME_TARGET = new THREE.Vector3(0, 0, 108);

/* ---------- 渲染器 ---------- */
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({
  canvas, antialias: true, powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#0b0b0d');
scene.fog = new THREE.Fog('#0b0b0d', 950, 2100);

const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.8, 6000);
camera.up.set(0, 0, 1);            // Z-up
camera.position.copy(HOME_POS);

const controls = new OrbitControls(camera, canvas);
controls.target.copy(HOME_TARGET);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.rotateSpeed = 0.85;
controls.zoomSpeed = 0.95;
controls.panSpeed = 0.85;
controls.minDistance = 6;
controls.maxDistance = 2800;
controls.maxPolarAngle = Math.PI * 0.497;
controls.screenSpacePanning = false;
controls.autoRotateSpeed = 0.7;
controls.update();

/* ---------- 灯光 ---------- */
scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x15151b, 1.5));
const key = new THREE.DirectionalLight(0xffffff, 1.3);
key.position.set(320, -420, 700);
scene.add(key);
const rim = new THREE.DirectionalLight(0x7ea8ff, 0.55);
rim.position.set(-520, 480, 320);
scene.add(rim);

/* ---------- 地面影像 ---------- */
const groundGroup = new THREE.Group();
scene.add(groundGroup);
{
  const w = GROUND.x1 - GROUND.x0;
  const h = GROUND.y1 - GROUND.y0;
  const tex = new THREE.TextureLoader().load('./models/ground.webp');
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  // PlaneGeometry 天然位于 XY 平面、法线 +Z —— 正好符合 Z-up
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })
  );
  mesh.position.set((GROUND.x0 + GROUND.x1) / 2, (GROUND.y0 + GROUND.y1) / 2, GROUND_Z);
  groundGroup.add(mesh);
}

/* ---------- 地面网格 ---------- */
const gridGroup = new THREE.Group();
scene.add(gridGroup);
{
  const grid = new THREE.GridHelper(704, 88, 0x5a5a6a, 0x32323c);
  grid.rotation.x = Math.PI / 2;      // GridHelper 在 XZ 平面 → 转到 XY
  grid.material.transparent = true;
  grid.material.opacity = 0.42;
  grid.position.z = GROUND_Z + 0.05;
  gridGroup.add(grid);
}

/* ---------- 点云 ---------- */
const cloudGroup = new THREE.Group();
scene.add(cloudGroup);

const PC = {
  ready: false,
  meta: null,
  nodeCount: 0,
  selected: new Set(),
  visibleNodes: new Map(),   // id -> THREE.Points
  inflight: 0,
  maxInflight: 8,
  queued: new Set(),
  points: 0,
  size: 1.6,
  lodErrorPx: 2.0,           // 目标点间距（像素）
  budget: 2600000,           // 同屏点云点预算，超出则停止细分
};

const pointVS = /* glsl */`
  attribute vec3 aQ;
  attribute vec3 aColor;
  uniform vec3 uMin;
  uniform vec3 uSpan;
  uniform float uSize;
  uniform float uPixelRatio;
  varying vec3 vColor;
  varying float vDepth;
  void main(){
    vec3 pos = uMin + (aQ / 65535.0) * uSpan;
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(uSize * uPixelRatio * (760.0 / max(1.0, -mv.z)),
                         1.0, 26.0 * uPixelRatio);
  }`;

const pointFS = /* glsl */`
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;
  varying vec3 vColor;
  varying float vDepth;
  void main(){
    vec2 d = gl_PointCoord - vec2(0.5);
    float r2 = dot(d, d);
    if (r2 > 0.25) discard;
    float a = smoothstep(0.25, 0.06, r2);
    float fog = smoothstep(uFogNear, uFogFar, vDepth);
    vec3 col = mix(vColor, uFogColor, fog);
    gl_FragColor = vec4(col, a);
  }`;

function makePointMaterial(bbox) {
  const span = [bbox[3] - bbox[0], bbox[4] - bbox[1], bbox[5] - bbox[2]];
  return new THREE.ShaderMaterial({
    uniforms: {
      uMin: { value: new THREE.Vector3(bbox[0], bbox[1], bbox[2]) },
      uSpan: { value: new THREE.Vector3(span[0], span[1], span[2]) },
      uSize: { value: PC.size },
      uPixelRatio: { value: Math.min(devicePixelRatio, 2) },
      uFogNear: { value: 950 },
      uFogFar: { value: 2100 },
      uFogColor: { value: new THREE.Color('#0b0b0d') },
    },
    vertexShader: pointVS,
    fragmentShader: pointFS,
    transparent: true,
    depthWrite: true,
    depthTest: true,
  });
}

async function loadCloudMeta() {
  const res = await fetch('./pointcloud/octree.json');
  PC.meta = await res.json();
  PC.nodeCount = Object.keys(PC.meta.nodes).length;
  PC.ready = true;
  updateStats();
}

/* 单节点：Uint16 量化坐标 + RGB 保留在 GPU 上，着色器内反量化 */
async function loadNode(id) {
  const info = PC.meta.nodes[id];
  if (!info || PC.visibleNodes.has(id) || PC.queued.has(id)) return;
  PC.queued.add(id);
  PC.inflight++;
  try {
    const res = await fetch(`./pointcloud/n/${id}.bin`);
    if (!res.ok) throw new Error(res.status);
    const buf = await res.arrayBuffer();
    const count = new DataView(buf).getUint32(0, true);
    if (!count) return;

    const src = new Uint16Array(buf, 4, count * 3);
    const q = new Uint16Array(count * 3);
    const col = new Uint8Array(count * 3);
    // 交错数据：x,y,z (uint16 ×3) + r,g,b (uint8 ×3) = 9 bytes / 点
    const bytes = new Uint8Array(buf, 4, count * 9);
    for (let i = 0; i < count; i++) {
      const o = i * 9;
      q[i * 3] = bytes[o] | (bytes[o + 1] << 8);
      q[i * 3 + 1] = bytes[o + 2] | (bytes[o + 3] << 8);
      q[i * 3 + 2] = bytes[o + 4] | (bytes[o + 5] << 8);
      col[i * 3] = bytes[o + 6];
      col[i * 3 + 1] = bytes[o + 7];
      col[i * 3 + 2] = bytes[o + 8];
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('aQ', new THREE.BufferAttribute(q, 3, false));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3, true));
    geo.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(
        info.bbox[0] + (info.bbox[3] - info.bbox[0]) / 2,
        info.bbox[1] + (info.bbox[4] - info.bbox[1]) / 2,
        info.bbox[2] + (info.bbox[5] - info.bbox[2]) / 2
      ),
      Math.hypot(info.bbox[3] - info.bbox[0], info.bbox[4] - info.bbox[1], info.bbox[5] - info.bbox[2]) / 2
    );

    const pts = new THREE.Points(geo, makePointMaterial(info.bbox));
    pts.frustumCulled = false;
    pts.userData.count = count;
    pts.userData.id = id;
    PC.visibleNodes.set(id, pts);
    cloudGroup.add(pts);
    PC.points += count;
    updateStats();
  } catch (e) {
    console.warn('point node failed', id, e);
  } finally {
    PC.queued.delete(id);
    PC.inflight--;
  }
}

function releaseNode(id) {
  const pts = PC.visibleNodes.get(id);
  if (!pts) return;
  cloudGroup.remove(pts);
  pts.geometry.dispose();
  pts.material.dispose();
  PC.points -= pts.userData.count;
  PC.visibleNodes.delete(id);
}

/* ---------- LOD 遍历 ---------- */
const _frustum = new THREE.Frustum();
const _m4 = new THREE.Matrix4();
const _box = new THREE.Box3();
const _v = new THREE.Vector3();
const _dir = new THREE.Vector3();

function updateLOD() {
  if (!PC.ready) return;
  camera.updateMatrixWorld();
  _m4.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  _frustum.setFromProjectionMatrix(_m4);

  const nodes = PC.meta.nodes;
  const camPos = camera.position;
  const fovTan = Math.tan(camera.fov * Math.PI / 360);
  const halfH = innerHeight / 2;
  const target = PC.lodErrorPx;

  // 距离优先遍历：近处先细分，保证预算不足时先照顾近景
  const queue = [{ id: 'r', d: 0 }];
  const selected = new Set();
  let budgetLeft = PC.budget;

  while (queue.length) {
    let best = 0;
    for (let i = 1; i < queue.length; i++) if (queue[i].d < queue[best].d) best = i;
    const { id } = queue[best];
    queue[best] = queue[queue.length - 1];
    queue.pop();

    const n = nodes[id];
    if (!n) continue;

    const bb = n.bbox;
    _box.min.set(bb[0], bb[1], bb[2]);
    _box.max.set(bb[3], bb[4], bb[5]);
    const size = bb[3] - bb[0];
    _v.set((bb[0] + bb[3]) * 0.5, (bb[1] + bb[4]) * 0.5, (bb[2] + bb[5]) * 0.5);
    const rawDist = camPos.distanceTo(_v);
    const dist = Math.max(1, rawDist - size * 0.75);

    if (!_frustum.intersectsBox(_box) || rawDist > 2800) continue;

    // 本节点采样间距在屏幕上的像素数（越大越粗糙）
    const spacingPx = (size / 128) * (halfH / (fovTan * dist));
    const kids = n.children || [];

    if (kids.length && spacingPx > target * 2 && budgetLeft > n.count) {
      // 子节点是否已有可见数据？没有则先保留父节点占位，避免空洞
      const childReady = kids.some((c) => PC.visibleNodes.has(c));
      if (!childReady) selected.add(id);
      for (const c of kids) queue.push({ id: c, d: rawDist });
    } else {
      selected.add(id);
      budgetLeft -= n.count;
    }
  }

  // 卸载不再选中的节点
  for (const id of Array.from(PC.visibleNodes.keys())) {
    if (!selected.has(id)) releaseNode(id);
  }

  // 请求缺失节点：父级优先（层级浅 = id 短）
  const missing = [];
  for (const id of selected) {
    if (!PC.visibleNodes.has(id) && !PC.queued.has(id)) missing.push(id);
  }
  missing.sort((a, b) => a.length - b.length);
  for (const id of missing) {
    if (PC.inflight >= PC.maxInflight) break;
    loadNode(id);
  }

  PC.selected = selected;
  updateStats();
}

/* ---------- GLB ---------- */
const modelGroup = new THREE.Group();
scene.add(modelGroup);
let triangleCount = 0;

const draco = new DRACOLoader();
draco.setDecoderPath('./vendor/draco/');
draco.setDecoderConfig({ type: 'wasm' });

const gltfLoader = new GLTFLoader();
gltfLoader.setDRACOLoader(draco);

const loader = document.getElementById('loader');
const loaderText = document.getElementById('loaderText');
const bar = document.getElementById('bar');
let cloudDone = false, modelDone = false;

function setProgress(p, text) {
  bar.style.width = (Math.min(1, p) * 100).toFixed(1) + '%';
  if (text) loaderText.textContent = text;
}
function maybeHideLoader() {
  if (cloudDone && modelDone) {
    setProgress(1, '场景就绪');
    setTimeout(() => loader.classList.add('hidden'), 400);
  }
}

gltfLoader.load(
  './models/textured_model.glb',
  (gltf) => {
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      o.frustumCulled = false;
      const g = o.geometry;
      if (g) triangleCount += (g.index ? g.index.count : g.attributes.position.count) / 3;
      const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of mats) {
        m.toneMapped = false;
        if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
        m.side = THREE.FrontSide;
      }
    });
    modelGroup.add(gltf.scene);
    modelDone = true;
    updateStats();
    maybeHideLoader();
  },
  (ev) => {
    if (ev.lengthComputable) {
      setProgress(ev.loaded / ev.total, `载入三维模型 ${(ev.loaded / ev.total * 100).toFixed(0)}%`);
    }
  },
  (err) => {
    console.error('GLB load failed', err);
    loaderText.textContent = '三维模型加载失败';
    modelDone = true;
    maybeHideLoader();
  }
);

/* ---------- HUD ---------- */
const statPts = document.getElementById('statPts');
const statTris = document.getElementById('statTris');
const statFps = document.getElementById('statFps');
const cloudSub = document.getElementById('cloudSub');
const compassNeedle = document.getElementById('compassNeedle');

function fmt(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(2) + ' M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + ' K';
  return String(Math.round(n));
}
function updateStats() {
  statPts.textContent = `点云 ${fmt(PC.points)} 点`;
  statTris.textContent = `三角面 ${fmt(triangleCount)}`;
  if (PC.nodeCount) cloudSub.textContent = `LOD ${PC.visibleNodes.size}/${PC.nodeCount} 节点`;
}

/* ---------- 主循环 ---------- */
let prev = performance.now();
let fpsAcc = 0, fpsN = 0, lodAcc = 0;

function tick(now) {
  requestAnimationFrame(tick);
  const dt = Math.min(64, now - prev);
  prev = now;

  controls.update();
  renderer.render(scene, camera);

  lodAcc += dt;
  if (lodAcc > 260) {
    lodAcc = 0;
    updateLOD();
  }

  camera.getWorldDirection(_dir);
  // 北 = +Y，东 = +X
  compassNeedle.style.transform = `rotate(${-Math.atan2(_dir.x, _dir.y)}rad)`;

  fpsAcc += dt; fpsN++;
  if (fpsAcc > 600) {
    statFps.textContent = Math.round(fpsN / (fpsAcc / 1000)) + ' fps';
    fpsAcc = 0; fpsN = 0;
  }
}

/* ---------- 交互 ---------- */
const groups = { model: modelGroup, cloud: cloudGroup, grid: gridGroup };

document.querySelectorAll('.layer-row').forEach((row) => {
  const kind = row.dataset.layer;
  const sw = row.querySelector('.switch');
  if (!sw) return;

  sw.addEventListener('click', () => {
    const on = sw.classList.toggle('on');
    if (kind === 'wire') {
      modelGroup.traverse((o) => {
        if (!o.isMesh || !o.material) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if (m.isMeshBasicMaterial || m.isMeshStandardMaterial) {
            m.wireframe = on;
            m.needsUpdate = true;
          }
        }
      });
    } else if (groups[kind]) {
      groups[kind].visible = on;
    }
  });
});

const ptSize = document.getElementById('ptSize');
const ptSizeVal = document.getElementById('ptSizeVal');
ptSize.addEventListener('input', () => {
  const v = parseFloat(ptSize.value);
  PC.size = v;
  ptSizeVal.textContent = v.toFixed(1);
  for (const pts of PC.visibleNodes.values()) pts.material.uniforms.uSize.value = v;
});

document.getElementById('btnHome').onclick = () => {
  camera.position.copy(HOME_POS);
  controls.target.copy(HOME_TARGET);
  controls.update();
};

document.getElementById('btnTop').onclick = () => {
  const t = controls.target;
  camera.position.set(t.x + 0.01, t.y - 0.01, t.z + 950);
  controls.update();
};
const btnOrbit = document.getElementById('btnOrbit');
btnOrbit.onclick = () => {
  controls.autoRotate = !controls.autoRotate;
  btnOrbit.classList.toggle('active', controls.autoRotate);
};

document.getElementById('compass').onclick = () => {
  camera.position.copy(HOME_POS);
  controls.target.copy(HOME_TARGET);
  controls.update();
};

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight, false);
  for (const pts of PC.visibleNodes.values()) {
    pts.material.uniforms.uPixelRatio.value = Math.min(devicePixelRatio, 2);
  }
});

/* ---------- 启动 ---------- */
loadCloudMeta().then(() => {
  cloudDone = true;
  maybeHideLoader();
  updateLOD();
});

setProgress(0.04, '初始化渲染器…');
requestAnimationFrame(tick);
