import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const $ = (id) => document.getElementById(id);
const HF = 'https://huggingface.co/datasets/Kyry10/g1-dances/resolve/main/motions/';
const STYLE_ORDER = ['House', 'Break', 'Waack', 'Krump', 'Pop', 'Lock', 'LA-style Hip-hop', 'Middle Hip-hop', 'Street Jazz', 'Ballet Jazz'];
const BG = 0xf4f4f1;

// ---------------------------------------------------------------- scene (MuJoCo is Z-up: everything robot-side lives in `world`)
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
scene.background = new THREE.Color(BG);
scene.fog = new THREE.Fog(BG, 9, 26);
const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 100);
camera.position.set(3.0, 1.45, 4.3);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0.8, 0);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.49;
controls.minDistance = 1.2; controls.maxDistance = 22;

scene.add(new THREE.HemisphereLight(0xffffff, 0xdcdcd6, 1.35));
const key = new THREE.DirectionalLight(0xffffff, 2.1);
key.position.set(-3, 6, 4);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.bias = -0.0004;
key.shadow.radius = 4;
scene.add(key, key.target);
const rim = new THREE.DirectionalLight(0xffffff, 0.6); rim.position.set(3, 3, -5); scene.add(rim);

const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: 0xefefeb, roughness: 1 }));
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
const grid = new THREE.GridHelper(200, 200, 0xdcdcd6, 0xe4e4df); grid.position.y = 0.001; scene.add(grid);

const world = new THREE.Group(); world.rotation.x = -Math.PI / 2; scene.add(world);
const matW = new THREE.MeshStandardMaterial({ color: 0xe9e9e6, roughness: 0.42, metalness: 0.0 });
const matD = new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.5, metalness: 0.0 });

// ---------------------------------------------------------------- robot model
let ROBOT = null, GEOMS = [];
const wxyz = (q) => new THREE.Quaternion(q[1], q[2], q[3], q[0]);

async function loadRobot() {
  const [spec, bin] = await Promise.all([fetch('robot.json').then(r => r.json()), fetch('robot.bin').then(r => r.arrayBuffer())]);
  GEOMS = spec.meshes.map(m => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(bin, m.v, m.nv * 3), 3));
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(bin, m.f, m.nf * 3), 1));
    g.computeVertexNormals();
    return g;
  });
  ROBOT = spec;
}

function makeRobot() {
  const frames = [], rots = [];
  let root = null;
  ROBOT.bodies.forEach((b, i) => {
    const f = new THREE.Object3D();
    f.position.fromArray(b.pos); f.quaternion.copy(wxyz(b.quat));
    const r = new THREE.Object3D(); f.add(r);
    (b.parent < 0 ? world : rots[b.parent]).add(f);
    if (b.free) root = f;
    frames.push(f); rots.push(r);
  });
  for (const g of ROBOT.geoms) {
    const mesh = new THREE.Mesh(GEOMS[g.mesh], g.dark ? matD : matW);
    mesh.position.fromArray(g.pos); mesh.quaternion.copy(wxyz(g.quat));
    mesh.castShadow = true;
    rots[g.body].add(mesh);
  }
  const axes = ROBOT.bodies.map(b => b.joint ? new THREE.Vector3().fromArray(b.joint.axis) : null);
  const q = new THREE.Quaternion();
  return {
    root,
    set(qpos, off = [0, 0], yaw = 0) {   // qpos: Float32Array(36); off/yaw: crowd placement in the floor plane
      const x = qpos[0], y = qpos[1];
      const c = Math.cos(yaw), s = Math.sin(yaw);
      root.position.set(c * x - s * y + off[0], s * x + c * y + off[1], qpos[2]);
      root.quaternion.set(qpos[4], qpos[5], qpos[6], qpos[3]);
      if (yaw) root.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), yaw));
      ROBOT.bodies.forEach((b, i) => { if (b.joint) rots[i].quaternion.copy(q.setFromAxisAngle(axes[i], qpos[b.joint.qadr])); });
    },
    dispose() { world.remove(root); },
  };
}

// ---------------------------------------------------------------- motions
let INDEX = null, FPS = 30;
const cache = new Map();
async function motion(id) {
  if (!cache.has(id)) cache.set(id, fetch(`motions/${id}.bin`).then(r => r.arrayBuffer()).then(b => new Float32Array(b)));
  return cache.get(id);
}
const tmp = new Float32Array(36);
function sample(data, t) {   // linear interpolation between 30 fps frames, loops
  const n = data.length / 36, f = ((t * FPS) % (n - 1) + (n - 1)) % (n - 1);
  const i = Math.floor(f), a = f - i, A = i * 36, B = (i + 1) * 36;
  for (let k = 0; k < 36; k++) tmp[k] = data[A + k] * (1 - a) + data[B + k] * a;
  const n4 = Math.hypot(tmp[3], tmp[4], tmp[5], tmp[6]); for (let k = 3; k < 7; k++) tmp[k] /= n4;
  return tmp;
}

// ---------------------------------------------------------------- state + UI
let style = 'All', current = null, data = null, solo = null, t = 0, playing = true, speed = 1, crowdMode = false;
let crowd = [];   // {robot, data, off, yaw, phase}
const shown = () => INDEX.clips.filter(c => style === 'All' || c.style === style);

function renderChips() {
  const counts = {}; INDEX.clips.forEach(c => counts[c.style] = (counts[c.style] || 0) + 1);
  $('chips').innerHTML = '';
  for (const s of ['All', ...STYLE_ORDER]) {
    const b = document.createElement('button');
    b.className = 'chip'; b.textContent = s === 'All' ? `All ${INDEX.clips.length}` : `${s} ${counts[s]}`;
    b.setAttribute('aria-pressed', String(s === style));
    b.onclick = () => { style = s; renderChips(); renderList(); if (crowdMode) buildCrowd(); };
    $('chips').append(b);
  }
}

function label(c) { return `${c.style} · ${c.sit} · dancer ${c.dancer.slice(1)} · choreo ${c.ch.slice(2)}`; }
function renderList() {
  const list = $('list'); list.innerHTML = '';
  const frag = document.createDocumentFragment();
  shown().forEach((c, i) => {
    const r = document.createElement('div'); r.className = 'row'; r.dataset.id = c.id;
    r.setAttribute('aria-current', String(current && c.id === current.id));
    r.innerHTML = `<span class="num">${String(i + 1).padStart(3, '0')}</span><span class="meta"><b>${c.style}</b><span>${c.sit} · dancer ${c.dancer.slice(1)} · choreo ${c.ch.slice(2)} · ${c.music}</span></span><span class="dur">${c.sec.toFixed(1)} s</span>`;
    r.onclick = () => select(c);
    frag.append(r);
  });
  list.append(frag);
  $('count').textContent = shown().length;
}

async function select(c, keepTime = false) {
  if (crowdMode) { crowdMode = false; $('crowd').setAttribute('aria-pressed', 'false'); clearCrowd(); }
  current = c; data = await motion(c.id); if (current !== c) return;
  if (!keepTime) t = 0;
  if (!solo) solo = makeRobot();
  solo.root.visible = true;
  $('title').textContent = c.style;
  $('sub').textContent = `${c.sit === 'basic' ? 'Basic' : 'Advanced'} routine · dancer ${c.dancer.slice(1)} · ${c.sec.toFixed(1)} s · SONIC tracking error ${c.err.toFixed(0)} mm`;
  $('dl').href = HF + c.id + '.npz';
  history.replaceState(null, '', '#' + c.id);
  document.querySelectorAll('.row').forEach(r => r.setAttribute('aria-current', String(r.dataset.id === c.id)));
  const row = document.querySelector(`.row[data-id="${c.id}"]`); if (row) row.scrollIntoView({ block: 'nearest' });
}

function clearCrowd() { crowd.forEach(m => m.robot.dispose()); crowd = []; }
async function buildCrowd() {
  clearCrowd();
  if (solo) solo.root.visible = false;
  const pool = shown().slice().sort(() => Math.random() - 0.5).slice(0, 25);
  const ds = await Promise.all(pool.map(c => motion(c.id)));
  pool.forEach((c, k) => {
    const d = ds[k], n = d.length / 36;
    let mx = 0, my = 0; for (let i = 0; i < n; i++) { mx += d[i * 36]; my += d[i * 36 + 1]; }
    const robot = makeRobot();
    const gx = (k % 5) - 2, gy = Math.floor(k / 5) - 2;
    crowd.push({ robot, data: d, c: [mx / n, my / n], off: [gx * 1.9, gy * 1.9], phase: Math.random() * 3 });
  });
  $('title').textContent = `${style === 'All' ? 'All styles' : style} · 25 dancers`;
  $('sub').textContent = 'Each robot plays a different dance. Pick one in the list to watch it alone.';
  controls.target.set(0, 0.6, 0); camera.position.set(6.5, 5.2, 9.5);
}

$('random').onclick = () => { const s = shown(); select(s[Math.floor(Math.random() * s.length)]); };
$('crowd').onclick = () => {
  crowdMode = !crowdMode; $('crowd').setAttribute('aria-pressed', String(crowdMode));
  if (crowdMode) buildCrowd(); else { clearCrowd(); if (current) { solo.root.visible = true; camera.position.set(3.0, 1.45, 4.3); } }
};
$('play').onclick = () => { playing = !playing; $('play').textContent = playing ? 'Pause' : 'Play'; };
$('speed').querySelectorAll('button').forEach(b => b.onclick = () => {
  speed = +b.dataset.s; $('speed').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
});
$('scrub').oninput = (e) => { if (data) { t = (e.target.value / 1000) * (data.length / 36 - 1) / FPS; } };

// ---------------------------------------------------------------- loop
function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
const clock = new THREE.Clock();
const look = new THREE.Vector3();
function tick() {
  const dt = Math.min(0.05, clock.getDelta());
  if (playing) t += dt * speed;
  if (crowdMode) {
    for (const m of crowd) {
      const q = sample(m.data, t + m.phase);
      const shifted = Float32Array.from(q); shifted[0] -= m.c[0]; shifted[1] -= m.c[1];
      m.robot.set(shifted, m.off);
    }
    key.position.set(-4, 9, 6); key.target.position.set(0, 0, 0);
    Object.assign(key.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7 }); key.shadow.camera.updateProjectionMatrix();
  } else if (data && solo) {
    const q = sample(data, t);
    solo.set(q);
    const n = data.length / 36, dur = (n - 1) / FPS;
    if (document.activeElement !== $('scrub')) $('scrub').value = Math.round(((t % dur) / dur) * 1000);
    $('time').textContent = `${(t % dur).toFixed(1)} / ${dur.toFixed(1)} s`;
    // follow the dancer gently (MuJoCo x,y -> three x,-z)
    look.set(q[0], 0.8, -q[1]);
    const d = look.clone().sub(controls.target); d.y = 0;
    controls.target.add(d.multiplyScalar(0.05)); camera.position.add(d);
    key.position.set(look.x - 3, 6, look.z + 4); key.target.position.copy(look);
    Object.assign(key.shadow.camera, { left: -2.5, right: 2.5, top: 2.5, bottom: -2.5 }); key.shadow.camera.updateProjectionMatrix();
  }
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

(async () => {
  resize();
  const [idx] = await Promise.all([fetch('index.json').then(r => r.json()), loadRobot()]);
  INDEX = idx; FPS = idx.fps;
  INDEX.clips.sort((a, b) => STYLE_ORDER.indexOf(a.style) - STYLE_ORDER.indexOf(b.style) || a.err - b.err);
  renderChips(); renderList();
  const fromHash = INDEX.clips.find(c => c.id === location.hash.slice(1));
  await select(fromHash || INDEX.clips.find(c => c.style === 'House'));
  $('loading').remove();
  tick();
  if (location.search.includes('crowd')) $('crowd').click();
})();
