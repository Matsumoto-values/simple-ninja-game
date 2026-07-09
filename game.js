// SHINOBI RUSH 〜疾風の刃〜
// 3D TPS 忍者ラン&スラッシュ。スライドダッシュで弾を避け、斬撃で敵を屠り、鳥居を目指す。
import * as THREE from './lib/three.module.min.js';

// ============================================================
// 基本セットアップ
// ============================================================
const canvas = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x070a18);
scene.fog = new THREE.FogExp2(0x070a18, 0.0135);

const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 400);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ライティング(影は使わずエミッシブ+フォグで夜の雰囲気を出す)
scene.add(new THREE.AmbientLight(0x8090c0, 0.8));
const moonLight = new THREE.DirectionalLight(0xbcd0ff, 1.1);
moonLight.position.set(-30, 60, -20);
scene.add(moonLight);
const fillLight = new THREE.PointLight(0xffb060, 0.9, 26); // プレイヤー付近の提灯色フィル
scene.add(fillLight);

// ============================================================
// 定数
// ============================================================
const GOAL_Z = 520;          // ゴール(鳥居)の位置
const PATH_HALF = 6.5;       // 道の半幅(移動可能範囲)
const MOVE_SPEED = 11;
const BACK_SPEED = 7;
const SLIDE_SPEED = 24;
const SLIDE_TIME = 0.42;
const SLIDE_CD = 1.1;
const SLASH_RANGE = 15;      // 疾風斬りのロックオン距離
const SLASH_CD = 0.32;
const BULLET_SPEED = 15;
const BULLET_DMG = 12;
const BRUTE_DMG = 25;
const MAX_HP = 100;

// ============================================================
// 効果音(WebAudioで合成。外部ファイル不要)
// ============================================================
const Sfx = {
  ctx: null,
  ensure() {
    if (!this.ctx) {
      try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { /* 音なしで続行 */ }
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  },
  tone(freqA, freqB, dur, type = 'square', vol = 0.16, delay = 0) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freqA, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(freqB, 1), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(g).connect(this.ctx.destination);
    osc.start(t0); osc.stop(t0 + dur + 0.02);
  },
  noise(dur, vol = 0.14, filterFreq = 3000) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = filterFreq; f.Q.value = 0.8;
    const g = this.ctx.createGain(); g.gain.value = vol;
    src.connect(f).connect(g).connect(this.ctx.destination);
    src.start(t0);
  },
  slash() { this.noise(0.12, 0.2, 5000); this.tone(1400, 200, 0.1, 'sawtooth', 0.08); },
  kill()  { this.noise(0.16, 0.22, 4200); this.tone(600, 1500, 0.13, 'square', 0.1); },
  dash()  { this.noise(0.3, 0.12, 1200); },
  hurt()  { this.tone(170, 55, 0.25, 'sawtooth', 0.2); },
  shoot() { this.tone(320, 120, 0.07, 'square', 0.05); },
  dodge() { this.tone(900, 1800, 0.1, 'sine', 0.12); },
  clear() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, f, 0.22, 'triangle', 0.14, i * 0.13)); },
  over()  { [330, 262, 196, 131].forEach((f, i) => this.tone(f, f * 0.95, 0.3, 'triangle', 0.14, i * 0.2)); },
};

// ============================================================
// ステージ生成
// ============================================================
function buildEnvironment() {
  // 地面
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(300, GOAL_Z + 300),
    new THREE.MeshStandardMaterial({ color: 0x0d1226, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.z = GOAL_Z / 2;
  scene.add(ground);

  // 走路(少し明るい石畳風)
  const path = new THREE.Mesh(
    new THREE.PlaneGeometry(PATH_HALF * 2 + 3, GOAL_Z + 60),
    new THREE.MeshStandardMaterial({ color: 0x252e56, roughness: 0.9 })
  );
  path.rotation.x = -Math.PI / 2;
  path.position.set(0, 0.01, GOAL_Z / 2);
  scene.add(path);

  // 走路の縁(発光ライン)
  const curbMat = new THREE.MeshBasicMaterial({ color: 0x2e6bff });
  for (const side of [-1, 1]) {
    const curb = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.1, GOAL_Z + 60), curbMat);
    curb.position.set(side * (PATH_HALF + 1.2), 0.05, GOAL_Z / 2);
    scene.add(curb);
  }

  // 星空
  const starGeo = new THREE.BufferGeometry();
  const starPos = [];
  for (let i = 0; i < 500; i++) {
    const r = 250 + Math.random() * 80;
    const th = Math.random() * Math.PI * 2;
    const ph = Math.random() * Math.PI * 0.45;
    starPos.push(r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph) * 0.6 + 20, r * Math.sin(ph) * Math.sin(th) + GOAL_Z / 2);
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
  scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xcfe0ff, size: 1.4, sizeAttenuation: false, fog: false })));

  // 月
  const moon = new THREE.Mesh(
    new THREE.CircleGeometry(18, 40),
    new THREE.MeshBasicMaterial({ color: 0xfff4d8, fog: false })
  );
  moon.position.set(-70, 90, GOAL_Z + 200);
  moon.lookAt(0, 0, GOAL_Z / 2);
  scene.add(moon);

  // 竹林・岩(道の外側の装飾)
  const bambooMat = new THREE.MeshStandardMaterial({ color: 0x1d4a34, roughness: 0.9 });
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x141a30, roughness: 1 });
  for (let z = -10; z < GOAL_Z + 40; z += 6) {
    for (const side of [-1, 1]) {
      if (Math.random() < 0.75) {
        const h = 7 + Math.random() * 9;
        const bamboo = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, h, 5), bambooMat);
        bamboo.position.set(side * (PATH_HALF + 3.5 + Math.random() * 14), h / 2, z + Math.random() * 5);
        bamboo.rotation.z = (Math.random() - 0.5) * 0.12;
        scene.add(bamboo);
      }
      if (Math.random() < 0.14) {
        const s = 1 + Math.random() * 2.4;
        const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), rockMat);
        rock.position.set(side * (PATH_HALF + 4 + Math.random() * 10), s * 0.5, z + Math.random() * 5);
        rock.rotation.set(Math.random(), Math.random(), Math.random());
        scene.add(rock);
      }
    }
  }

  // 灯籠(道沿いに等間隔)
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x22283f, roughness: 0.8 });
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffb45e });
  for (let z = 15; z < GOAL_Z; z += 26) {
    for (const side of [-1, 1]) {
      const g = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.BoxGeometry(0.25, 2.6, 0.25), poleMat);
      pole.position.y = 1.3;
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), lampMat);
      lamp.position.y = 2.9;
      const roof = new THREE.Mesh(new THREE.ConeGeometry(0.7, 0.5, 4), poleMat);
      roof.position.y = 3.5; roof.rotation.y = Math.PI / 4;
      g.add(pole, lamp, roof);
      g.position.set(side * (PATH_HALF + 1.9), 0, z);
      scene.add(g);
    }
  }

  // 中間の鳥居(装飾)
  for (let z = 90; z < GOAL_Z - 40; z += 110) {
    scene.add(makeTorii(0x8c2333, 0.85, z));
  }

  // ゴールの大鳥居 + 光の柱
  scene.add(makeTorii(0xd42b45, 1.6, GOAL_Z));
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(2.6, 3.4, 60, 20, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x7ce0ff, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false })
  );
  beam.position.set(0, 30, GOAL_Z);
  scene.add(beam);
  const goalGlow = new THREE.Mesh(
    new THREE.SphereGeometry(1.4, 18, 14),
    new THREE.MeshBasicMaterial({ color: 0xaef2ff, transparent: true, opacity: 0.9 })
  );
  goalGlow.position.set(0, 2.2, GOAL_Z);
  goalGlow.userData.pulse = true;
  scene.add(goalGlow);
  return goalGlow;
}

function makeTorii(color, scale, z) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
  const pillarGeo = new THREE.CylinderGeometry(0.45, 0.55, 9, 10);
  for (const side of [-1, 1]) {
    const p = new THREE.Mesh(pillarGeo, mat);
    p.position.set(side * 5, 4.5, 0);
    g.add(p);
  }
  const top = new THREE.Mesh(new THREE.BoxGeometry(13.5, 0.8, 1.1), mat);
  top.position.y = 9.1;
  const top2 = new THREE.Mesh(new THREE.BoxGeometry(11.5, 0.55, 0.8), mat);
  top2.position.y = 7.6;
  g.add(top, top2);
  g.scale.setScalar(scale);
  g.position.z = z;
  return g;
}

// ============================================================
// プレイヤー(忍者)モデル
// ============================================================
function makeLimb(w, h, d, color) {
  const g = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, roughness: 0.85 }));
  mesh.position.y = -h / 2;
  g.add(mesh);
  return g;
}

function makeNinja() {
  const root = new THREE.Group();     // ワールド位置(足元基準)
  const model = new THREE.Group();    // ポーズ用(スライド時に傾ける)
  root.add(model);

  const navy = 0x1c2438, navyD = 0x141a2c, skin = 0xd9b08c, red = 0xd42b45;

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.85, 0.46), new THREE.MeshStandardMaterial({ color: navy, roughness: 0.85 }));
  body.position.y = 1.15;
  model.add(body);

  // 帯
  const belt = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.14, 0.5), new THREE.MeshStandardMaterial({ color: red, roughness: 0.7 }));
  belt.position.y = 0.85;
  model.add(belt);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.48, 0.5), new THREE.MeshStandardMaterial({ color: navyD, roughness: 0.85 }));
  head.position.y = 1.85;
  model.add(head);
  // 目元(肌色の帯)
  const eyes = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.13, 0.52), new THREE.MeshStandardMaterial({ color: skin, roughness: 0.9 }));
  eyes.position.y = 1.9;
  model.add(eyes);
  // 鉢金
  const band = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.1, 0.54), new THREE.MeshStandardMaterial({ color: 0x8b93a8, metalness: 0.6, roughness: 0.4 }));
  band.position.y = 2.02;
  model.add(band);

  // マフラー(たなびく赤)
  const scarf = new THREE.Group();
  const scarfMat = new THREE.MeshStandardMaterial({ color: red, roughness: 0.8 });
  const segs = [];
  let prev = scarf;
  for (let i = 0; i < 3; i++) {
    const seg = new THREE.Group();
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.09, 0.42), scarfMat);
    m.position.z = -0.21;
    seg.add(m);
    seg.position.z = i === 0 ? -0.25 : -0.4;
    prev.add(seg);
    segs.push(seg);
    prev = seg;
  }
  scarf.position.y = 1.62;
  model.add(scarf);

  // 手足
  const armL = makeLimb(0.2, 0.62, 0.2, navy); armL.position.set(-0.5, 1.5, 0);
  const armR = makeLimb(0.2, 0.62, 0.2, navy); armR.position.set(0.5, 1.5, 0);
  const legL = makeLimb(0.24, 0.8, 0.24, navyD); legL.position.set(-0.2, 0.8, 0);
  const legR = makeLimb(0.24, 0.8, 0.24, navyD); legR.position.set(0.2, 0.8, 0);
  model.add(armL, armR, legL, legR);

  // 刀(右手)
  const sword = new THREE.Group();
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.15, 0.11), new THREE.MeshStandardMaterial({ color: 0xe8f2ff, metalness: 0.9, roughness: 0.15, emissive: 0x8fb8ff, emissiveIntensity: 0.35 }));
  blade.position.y = 0.72;
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.05, 0.18), new THREE.MeshStandardMaterial({ color: 0xcfa93f, metalness: 0.8, roughness: 0.3 }));
  guard.position.y = 0.12;
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.26, 0.09), new THREE.MeshStandardMaterial({ color: 0x30354a, roughness: 0.8 }));
  grip.position.y = -0.02;
  sword.add(blade, guard, grip);
  sword.position.set(0, -0.6, 0.06);
  sword.rotation.x = Math.PI * 0.55;
  armR.add(sword);

  // 足元の丸影
  const blob = new THREE.Mesh(
    new THREE.CircleGeometry(0.55, 20),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false })
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.02;
  root.add(blob);

  return { root, model, armL, armR, legL, legR, scarfSegs: segs, sword };
}

// ============================================================
// 敵モデル
// ============================================================
function makeGunner() {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x3a1220, roughness: 0.8 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.15, 0.6), bodyMat);
  body.position.y = 1.15;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.5, 0.62), bodyMat);
  head.position.y = 2.0;
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff3b30 });
  const eye = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.1, 0.05), eyeMat);
  eye.position.set(0, 2.02, -0.34);
  const gun = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.9, 8), new THREE.MeshStandardMaterial({ color: 0x2a3045, metalness: 0.6, roughness: 0.4 }));
  gun.rotation.x = Math.PI / 2;
  gun.position.set(0.45, 1.35, -0.5);
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.6, 0.5), new THREE.MeshStandardMaterial({ color: 0x241019, roughness: 0.9 }));
  legs.position.y = 0.3;
  g.add(body, head, eye, gun, legs);
  g.userData.eye = eye;
  return g;
}

function makeBrute() {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2a1440, roughness: 0.8 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.6, 1.0), bodyMat);
  body.position.y = 1.5;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.7, 0.8), bodyMat);
  head.position.y = 2.7;
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xb64dff });
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.05), eyeMat);
    eye.position.set(side * 0.2, 2.75, -0.43);
    g.add(eye);
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.5, 6), new THREE.MeshStandardMaterial({ color: 0xd8cfa0, roughness: 0.6 }));
    horn.position.set(side * 0.3, 3.2, 0);
    g.add(horn);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.3, 0.4), bodyMat);
    arm.position.set(side * 0.98, 1.6, 0);
    g.add(arm);
  }
  const legs = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.7, 0.8), new THREE.MeshStandardMaterial({ color: 0x1c0e2c, roughness: 0.9 }));
  legs.position.y = 0.35;
  g.add(body, head, legs);
  return g;
}

// ============================================================
// ゲーム状態
// ============================================================
const S = {
  mode: 'title', // title | play | clear | over
  hp: MAX_HP,
  kills: 0,
  time: 0,
  invuln: 0,
  slide: 0,        // 残りスライド時間
  slideCd: 0,
  slideDir: new THREE.Vector3(0, 0, 1),
  slashCd: 0,
  swing: 0,        // 剣振りアニメ残り時間
  lunge: null,     // { target, t, from, to }
  slowmo: 0,
  shake: 0,
  fov: 72,
  runPhase: 0,
};

const player = makeNinja();
player.root.position.set(0, 0, 0);
scene.add(player.root);

const goalGlow = buildEnvironment();

// 敵の配置
const enemies = [];
(function spawnEnemies() {
  let z = 42;
  while (z < GOAL_Z - 30) {
    const type = Math.random() < 0.68 ? 'gunner' : 'brute';
    const x = (Math.random() * 2 - 1) * (PATH_HALF - 1);
    const mesh = type === 'gunner' ? makeGunner() : makeBrute();
    mesh.position.set(x, 0, z);
    mesh.rotation.y = Math.PI; // プレイヤー側(-z)を向く
    scene.add(mesh);
    enemies.push({
      type, mesh, alive: true,
      x, z,
      fireTimer: 1 + Math.random() * 1.5,
      windup: 0,
      bob: Math.random() * Math.PI * 2,
    });
    // たまに2体並べる
    if (Math.random() < 0.25 && z < GOAL_Z - 60) {
      const x2 = THREE.MathUtils.clamp(x + (Math.random() < 0.5 ? -3.5 : 3.5), -(PATH_HALF - 1), PATH_HALF - 1);
      const m2 = Math.random() < 0.7 ? makeGunner() : makeBrute();
      const t2 = m2.userData.eye ? 'gunner' : 'brute';
      m2.position.set(x2, 0, z + 4);
      m2.rotation.y = Math.PI;
      scene.add(m2);
      enemies.push({ type: t2, mesh: m2, alive: true, x: x2, z: z + 4, fireTimer: 1.5 + Math.random() * 1.5, windup: 0, bob: Math.random() * Math.PI * 2 });
    }
    z += 17 + Math.random() * 13;
  }
})();

// 回復の霊珠
const heals = [];
for (const z of [150, 300, 430]) {
  const orb = new THREE.Mesh(
    new THREE.SphereGeometry(0.42, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0x5cffa8, transparent: true, opacity: 0.9 })
  );
  const x = (Math.random() * 2 - 1) * (PATH_HALF - 2);
  orb.position.set(x, 1.1, z);
  scene.add(orb);
  heals.push({ mesh: orb, taken: false, x, z });
}

const bullets = [];   // { mesh, vel, life, dodged }
const effects = [];   // { mesh, life, ttl, update(e, k) }

// ============================================================
// 入力
// ============================================================
const keys = {};
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  keys[k] = true;
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();

  Sfx.ensure();
  if (S.mode === 'title' && (k === 'enter' || k === ' ')) { startGame(); return; }
  if ((S.mode === 'over' || S.mode === 'clear') && k === 'r') { location.reload(); return; }
  if (S.mode === 'play') {
    if (k === 'r') { location.reload(); return; }
    if (k === 'j' || k === 'enter') trySlash();
    if (k === 'shift' || k === ' ') trySlide();
  }
});
window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });

window.addEventListener('pointerdown', () => {
  Sfx.ensure();
  if (S.mode === 'title') { startGame(); return; }
  if (S.mode === 'over' || S.mode === 'clear') { location.reload(); return; }
  if (S.mode === 'play') trySlash();
});

function startGame() {
  S.mode = 'play';
  document.getElementById('title-overlay').classList.remove('on');
  document.getElementById('hud').classList.add('on');
  popup('出撃!');
}

// ============================================================
// アクション
// ============================================================
function trySlide() {
  if (S.slide > 0 || S.slideCd > 0 || S.lunge) return;
  const dir = inputDir();
  S.slideDir.copy(dir.lengthSq() > 0.01 ? dir : new THREE.Vector3(0, 0, 1));
  S.slide = SLIDE_TIME;
  S.slideCd = SLIDE_CD;
  S.invuln = Math.max(S.invuln, SLIDE_TIME + 0.05);
  document.getElementById('dash-tint').style.opacity = '1';
  Sfx.dash();
}

function trySlash() {
  if (S.slashCd > 0 || S.lunge) return;
  S.slashCd = SLASH_CD;

  // 前方の最も近い敵を探す
  const p = player.root.position;
  let best = null, bestD = SLASH_RANGE;
  for (const e of enemies) {
    if (!e.alive) continue;
    const dz = e.mesh.position.z - p.z;
    if (dz < -2) continue; // 後ろの敵は狙わない
    const d = e.mesh.position.distanceTo(p);
    if (d < bestD) { bestD = d; best = e; }
  }

  if (best) {
    // 疾風斬り: 敵の位置へ一瞬で踏み込み斬り捨てる
    const to = best.mesh.position.clone();
    const dir = to.clone().sub(p).setY(0).normalize();
    to.sub(dir.clone().multiplyScalar(1.0)).setY(0);
    S.lunge = { target: best, t: 0, from: p.clone(), to };
    S.invuln = Math.max(S.invuln, 0.35);
    S.swing = 0.3;
    Sfx.slash();
  } else {
    // 空振り(それでも様になる素振り)
    S.swing = 0.3;
    spawnSlashArc(p.clone().add(new THREE.Vector3(0, 1.4, 1.4)), 0x9fd8ff);
    Sfx.slash();
  }
}

function killEnemy(e) {
  e.alive = false;
  scene.remove(e.mesh);
  S.kills++;
  S.slowmo = 0.14;
  S.shake = Math.max(S.shake, 0.45);
  const pos = e.mesh.position.clone().add(new THREE.Vector3(0, 1.4, 0));
  spawnSlashArc(pos, 0xffffff);
  spawnParticles(pos, e.type === 'brute' ? 0xb64dff : 0xff5560, e.type === 'brute' ? 22 : 15);
  popup(['斬!', '一閃!', '見事!'][Math.min(2, Math.floor(Math.random() * 3))]);
  Sfx.kill();
}

function damagePlayer(amount, cause) {
  if (S.invuln > 0 || S.mode !== 'play') return;
  S.hp = Math.max(0, S.hp - amount);
  S.invuln = 0.8;
  S.shake = Math.max(S.shake, 0.5);
  const flash = document.getElementById('flash');
  flash.style.transition = 'none';
  flash.style.opacity = '1';
  requestAnimationFrame(() => {
    flash.style.transition = 'opacity 0.5s ease-out';
    flash.style.opacity = '0';
  });
  Sfx.hurt();
  if (S.hp <= 0) gameOver(cause);
}

function gameOver(cause) {
  S.mode = 'over';
  document.getElementById('over-result').innerHTML =
    `${cause}に倒された…<br>到達距離 <span>${Math.floor(player.root.position.z)}</span> / ${GOAL_Z} 間　｜　撃破 <span>${S.kills}</span> 体`;
  document.getElementById('over-overlay').classList.add('on');
  Sfx.over();
}

function gameClear() {
  S.mode = 'clear';
  document.getElementById('clear-result').innerHTML =
    `タイム <span>${S.time.toFixed(1)}</span> 秒　｜　撃破 <span>${S.kills}</span> 体　｜　残り体力 <span>${Math.ceil(S.hp)}</span>`;
  document.getElementById('clear-overlay').classList.add('on');
  Sfx.clear();
}

function popup(text) {
  const el = document.getElementById('popup');
  el.textContent = text;
  el.classList.remove('pop');
  void el.offsetWidth; // アニメーション再始動
  el.classList.add('pop');
}

// ============================================================
// エフェクト
// ============================================================
function spawnSlashArc(pos, color) {
  const geo = new THREE.RingGeometry(0.7, 1.5, 24, 1, 0, Math.PI * 0.9);
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(pos);
  mesh.rotation.set(Math.random() * 0.6 - 0.3, 0, Math.random() * Math.PI * 2);
  scene.add(mesh);
  effects.push({
    mesh, life: 0, ttl: 0.22,
    update(e, k) {
      e.mesh.scale.setScalar(1 + k * 2.2);
      e.mesh.material.opacity = 0.95 * (1 - k);
    },
  });
}

function spawnParticles(pos, color, count) {
  for (let i = 0; i < count; i++) {
    const s = 0.08 + Math.random() * 0.14;
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), mat);
    mesh.position.copy(pos);
    scene.add(mesh);
    const vel = new THREE.Vector3((Math.random() - 0.5) * 10, Math.random() * 8 + 2, (Math.random() - 0.5) * 10);
    const spin = new THREE.Vector3(Math.random() * 10, Math.random() * 10, Math.random() * 10);
    effects.push({
      mesh, life: 0, ttl: 0.55 + Math.random() * 0.3,
      update(e, k, dt) {
        vel.y -= 22 * dt;
        e.mesh.position.addScaledVector(vel, dt);
        if (e.mesh.position.y < 0.05) { e.mesh.position.y = 0.05; vel.y *= -0.4; vel.x *= 0.7; vel.z *= 0.7; }
        e.mesh.rotation.x += spin.x * dt;
        e.mesh.rotation.y += spin.y * dt;
        e.mesh.material.opacity = 1 - k;
      },
    });
  }
}

function spawnGhost() {
  // スライド中の残像
  const mat = new THREE.MeshBasicMaterial({ color: 0x49d6ff, transparent: true, opacity: 0.35, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.0, 1.6), mat);
  mesh.position.copy(player.root.position).add(new THREE.Vector3(0, 0.55, 0));
  mesh.rotation.copy(player.model.rotation);
  scene.add(mesh);
  effects.push({
    mesh, life: 0, ttl: 0.28,
    update(e, k) { e.mesh.material.opacity = 0.35 * (1 - k); },
  });
}

function spawnMuzzle(pos) {
  const mat = new THREE.MeshBasicMaterial({ color: 0xffd26b, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), mat);
  mesh.position.copy(pos);
  scene.add(mesh);
  effects.push({ mesh, life: 0, ttl: 0.12, update(e, k) { e.mesh.scale.setScalar(1 + k * 2); e.mesh.material.opacity = 0.9 * (1 - k); } });
}

// ============================================================
// 更新処理
// ============================================================
function inputDir() {
  const d = new THREE.Vector3();
  if (keys['w'] || keys['arrowup']) d.z += 1;
  if (keys['s'] || keys['arrowdown']) d.z -= 1;
  if (keys['a'] || keys['arrowleft']) d.x += 1;   // カメラは+z向き: 左= +x
  if (keys['d'] || keys['arrowright']) d.x -= 1;
  return d.normalize();
}

let ghostTimer = 0;

function updatePlayer(dt) {
  const p = player.root.position;

  if (S.lunge) {
    // 疾風斬り: 目標へ急速接近
    const L = S.lunge;
    L.t += dt / 0.13;
    if (L.t >= 1) {
      p.copy(L.to);
      if (L.target.alive) killEnemy(L.target);
      S.lunge = null;
    } else {
      p.lerpVectors(L.from, L.to, L.t);
    }
  } else if (S.slide > 0) {
    S.slide -= dt;
    p.addScaledVector(S.slideDir, SLIDE_SPEED * dt);
    ghostTimer -= dt;
    if (ghostTimer <= 0) { spawnGhost(); ghostTimer = 0.04; }
    if (S.slide <= 0) document.getElementById('dash-tint').style.opacity = '0';
  } else {
    const d = inputDir();
    const speed = d.z < -0.5 ? BACK_SPEED : MOVE_SPEED;
    p.addScaledVector(d, speed * dt);
    S.runPhase += d.lengthSq() > 0.01 ? dt * 11 : dt * 2;
  }

  // 移動範囲を道の上に制限
  p.x = THREE.MathUtils.clamp(p.x, -PATH_HALF, PATH_HALF);
  p.z = THREE.MathUtils.clamp(p.z, 0, GOAL_Z + 2);

  // タイマー類
  S.slideCd = Math.max(0, S.slideCd - dt);
  S.slashCd = Math.max(0, S.slashCd - dt);
  S.invuln = Math.max(0, S.invuln - dt);
  S.swing = Math.max(0, S.swing - dt);

  // ---- ポーズ / アニメーション ----
  const m = player.model;
  if (S.slide > 0) {
    // スライディング: 後傾して滑る
    m.rotation.x = THREE.MathUtils.lerp(m.rotation.x, -1.15, dt * 18);
    m.position.y = THREE.MathUtils.lerp(m.position.y, -0.35, dt * 18);
    player.legL.rotation.x = THREE.MathUtils.lerp(player.legL.rotation.x, -1.3, dt * 14);
    player.legR.rotation.x = THREE.MathUtils.lerp(player.legR.rotation.x, -1.1, dt * 14);
    player.armL.rotation.x = THREE.MathUtils.lerp(player.armL.rotation.x, 2.4, dt * 14);
  } else if (S.lunge) {
    m.rotation.x = THREE.MathUtils.lerp(m.rotation.x, 0.5, dt * 20);
    m.position.y = THREE.MathUtils.lerp(m.position.y, 0.1, dt * 20);
    player.armR.rotation.x = -2.6;
  } else {
    m.rotation.x = THREE.MathUtils.lerp(m.rotation.x, 0, dt * 12);
    m.position.y = THREE.MathUtils.lerp(m.position.y, Math.abs(Math.sin(S.runPhase)) * 0.08, dt * 14);
    const sw = Math.sin(S.runPhase);
    player.legL.rotation.x = sw * 0.85;
    player.legR.rotation.x = -sw * 0.85;
    player.armL.rotation.x = -sw * 0.7;
    if (S.swing > 0) {
      // 袈裟斬りモーション
      const k = 1 - S.swing / 0.3;
      player.armR.rotation.x = -2.8 + k * 3.6;
      player.armR.rotation.z = -0.5 + k * 1.0;
    } else {
      player.armR.rotation.x = sw * 0.7;
      player.armR.rotation.z = THREE.MathUtils.lerp(player.armR.rotation.z, 0, dt * 10);
    }
  }
  // ダメージ中の点滅
  m.visible = S.invuln > 0 && S.slide <= 0 && !S.lunge ? Math.floor(S.time * 20) % 2 === 0 : true;

  // マフラーのたなびき
  const wave = Math.sin(S.time * 9);
  const speedK = S.slide > 0 ? 1.8 : 1;
  player.scarfSegs.forEach((seg, i) => {
    seg.rotation.x = (0.35 + wave * 0.25 * (i + 1) * 0.4) * speedK;
  });

  // 体の左右チルト
  const d2 = inputDir();
  m.rotation.z = THREE.MathUtils.lerp(m.rotation.z, -d2.x * 0.16, dt * 8);

  // 回復の霊珠
  for (const h of heals) {
    if (h.taken) continue;
    h.mesh.position.y = 1.1 + Math.sin(S.time * 3 + h.z) * 0.2;
    h.mesh.rotation.y += dt * 2;
    if (h.mesh.position.distanceTo(p) < 1.4) {
      h.taken = true;
      scene.remove(h.mesh);
      S.hp = Math.min(MAX_HP, S.hp + 25);
      popup('回復!');
      spawnParticles(h.mesh.position.clone(), 0x5cffa8, 10);
      Sfx.dodge();
    }
  }

  // ゴール判定
  if (p.z >= GOAL_Z - 1.5) gameClear();
}

function updateEnemies(dt) {
  const p = player.root.position;
  for (const e of enemies) {
    if (!e.alive) continue;
    const ep = e.mesh.position;
    const dz = ep.z - p.z;
    e.bob += dt * 3;

    if (e.type === 'gunner') {
      ep.y = Math.sin(e.bob) * 0.06;
      // プレイヤーの方を向く
      e.mesh.lookAt(p.x, 0, p.z);
      if (dz > -8 && dz < 62) {
        if (e.windup > 0) {
          e.windup -= dt;
          const k = 1 + Math.sin(S.time * 40) * 0.5; // 発射前に目が明滅
          if (e.mesh.userData.eye) e.mesh.userData.eye.scale.setScalar(k);
          if (e.windup <= 0) fireBullet(e);
        } else {
          e.fireTimer -= dt;
          if (e.fireTimer <= 0) {
            e.windup = 0.35;
            e.fireTimer = 1.5 + Math.random() * 1.3;
          }
        }
      }
    } else {
      // ブルート: 近づくと突進してくる
      const dist = ep.distanceTo(p);
      e.mesh.lookAt(p.x, 0, p.z);
      if (dist < 32) {
        const dir = p.clone().sub(ep).setY(0).normalize();
        ep.addScaledVector(dir, 5.2 * dt);
        ep.y = Math.abs(Math.sin(e.bob * 2.4)) * 0.18;
      }
      if (dist < 1.9) {
        damagePlayer(BRUTE_DMG, '鬼武者');
        // ノックバック
        const dir = p.clone().sub(ep).setY(0).normalize();
        p.addScaledVector(dir, 2.6);
      }
    }
  }
}

function fireBullet(e) {
  const p = player.root.position;
  const from = e.mesh.position.clone().add(new THREE.Vector3(0, 1.35, 0));
  const target = p.clone().add(new THREE.Vector3(0, 1.0, 0));
  const dir = target.sub(from).normalize();
  const mat = new THREE.MeshBasicMaterial({ color: 0xff7a45 });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), mat);
  mesh.position.copy(from);
  // 弾の尾(残光)
  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(0.4, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xff4520, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  mesh.add(glow);
  scene.add(mesh);
  bullets.push({ mesh, vel: dir.multiplyScalar(BULLET_SPEED), life: 6, dodged: false });
  spawnMuzzle(from);
  if (e.mesh.position.distanceTo(p) < 45) Sfx.shoot();
}

function updateBullets(dt) {
  const p = player.root.position;
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.life -= dt;
    b.mesh.position.addScaledVector(b.vel, dt);
    const d = b.mesh.position.distanceTo(new THREE.Vector3(p.x, p.y + 1, p.z));

    if (b.life <= 0 || b.mesh.position.y < -0.5) {
      scene.remove(b.mesh);
      bullets.splice(i, 1);
      continue;
    }
    if (d < 0.85) {
      if (S.slide > 0 || S.invuln > 0) {
        // スライド中に弾がかすめた: 見切り成功
        if (S.slide > 0 && !b.dodged) {
          b.dodged = true;
          S.slowmo = Math.max(S.slowmo, 0.08);
          S.slideCd = Math.max(0, S.slideCd - 0.5); // 見切り成功でダッシュ回復が早まる
          popup('見切り!');
          Sfx.dodge();
        }
      } else {
        damagePlayer(BULLET_DMG, '銃火');
        spawnParticles(b.mesh.position.clone(), 0xff7a45, 6);
        scene.remove(b.mesh);
        bullets.splice(i, 1);
      }
    }
  }
}

function updateEffects(dt) {
  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i];
    e.life += dt;
    const k = e.life / e.ttl;
    if (k >= 1) {
      scene.remove(e.mesh);
      e.mesh.geometry.dispose();
      e.mesh.material.dispose();
      effects.splice(i, 1);
    } else {
      e.update(e, k, dt);
    }
  }
}

const camPos = new THREE.Vector3(0, 4.2, -8);
function updateCamera(dt) {
  const p = player.root.position;
  const lowY = S.slide > 0 ? 2.8 : 4.2;
  const target = new THREE.Vector3(p.x * 0.8, lowY, p.z - 7.4);
  camPos.lerp(target, Math.min(1, dt * 6));

  // 画面揺れ
  S.shake = Math.max(0, S.shake - dt * 2.2);
  const sx = (Math.random() - 0.5) * S.shake * 0.5;
  const sy = (Math.random() - 0.5) * S.shake * 0.5;

  camera.position.set(camPos.x + sx, camPos.y + sy, camPos.z);
  camera.lookAt(p.x * 0.85, 1.9 + sy, p.z + 9);

  // FOVの演出(ダッシュや斬撃で加速感)
  const targetFov = S.slide > 0 ? 86 : S.lunge ? 82 : 72;
  S.fov = THREE.MathUtils.lerp(S.fov, targetFov, dt * 8);
  camera.fov = S.fov;
  camera.updateProjectionMatrix();

  fillLight.position.set(p.x, 3.5, p.z + 2);
}

// ============================================================
// HUD
// ============================================================
const el = {
  hpFill: document.getElementById('hp-fill'),
  hpNum: document.getElementById('hp-num'),
  dashFill: document.getElementById('dash-fill'),
  kills: document.getElementById('kills'),
  timer: document.getElementById('timer'),
  progressFill: document.getElementById('progress-fill'),
  distNum: document.getElementById('dist-num'),
};

function updateHUD() {
  const hpK = S.hp / MAX_HP;
  el.hpFill.style.width = `${hpK * 100}%`;
  el.hpFill.classList.toggle('low', hpK < 0.3);
  el.hpNum.textContent = Math.ceil(S.hp);
  el.dashFill.style.width = `${(1 - S.slideCd / SLIDE_CD) * 100}%`;
  el.kills.textContent = S.kills;
  el.timer.textContent = `${S.time.toFixed(1)} 秒`;
  const prog = Math.min(1, player.root.position.z / GOAL_Z);
  el.progressFill.style.width = `${prog * 100}%`;
  el.distNum.textContent = Math.max(0, Math.ceil(GOAL_Z - player.root.position.z));
}

// ============================================================
// メインループ
// ============================================================
let lastT = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const realDt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;

  // ヒットストップ / スローモーション
  let dt = realDt;
  if (S.slowmo > 0) {
    S.slowmo -= realDt;
    dt = realDt * 0.1;
  }

  if (S.mode === 'play') {
    S.time += dt;
    updatePlayer(dt);
    updateEnemies(dt);
    updateBullets(dt);
    updateHUD();
  } else if (S.mode === 'title') {
    // タイトル画面では周囲をゆっくり見せる
    S.runPhase += dt * 2;
    player.model.position.y = Math.abs(Math.sin(S.time)) * 0.02;
    S.time += dt;
  }

  updateEffects(dt);
  updateCamera(S.mode === 'title' ? dt * 0.5 : dt);

  // ゴールの光の明滅
  goalGlow.scale.setScalar(1 + Math.sin(now * 0.004) * 0.18);

  renderer.render(scene, camera);
}
requestAnimationFrame(loop);

// デバッグ・動作確認用フック
window.__game = { S, player, enemies, GOAL_Z, damagePlayer };
