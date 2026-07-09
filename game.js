// SHINOBI RUSH 〜疾風の刃〜
// 3D TPS 忍者ラン&スラッシュ。スライドダッシュ・二段ジャンプ・壁走りを駆使して
// 弾幕をかいくぐり、斬撃で敵を屠り、ゴールの大鳥居を目指す。
import * as THREE from './lib/three.module.min.js';

// ============================================================
// 基本セットアップ
// ============================================================
const canvas = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 500);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ライト(強さ・色はステージごとに設定する)
const ambLight = new THREE.AmbientLight(0xffffff, 1);
const dirLight = new THREE.DirectionalLight(0xffffff, 1);
dirLight.position.set(-30, 60, -20);
const fillLight = new THREE.PointLight(0xffb060, 0.9, 26); // プレイヤー付近のフィルライト
scene.add(ambLight, dirLight, fillLight);

// ============================================================
// 定数
// ============================================================
const PATH_HALF = 6.5;          // 道の半幅(移動可能範囲)
const WALL_X = PATH_HALF + 0.55; // 壁の内面位置
const MOVE_SPEED = 11;
const BACK_SPEED = 7;
const SLIDE_SPEED = 24;
const SLIDE_TIME = 0.42;
const SLIDE_CD = 1.1;
const SLASH_RANGE = 15;
const SLASH_CD = 0.32;
const GRAVITY = 32;
const JUMP_V = 13;
const AIRJUMP_V = 12;
const WALLRUN_MAX = 1.35;       // 壁走りの最長時間
const MAX_HP = 100;
const MAX_BULLETS = 220;

// ============================================================
// ステージ定義
// ============================================================
const STAGES = [
  {
    name: '月夜の竹林', len: 520,
    sky: 0x070a18, fogC: 0x070a18, fogD: 0.0135,
    amb: [0x8090c0, 0.8], sun: [0xbcd0ff, 1.1], fill: [0xffb060, 0.9],
    ground: 0x0d1226, path: 0x252e56, curb: 0x2e6bff,
    wall: 0x161c30, wallTrim: 0x2e6bff,
    torii: 0x8c2333, goalTorii: 0xd42b45, lamp: 0xffb45e,
    decor: 'night',
  },
  {
    name: '白昼の桜街道', len: 560,
    sky: 0x8ec8ef, fogC: 0xc2ddf0, fogD: 0.007,
    amb: [0xffffff, 1.2], sun: [0xfff0d0, 1.9], fill: [0xfff2d8, 0.35],
    ground: 0x5f8f4e, path: 0xcabf9e, curb: 0xff9db8,
    wall: 0xe8e2d4, wallTrim: 0x8c2333,
    torii: 0xc23a50, goalTorii: 0xd42b45, lamp: 0xff8fae,
    decor: 'day',
  },
  {
    name: '紅蓮の魔天', len: 600,
    sky: 0x230a1e, fogC: 0x381024, fogD: 0.011,
    amb: [0xff9070, 0.75], sun: [0xff7040, 1.4], fill: [0xff6a4a, 0.9],
    ground: 0x190d16, path: 0x3a1f2e, curb: 0xff4d3a,
    wall: 0x241018, wallTrim: 0xff4d3a,
    torii: 0x511420, goalTorii: 0xff2e4a, lamp: 0xff6a4a,
    decor: 'dusk',
  },
];

// ============================================================
// 難易度定義
// 皆伝は弾幕シューティング寄り: 扇状同時発射・連射・面制圧(弾のカーテン/地走り波動)
// ============================================================
const DIFFS = [
  {
    name: '初伝', fireInt: 2.3, speedMul: 0.9, densMul: 0.8, dmgMul: 0.75, windup: 0.4, bruteMul: 1.0,
    attacks: [['orb', 70], ['shuriken', 20], ['wave', 10]],
  },
  {
    name: '中伝', fireInt: 1.7, speedMul: 1.0, densMul: 1.0, dmgMul: 1.0, windup: 0.35, bruteMul: 1.0,
    attacks: [['orb', 35], ['fan3', 22], ['shuriken', 15], ['big', 12], ['wave', 10], ['curtain', 6]],
  },
  {
    name: '皆伝', fireInt: 1.05, speedMul: 1.2, densMul: 1.45, dmgMul: 1.0, windup: 0.25, bruteMul: 1.25,
    attacks: [['fan5', 20], ['burst3', 16], ['shuriken', 14], ['big', 12], ['wave', 16], ['curtain', 16], ['fan3', 6]],
  },
];

function pickWeighted(list) {
  let sum = 0;
  for (const [, w] of list) sum += w;
  let r = Math.random() * sum;
  for (const [t, w] of list) { r -= w; if (r <= 0) return t; }
  return list[0][0];
}

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
  slash()   { this.noise(0.12, 0.2, 5000); this.tone(1400, 200, 0.1, 'sawtooth', 0.08); },
  kill()    { this.noise(0.16, 0.22, 4200); this.tone(600, 1500, 0.13, 'square', 0.1); },
  dash()    { this.noise(0.3, 0.12, 1200); },
  jump()    { this.tone(280, 560, 0.12, 'square', 0.07); },
  airjump() { this.tone(430, 900, 0.12, 'square', 0.08); },
  wall()    { this.noise(0.25, 0.1, 900); },
  land()    { this.noise(0.06, 0.05, 700); },
  hurt()    { this.tone(170, 55, 0.25, 'sawtooth', 0.2); },
  shoot()   { this.tone(320, 120, 0.07, 'square', 0.05); },
  waveSfx() { this.tone(95, 38, 0.4, 'sawtooth', 0.1); },
  curtain() { this.tone(1250, 420, 0.3, 'sawtooth', 0.06); },
  dodge()   { this.tone(900, 1800, 0.1, 'sine', 0.12); },
  clear()   { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, f, 0.22, 'triangle', 0.14, i * 0.13)); },
  over()    { [330, 262, 196, 131].forEach((f, i) => this.tone(f, f * 0.95, 0.3, 'triangle', 0.14, i * 0.2)); },
};

// ============================================================
// ステージ構築
// ============================================================
function buildStage(idx) {
  const st = STAGES[idx];
  const len = st.len;
  const g = new THREE.Group();

  scene.background = new THREE.Color(st.sky);
  scene.fog = new THREE.FogExp2(st.fogC, st.fogD);
  ambLight.color.set(st.amb[0]); ambLight.intensity = st.amb[1];
  dirLight.color.set(st.sun[0]); dirLight.intensity = st.sun[1];
  fillLight.color.set(st.fill[0]); fillLight.intensity = st.fill[1];

  // 地面
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(300, len + 300),
    new THREE.MeshStandardMaterial({ color: st.ground, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.z = len / 2;
  g.add(ground);

  // 走路
  const path = new THREE.Mesh(
    new THREE.PlaneGeometry(PATH_HALF * 2 + 3, len + 60),
    new THREE.MeshStandardMaterial({ color: st.path, roughness: 0.9 })
  );
  path.rotation.x = -Math.PI / 2;
  path.position.set(0, 0.01, len / 2);
  g.add(path);

  // 縁の発光ライン
  const curbMat = new THREE.MeshBasicMaterial({ color: st.curb });
  for (const side of [-1, 1]) {
    const curb = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.1, len + 60), curbMat);
    curb.position.set(side * (PATH_HALF + 0.35), 0.05, len / 2);
    g.add(curb);
  }

  // 壁走り用の壁(両脇に連続した塀)
  const wallMat = new THREE.MeshStandardMaterial({ color: st.wall, roughness: 0.9 });
  const pillarMat = new THREE.MeshStandardMaterial({ color: st.wall, roughness: 0.95 });
  pillarMat.color.multiplyScalar(0.72);
  const trimMat = new THREE.MeshBasicMaterial({ color: st.wallTrim });
  for (const side of [-1, 1]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(0.5, 3.4, len + 60), wallMat);
    wall.position.set(side * (WALL_X + 0.25), 1.7, len / 2);
    g.add(wall);
    // 上端の発光トリム
    const trim = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, len + 60), trimMat);
    trim.position.set(side * (WALL_X + 0.02), 3.36, len / 2);
    g.add(trim);
    // 柱(壁走り中のスピード感を出すリズム)
    for (let z = 0; z < len + 40; z += 12) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.8, 3.8, 0.8), pillarMat);
      pillar.position.set(side * (WALL_X + 0.4), 1.9, z);
      g.add(pillar);
    }
  }

  // 灯籠
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x22283f, roughness: 0.8 });
  const lampMat = new THREE.MeshBasicMaterial({ color: st.lamp });
  for (let z = 15; z < len; z += 26) {
    for (const side of [-1, 1]) {
      const lg = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.BoxGeometry(0.25, 2.6, 0.25), poleMat);
      pole.position.y = 1.3;
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), lampMat);
      lamp.position.y = 2.9;
      const roof = new THREE.Mesh(new THREE.ConeGeometry(0.7, 0.5, 4), poleMat);
      roof.position.y = 3.5; roof.rotation.y = Math.PI / 4;
      lg.add(pole, lamp, roof);
      lg.position.set(side * (PATH_HALF - 0.6), 0, z);
      lg.scale.setScalar(0.85);
      g.add(lg);
    }
  }

  // ステージ別の装飾
  if (st.decor === 'night') buildNightDecor(g, len);
  else if (st.decor === 'day') buildDayDecor(g, len);
  else buildDuskDecor(g, len);

  // 中間の鳥居
  for (let z = 90; z < len - 40; z += 110) {
    g.add(makeTorii(st.torii, 0.85, z));
  }

  // ゴールの大鳥居 + 光の柱
  g.add(makeTorii(st.goalTorii, 1.6, len));
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(2.6, 3.4, 60, 20, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x7ce0ff, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false })
  );
  beam.position.set(0, 30, len);
  g.add(beam);
  const goalGlow = new THREE.Mesh(
    new THREE.SphereGeometry(1.4, 18, 14),
    new THREE.MeshBasicMaterial({ color: 0xaef2ff, transparent: true, opacity: 0.9 })
  );
  goalGlow.position.set(0, 2.2, len);
  g.add(goalGlow);

  scene.add(g);
  return { idx, len, group: g, goalGlow };
}

function buildNightDecor(g, len) {
  // 星空
  const starGeo = new THREE.BufferGeometry();
  const starPos = [];
  for (let i = 0; i < 500; i++) {
    const r = 250 + Math.random() * 80;
    const th = Math.random() * Math.PI * 2;
    const ph = Math.random() * Math.PI * 0.45;
    starPos.push(r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph) * 0.6 + 20, r * Math.sin(ph) * Math.sin(th) + len / 2);
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
  g.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xcfe0ff, size: 1.4, sizeAttenuation: false, fog: false })));

  // 月
  const moon = new THREE.Mesh(new THREE.CircleGeometry(18, 40), new THREE.MeshBasicMaterial({ color: 0xfff4d8, fog: false }));
  moon.position.set(-70, 90, len + 200);
  moon.lookAt(0, 0, len / 2);
  g.add(moon);

  // 竹林・岩
  const bambooMat = new THREE.MeshStandardMaterial({ color: 0x1d4a34, roughness: 0.9 });
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x141a30, roughness: 1 });
  for (let z = -10; z < len + 40; z += 6) {
    for (const side of [-1, 1]) {
      if (Math.random() < 0.75) {
        const h = 7 + Math.random() * 9;
        const bamboo = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, h, 5), bambooMat);
        bamboo.position.set(side * (WALL_X + 2.5 + Math.random() * 14), h / 2, z + Math.random() * 5);
        bamboo.rotation.z = (Math.random() - 0.5) * 0.12;
        g.add(bamboo);
      }
      if (Math.random() < 0.12) {
        const s = 1 + Math.random() * 2.4;
        const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), rockMat);
        rock.position.set(side * (WALL_X + 3 + Math.random() * 10), s * 0.5, z + Math.random() * 5);
        rock.rotation.set(Math.random(), Math.random(), Math.random());
        g.add(rock);
      }
    }
  }
}

function buildDayDecor(g, len) {
  // 太陽
  const sun = new THREE.Mesh(new THREE.CircleGeometry(14, 40), new THREE.MeshBasicMaterial({ color: 0xfff6c8, fog: false }));
  sun.position.set(60, 100, len + 200);
  sun.lookAt(0, 0, len / 2);
  g.add(sun);

  // 雲
  const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.92 });
  for (let i = 0; i < 14; i++) {
    const c = new THREE.Group();
    for (let j = 0; j < 3; j++) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(4 + Math.random() * 4, 10, 8), cloudMat);
      puff.position.set(j * 5 - 5 + Math.random() * 2, Math.random() * 1.5, Math.random() * 3);
      c.add(puff);
    }
    c.scale.y = 0.42;
    c.position.set((Math.random() < 0.5 ? -1 : 1) * (25 + Math.random() * 90), 42 + Math.random() * 30, Math.random() * (len + 100) - 20);
    g.add(c);
  }

  // 桜並木
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a4030, roughness: 0.95 });
  const petalMats = [
    new THREE.MeshStandardMaterial({ color: 0xf7a8c4, roughness: 0.85 }),
    new THREE.MeshStandardMaterial({ color: 0xf2c4d8, roughness: 0.85 }),
  ];
  for (let z = -5; z < len + 40; z += 7) {
    for (const side of [-1, 1]) {
      if (Math.random() < 0.6) {
        const t = new THREE.Group();
        const h = 3 + Math.random() * 1.5;
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.32, h, 6), trunkMat);
        trunk.position.y = h / 2;
        t.add(trunk);
        for (let k = 0; k < 3; k++) {
          const s = 1.4 + Math.random() * 1.2;
          const canopy = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), petalMats[k % 2]);
          canopy.position.set((Math.random() - 0.5) * 2, h + s * 0.5 + Math.random(), (Math.random() - 0.5) * 2);
          t.add(canopy);
        }
        t.position.set(side * (WALL_X + 2.5 + Math.random() * 12), 0, z + Math.random() * 4);
        g.add(t);
      }
    }
  }
}

function buildDuskDecor(g, len) {
  // 沈む巨大な赤い太陽
  const sun = new THREE.Mesh(new THREE.CircleGeometry(30, 44), new THREE.MeshBasicMaterial({ color: 0xff5a3c, fog: false }));
  sun.position.set(0, 26, len + 230);
  sun.lookAt(0, 10, len / 2);
  g.add(sun);

  // まばらな星
  const starGeo = new THREE.BufferGeometry();
  const starPos = [];
  for (let i = 0; i < 180; i++) {
    const r = 250 + Math.random() * 80;
    const th = Math.random() * Math.PI * 2;
    const ph = Math.random() * Math.PI * 0.4;
    starPos.push(r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph) * 0.6 + 40, r * Math.sin(ph) * Math.sin(th) + len / 2);
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
  g.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffc0b0, size: 1.2, sizeAttenuation: false, fog: false })));

  // 紅葉と鳥居の群れ
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x2c1410, roughness: 0.95 });
  const leafMats = [
    new THREE.MeshStandardMaterial({ color: 0xd8543a, roughness: 0.85 }),
    new THREE.MeshStandardMaterial({ color: 0xb33822, roughness: 0.85 }),
  ];
  for (let z = -5; z < len + 40; z += 8) {
    for (const side of [-1, 1]) {
      if (Math.random() < 0.55) {
        const t = new THREE.Group();
        const h = 3 + Math.random() * 2;
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, h, 6), trunkMat);
        trunk.position.y = h / 2;
        t.add(trunk);
        for (let k = 0; k < 3; k++) {
          const s = 1.2 + Math.random() * 1.1;
          const canopy = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), leafMats[k % 2]);
          canopy.position.set((Math.random() - 0.5) * 2, h + s * 0.4 + Math.random(), (Math.random() - 0.5) * 2);
          t.add(canopy);
        }
        t.position.set(side * (WALL_X + 2.5 + Math.random() * 12), 0, z + Math.random() * 4);
        g.add(t);
      }
    }
  }
  // 参道の外に連なる鳥居のシルエット
  for (let z = 30; z < len; z += 55) {
    for (const side of [-1, 1]) {
      const t = makeTorii(0x511420, 0.6, z);
      t.position.x = side * (WALL_X + 9);
      g.add(t);
    }
  }
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

function disposeStage(cur) {
  if (!cur) return;
  cur.group.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
      else o.material.dispose();
    }
  });
  scene.remove(cur.group);
}

// ============================================================
// プレイヤー(くノ一)モデル
// 金髪ポニーテール + 黒いリボン + 白鉢巻 + 赤縁の黒装束 + 赤い帯
// ============================================================
function makeNinja() {
  const root = new THREE.Group();     // ワールド位置(足元基準)
  const model = new THREE.Group();    // ポーズ用(スライドや壁走りで傾ける)
  root.add(model);

  const SKIN = 0xf6cfa4, HAIR = 0xe8c052,
        CLOTH = 0x34363f, RED = 0xd42b45, OBI = 0xc23046,
        BROWN = 0x74492f, GUARD = 0x38292a, WHITE = 0xf2f0ea, BLACK = 0x26262c;
  const mat = (c, r = 0.85) => new THREE.MeshStandardMaterial({ color: c, roughness: r });

  // 胴(黒装束のワンピース)
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.4), mat(CLOTH));
  body.position.y = 1.3;
  model.add(body);
  // 首
  const neck = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.14), mat(SKIN, 0.9));
  neck.position.y = 1.62;
  model.add(neck);
  // 襟の赤いV字トリム
  for (const s of [-1, 1]) {
    const trim = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.38, 0.03), mat(RED, 0.7));
    trim.position.set(s * 0.12, 1.46, 0.21);
    trim.rotation.z = -s * 0.45;
    model.add(trim);
  }
  // スカート(裾広がり・赤い裾)
  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.52, 0.42, 4), mat(CLOTH));
  skirt.position.y = 0.84;
  skirt.rotation.y = Math.PI / 4;
  const hem = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.56, 0.09, 4), mat(RED, 0.7));
  hem.position.y = 0.62;
  hem.rotation.y = Math.PI / 4;
  model.add(skirt, hem);
  // 赤い帯
  const obi = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.16, 0.44), mat(OBI, 0.7));
  obi.position.y = 1.04;
  model.add(obi);
  // 帯の長い垂れ(背中でたなびく)
  const sashBase = new THREE.Group();
  sashBase.position.set(0, 1.0, -0.2);
  sashBase.rotation.x = -0.55;
  const sashSegs = [];
  {
    let prev = sashBase;
    for (let i = 0; i < 4; i++) {
      const seg = new THREE.Group();
      const m2 = new THREE.Mesh(new THREE.BoxGeometry(0.26 - i * 0.03, 0.05, 0.34), mat(RED, 0.75));
      m2.position.z = -0.17;
      seg.add(m2);
      seg.position.z = i === 0 ? 0 : -0.32;
      prev.add(seg);
      sashSegs.push(seg);
      prev = seg;
    }
  }
  model.add(sashBase);

  // 頭(素肌の顔)
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.44, 0.46), mat(SKIN, 0.9));
  head.position.y = 1.88;
  model.add(head);
  // 琥珀色の目(+zが正面)
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.02), mat(0xcf7d18, 0.5));
    eye.position.set(s * 0.11, 1.88, 0.24);
    model.add(eye);
  }
  // 白い鉢巻
  const band = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.09, 0.48), mat(WHITE, 0.6));
  band.position.y = 2.04;
  model.add(band);
  // 金髪: 頭頂・後ろ髪・前髪・横の房
  const hairTop = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.16, 0.52), mat(HAIR));
  hairTop.position.y = 2.16;
  const hairBack = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.52, 0.14), mat(HAIR));
  hairBack.position.set(0, 1.86, -0.26);
  const bangs = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.13, 0.08), mat(HAIR));
  bangs.position.set(0, 2.0, 0.26);
  model.add(hairTop, hairBack, bangs);
  for (const s of [-1, 1]) {
    const lock = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.44, 0.1), mat(HAIR));
    lock.position.set(s * 0.24, 1.76, 0.2);
    model.add(lock);
  }

  // ポニーテール(なびく)
  const ponyBase = new THREE.Group();
  ponyBase.position.set(0, 2.18, -0.2);
  ponyBase.rotation.x = -0.85;
  const ponySegs = [];
  {
    let prev = ponyBase;
    for (let i = 0; i < 4; i++) {
      const seg = new THREE.Group();
      const m2 = new THREE.Mesh(new THREE.BoxGeometry(0.2 - i * 0.035, 0.14 - i * 0.015, 0.3), mat(HAIR));
      m2.position.z = -0.15;
      seg.add(m2);
      seg.position.z = i === 0 ? 0 : -0.28;
      prev.add(seg);
      ponySegs.push(seg);
      prev = seg;
    }
  }
  // 黒い蝶結びのリボン
  for (const s of [-1, 1]) {
    const loop = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.05), mat(BLACK, 0.7));
    loop.position.set(s * 0.12, 0.04, 0.02);
    loop.rotation.z = s * 0.5;
    ponyBase.add(loop);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.26, 0.02), mat(BLACK, 0.7));
    tail.position.set(s * 0.1, -0.14, 0.02);
    tail.rotation.z = -s * 0.25;
    ponyBase.add(tail);
  }
  model.add(ponyBase);

  // 腕(素肌+革の籠手)
  function makeArm(side) {
    const g = new THREE.Group();
    const upper = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.28, 0.15), mat(SKIN, 0.9));
    upper.position.y = -0.14;
    const gaunt = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.3, 0.18), mat(BROWN, 0.75));
    gaunt.position.y = -0.44;
    g.add(upper, gaunt);
    g.position.set(side * 0.42, 1.6, 0);
    return g;
  }
  const armL = makeArm(-1);
  const armR = makeArm(1);
  model.add(armL, armR);

  // 脚(素肌の太もも+黒い脛当て+赤い草履)
  function makeLeg(side) {
    const g = new THREE.Group();
    const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.4, 0.19), mat(SKIN, 0.9));
    thigh.position.y = -0.2;
    const shin = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.38, 0.21), mat(GUARD, 0.8));
    shin.position.y = -0.59;
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.06, 0.28), mat(RED, 0.8));
    foot.position.set(0, -0.81, 0.04);
    g.add(thigh, shin, foot);
    g.position.set(side * 0.18, 0.85, 0);
    return g;
  }
  const legL = makeLeg(-1);
  const legR = makeLeg(1);
  model.add(legL, legR);

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

  return { root, model, armL, armR, legL, legR, ponyBase, ponySegs, sashBase, sashSegs, sword, blob };
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
const sel = {
  stage: Math.min(2, Math.max(0, +(localStorage.getItem('sr.stage') || 0))),
  diff: Math.min(2, Math.max(0, +(localStorage.getItem('sr.diff') || 1))),
};

const S = {
  mode: 'title', // title | play | clear | over
  hp: MAX_HP,
  kills: 0,
  time: 0,
  invuln: 0,
  // スライド
  slide: 0,
  slideCd: 0,
  slideDir: new THREE.Vector3(0, 0, 1),
  airDash: false,
  // ジャンプ / 壁走り
  vy: 0,
  grounded: true,
  airJumps: 1,
  wall: 0,           // 0 = なし, ±1 = 壁走り中の壁の側
  wallTime: 0,
  impulse: new THREE.Vector3(),
  // 斬撃
  slashCd: 0,
  swing: 0,
  lunge: null,
  // 演出
  slowmo: 0,
  shake: 0,
  fov: 72,
  runPhase: 0,
};

const player = makeNinja();
scene.add(player.root);

let cur = buildStage(sel.stage); // タイトル画面の背景として選択中ステージを構築
let diff = DIFFS[sel.diff];

const enemies = [];
const heals = [];
const bullets = [];   // { kind, mesh, vel, life, r, dmg, dodged, ... }
const effects = [];   // { mesh, life, ttl, update(e, k, dt) }

function spawnEnemies() {
  const len = cur.len;
  let z = 42;
  const pairChance = sel.diff === 2 ? 0.35 : 0.25;
  while (z < len - 30) {
    const type = Math.random() < 0.68 ? 'gunner' : 'brute';
    addEnemy(type, (Math.random() * 2 - 1) * (PATH_HALF - 1), z);
    if (Math.random() < pairChance && z < len - 60) {
      const x2 = THREE.MathUtils.clamp((Math.random() * 2 - 1) * (PATH_HALF - 1), -(PATH_HALF - 1), PATH_HALF - 1);
      addEnemy(Math.random() < 0.7 ? 'gunner' : 'brute', x2, z + 4);
    }
    z += (17 + Math.random() * 13) / diff.densMul;
  }
}

function addEnemy(type, x, z) {
  const mesh = type === 'gunner' ? makeGunner() : makeBrute();
  mesh.position.set(x, 0, z);
  mesh.rotation.y = Math.PI;
  scene.add(mesh);
  enemies.push({
    type, mesh, alive: true,
    fireTimer: Math.random() * diff.fireInt + 0.8,
    windup: 0, pending: null, queue: [],
    bob: Math.random() * Math.PI * 2,
  });
}

function spawnHeals() {
  const fracs = sel.diff === 2 ? [0.25, 0.45, 0.65, 0.85] : [0.28, 0.52, 0.75];
  for (const f of fracs) {
    const orb = new THREE.Mesh(
      new THREE.SphereGeometry(0.42, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0x5cffa8, transparent: true, opacity: 0.9 })
    );
    const x = (Math.random() * 2 - 1) * (PATH_HALF - 2);
    const z = cur.len * f;
    orb.position.set(x, 1.1, z);
    scene.add(orb);
    heals.push({ mesh: orb, taken: false, z });
  }
}

// ============================================================
// タイトル画面の選択UI
// ============================================================
function refreshChips() {
  document.querySelectorAll('[data-stage]').forEach((b) => b.classList.toggle('sel', +b.dataset.stage === sel.stage));
  document.querySelectorAll('[data-diff]').forEach((b) => b.classList.toggle('sel', +b.dataset.diff === sel.diff));
}
document.querySelectorAll('[data-stage]').forEach((btn) => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (S.mode !== 'title') return;
    sel.stage = +btn.dataset.stage;
    localStorage.setItem('sr.stage', sel.stage);
    refreshChips();
    disposeStage(cur);
    cur = buildStage(sel.stage); // 背景を即座に切り替えてプレビュー
  });
});
document.querySelectorAll('[data-diff]').forEach((btn) => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (S.mode !== 'title') return;
    sel.diff = +btn.dataset.diff;
    localStorage.setItem('sr.diff', sel.diff);
    refreshChips();
  });
});
document.getElementById('start-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  Sfx.ensure();
  startGame();
});
refreshChips();

function startGame() {
  if (S.mode !== 'title') return;
  diff = DIFFS[sel.diff];
  spawnEnemies();
  spawnHeals();
  S.mode = 'play';
  document.getElementById('title-overlay').classList.remove('on');
  document.getElementById('hud').classList.add('on');
  document.getElementById('stage-label').textContent = `${STAGES[sel.stage].name}・${diff.name}`;
  popup('出撃!');
}

// ============================================================
// 入力
// ============================================================
const keys = {};
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  keys[k] = true;
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();

  Sfx.ensure();
  if (S.mode === 'title' && k === 'enter') { startGame(); return; }
  if ((S.mode === 'over' || S.mode === 'clear') && k === 'r') { location.reload(); return; }
  if (S.mode === 'play') {
    if (k === 'r') { location.reload(); return; }
    if (k === 'j' || k === 'enter') trySlash();
    if (k === 'shift') trySlide();
    if (k === ' ') tryJump();
  }
});
window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });

window.addEventListener('pointerdown', (e) => {
  if (e.target.closest('button')) return; // UIボタンはそれぞれのハンドラで処理
  Sfx.ensure();
  if (S.mode === 'over' || S.mode === 'clear') { location.reload(); return; }
  if (S.mode === 'play') trySlash();
});

// ============================================================
// アクション
// ============================================================
function inputDir() {
  const d = new THREE.Vector3();
  if (keys['w'] || keys['arrowup']) d.z += 1;
  if (keys['s'] || keys['arrowdown']) d.z -= 1;
  if (keys['a'] || keys['arrowleft']) d.x += 1;   // カメラは+z向き: 左= +x
  if (keys['d'] || keys['arrowright']) d.x -= 1;
  return d.normalize();
}

function trySlide() {
  if (S.slide > 0 || S.slideCd > 0 || S.lunge) return;
  const dir = inputDir();
  S.slideDir.copy(dir.lengthSq() > 0.01 ? dir : new THREE.Vector3(0, 0, 1));
  S.slide = S.grounded ? SLIDE_TIME : SLIDE_TIME * 0.85;
  S.airDash = !S.grounded;   // 空中ならエアダッシュ(高度維持)
  S.slideCd = SLIDE_CD;
  S.invuln = Math.max(S.invuln, S.slide + 0.05);
  S.wall = 0;
  document.getElementById('dash-tint').style.opacity = '1';
  for (let i = 0; i < 10; i++) spawnPetal(true); // 桜吹雪
  Sfx.dash();
}

function tryJump() {
  if (S.lunge) return;
  if (S.slide > 0 && S.grounded) { // スライド中のジャンプはスライドをキャンセル
    S.slide = 0;
    S.airDash = false;
    document.getElementById('dash-tint').style.opacity = '0';
  } else if (S.slide > 0) return;

  if (S.wall !== 0) {
    // 壁蹴りジャンプ: 内側へ跳ぶ
    S.vy = JUMP_V;
    S.impulse.x = -S.wall * 10;
    S.wall = 0;
    S.wallTime = Math.max(0, S.wallTime - 0.6);
    spawnJumpRing(player.root.position.clone().add(new THREE.Vector3(0, 0.4, 0)), 0xaef2ff);
    Sfx.airjump();
  } else if (S.grounded) {
    S.vy = JUMP_V;
    S.grounded = false;
    spawnParticles(player.root.position.clone().add(new THREE.Vector3(0, 0.1, 0)), 0x9aa4c0, 5);
    Sfx.jump();
  } else if (S.airJumps > 0) {
    S.airJumps--;
    S.vy = AIRJUMP_V;
    spawnJumpRing(player.root.position.clone().add(new THREE.Vector3(0, 0.2, 0)), 0x7cd8ff);
    Sfx.airjump();
  }
}

function trySlash() {
  if (S.slashCd > 0 || S.lunge) return;
  S.slashCd = SLASH_CD;

  const p = player.root.position;
  let best = null, bestD = SLASH_RANGE;
  for (const e of enemies) {
    if (!e.alive) continue;
    const dz = e.mesh.position.z - p.z;
    if (dz < -2) continue;
    const d = e.mesh.position.distanceTo(p);
    if (d < bestD) { bestD = d; best = e; }
  }

  if (best) {
    const to = best.mesh.position.clone();
    const dir = to.clone().sub(p).setY(0).normalize();
    to.sub(dir.clone().multiplyScalar(1.0)).setY(0);
    S.lunge = { target: best, t: 0, from: p.clone(), to };
    S.invuln = Math.max(S.invuln, 0.35);
    S.swing = 0.3;
    S.vy = 0;
    Sfx.slash();
  } else {
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
  popup(['斬', '一閃', '見事'][Math.floor(Math.random() * 3)]);
  Sfx.kill();
}

function damagePlayer(amount, cause) {
  if (S.invuln > 0 || S.mode !== 'play') return;
  S.hp = Math.max(0, S.hp - amount * diff.dmgMul);
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
    `${cause}に倒された…<br>${STAGES[sel.stage].name}・${diff.name}　｜　到達 <span>${Math.floor(player.root.position.z)}</span> / ${cur.len} 間　｜　撃破 <span>${S.kills}</span> 体`;
  document.getElementById('over-overlay').classList.add('on');
  Sfx.over();
}

function gameClear() {
  S.mode = 'clear';
  document.getElementById('clear-result').innerHTML =
    `${STAGES[sel.stage].name}・${diff.name}<br>タイム <span>${S.time.toFixed(1)}</span> 秒　｜　撃破 <span>${S.kills}</span> 体　｜　残り体力 <span>${Math.ceil(S.hp)}</span>`;
  document.getElementById('clear-overlay').classList.add('on');
  Sfx.clear();
}

function popup(text) {
  const el = document.getElementById('popup');
  el.textContent = text;
  el.classList.remove('pop');
  void el.offsetWidth;
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

function spawnJumpRing(pos, color) {
  const geo = new THREE.RingGeometry(0.3, 0.55, 22);
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(pos);
  mesh.rotation.x = -Math.PI / 2;
  scene.add(mesh);
  effects.push({
    mesh, life: 0, ttl: 0.3,
    update(e, k) {
      e.mesh.scale.setScalar(1 + k * 3);
      e.mesh.material.opacity = 0.85 * (1 - k);
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
  const mat = new THREE.MeshBasicMaterial({ color: 0x49d6ff, transparent: true, opacity: 0.35, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.0, 1.6), mat);
  mesh.position.copy(player.root.position).add(new THREE.Vector3(0, 0.55 + (S.wall !== 0 ? 0.5 : 0), 0));
  mesh.rotation.copy(player.model.rotation);
  scene.add(mesh);
  effects.push({
    mesh, life: 0, ttl: 0.28,
    update(e, k) { e.mesh.material.opacity = 0.35 * (1 - k); },
  });
}

// 桜の花びら: ダッシュ中に舞い上がり、カメラのほうへ立体的に流れてくる
const petalGeo = new THREE.PlaneGeometry(0.15, 0.11);
let petalTimer = 0;
function spawnPetal(burst = false) {
  const colors = [0xffb7cf, 0xf7a8c4, 0xffd0dd];
  const mat = new THREE.MeshBasicMaterial({
    color: colors[Math.floor(Math.random() * colors.length)],
    transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false,
  });
  const mesh = new THREE.Mesh(petalGeo, mat);
  const p = player.root.position;
  mesh.position.set(
    p.x + (Math.random() - 0.5) * (burst ? 3.2 : 2.2),
    p.y + 0.2 + Math.random() * 1.9,
    p.z + (Math.random() - 0.5) * 1.6
  );
  mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
  scene.add(mesh);
  const vel = new THREE.Vector3(
    (Math.random() - 0.5) * (burst ? 8 : 4.5),
    0.5 + Math.random() * 2.4,
    -12 - Math.random() * 10 // 手前(カメラ側)へ流れ、視界を通り過ぎていく
  );
  const spin = new THREE.Vector3(4 + Math.random() * 7, 4 + Math.random() * 8, 3 + Math.random() * 6);
  const phase = Math.random() * Math.PI * 2;
  effects.push({
    mesh, life: 0, ttl: 0.8 + Math.random() * 0.4, sharedGeo: true,
    update(e, k, dt2) {
      vel.y -= 2.5 * dt2;
      e.mesh.position.addScaledVector(vel, dt2);
      e.mesh.position.x += Math.sin(e.life * 9 + phase) * dt2 * 1.8; // ひらひらと横に揺れる
      e.mesh.rotation.x += spin.x * dt2;
      e.mesh.rotation.y += spin.y * dt2;
      e.mesh.rotation.z += spin.z * dt2;
      e.mesh.material.opacity = k > 0.6 ? 0.95 * (1 - (k - 0.6) / 0.4) : 0.95;
    },
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
// 弾: 種類ごとに形・サイズ・速さ・避け方が違う
//  orb      通常弾(橙の火球)
//  corb     弾幕カーテン用の赤玉(横一列 → ジャンプかダッシュ無敵で抜ける)
//  shuriken 手裏剣(高速回転・速い)
//  big      巨大な妖力弾(遅いがデカい)
//  wave     地走りの衝撃波(横に広い → ジャンプ必須)
// ============================================================
function makeBulletMesh(kind) {
  if (kind === 'shuriken') {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0xbfe8ff, metalness: 0.8, roughness: 0.25, emissive: 0x3aa8ff, emissiveIntensity: 0.5 });
    for (let i = 0; i < 4; i++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.05, 0.16), mat);
      blade.rotation.y = (i * Math.PI) / 4;
      g.add(blade);
    }
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.08, 8), mat);
    g.add(core);
    return g;
  }
  if (kind === 'big') {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.62, 16, 12), new THREE.MeshBasicMaterial({ color: 0xb64dff }));
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(1.0, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0x8a2be2, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    mesh.add(glow);
    return mesh;
  }
  if (kind === 'wave') {
    // 幅はspawn側でスケールする
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1.0, 0.35),
      new THREE.MeshBasicMaterial({ color: 0xff2e6a, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    return mesh;
  }
  // orb / corb
  const color = kind === 'corb' ? 0xff3b57 : 0xff7a45;
  const glowC = kind === 'corb' ? 0xff2040 : 0xff4520;
  const r = kind === 'corb' ? 0.3 : 0.22;
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), new THREE.MeshBasicMaterial({ color }));
  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(r * 1.9, 8, 6),
    new THREE.MeshBasicMaterial({ color: glowC, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  mesh.add(glow);
  return mesh;
}

const BULLET_SPEC = {
  orb:      { speed: 15, r: 0.85, dmg: 12 },
  corb:     { speed: 11, r: 0.95, dmg: 12 },
  shuriken: { speed: 22, r: 0.8,  dmg: 10 },
  big:      { speed: 8,  r: 1.3,  dmg: 20 },
  wave:     { speed: 10, r: 0,    dmg: 18 },
};

function spawnBullet(kind, from, vel, extra = {}) {
  if (bullets.length >= MAX_BULLETS) return;
  const mesh = makeBulletMesh(kind);
  mesh.position.copy(from);
  scene.add(mesh);
  bullets.push({ kind, mesh, vel, life: 7, dodged: false, r: BULLET_SPEC[kind].r, dmg: BULLET_SPEC[kind].dmg, ...extra });
}

function playerCenter() {
  const p = player.root.position;
  return new THREE.Vector3(p.x, p.y + 1, p.z);
}

function aimedVel(from, speed) {
  return playerCenter().sub(from).normalize().multiplyScalar(speed);
}

// ---- 攻撃パターン ----
function gunnerAttack(e) {
  const p = player.root.position;
  const ep = e.mesh.position;
  const dz = ep.z - p.z;
  const from = ep.clone().add(new THREE.Vector3(0, 1.35, 0));
  const sm = diff.speedMul;
  let type = pickWeighted(diff.attacks);
  if (type === 'wave' && dz < 5) type = 'orb';
  if (type === 'curtain' && dz < 10) type = 'orb';

  const near = ep.distanceTo(p) < 48;
  switch (type) {
    case 'orb':
      spawnBullet('orb', from, aimedVel(from.clone(), BULLET_SPEC.orb.speed * sm));
      if (near) Sfx.shoot();
      break;
    case 'shuriken':
      spawnBullet('shuriken', from, aimedVel(from.clone(), BULLET_SPEC.shuriken.speed * sm));
      if (near) Sfx.shoot();
      break;
    case 'big':
      spawnBullet('big', from, aimedVel(from.clone(), BULLET_SPEC.big.speed * sm));
      if (near) Sfx.waveSfx();
      break;
    case 'fan3':
    case 'fan5': {
      // 扇状の同時発射(横方向に広げる)
      const n = type === 'fan5' ? 5 : 3;
      const spread = type === 'fan5' ? 0.16 : 0.18;
      const base = aimedVel(from.clone(), BULLET_SPEC.orb.speed * sm);
      for (let i = 0; i < n; i++) {
        const a = (i - (n - 1) / 2) * spread;
        const v = base.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), a);
        spawnBullet('orb', from.clone(), v);
      }
      if (near) Sfx.shoot();
      break;
    }
    case 'burst3':
      // 狙い撃ちの3連射(発射時に毎回狙い直す)
      e.queue = [{ t: 0 }, { t: 0.13 }, { t: 0.26 }];
      break;
    case 'wave': {
      // 地走りの衝撃波: 横に広い → ジャンプで越える
      const halfW = sel.diff === 2 ? (Math.random() < 0.5 ? 5.2 : 3.6) : 2.6;
      const wFrom = new THREE.Vector3(THREE.MathUtils.clamp(p.x, -PATH_HALF + 1, PATH_HALF - 1), 0.5, ep.z - 0.5);
      const mesh = makeBulletMesh('wave');
      mesh.scale.x = halfW * 2;
      mesh.position.copy(wFrom);
      scene.add(mesh);
      if (bullets.length < MAX_BULLETS) {
        bullets.push({ kind: 'wave', mesh, vel: new THREE.Vector3(0, 0, -BULLET_SPEC.wave.speed * sm), life: 8, dodged: true, r: 0, dmg: BULLET_SPEC.wave.dmg, halfW });
      }
      if (ep.distanceTo(p) < 55) Sfx.waveSfx();
      break;
    }
    case 'curtain': {
      // 面制圧: 道幅いっぱいの弾のカーテン → ジャンプかダッシュ無敵で抜ける
      for (let x = -PATH_HALF; x <= PATH_HALF + 0.01; x += 1.55) {
        spawnBullet('corb', new THREE.Vector3(x, 1.0, ep.z - 1), new THREE.Vector3(0, 0, -BULLET_SPEC.corb.speed * sm));
      }
      if (ep.distanceTo(p) < 60) Sfx.curtain();
      break;
    }
  }
  spawnMuzzle(from);
}

// ============================================================
// 更新処理
// ============================================================
let ghostTimer = 0;

function updatePlayer(dt) {
  const p = player.root.position;

  if (S.lunge) {
    const L = S.lunge;
    L.t += dt / 0.13;
    if (L.t >= 1) {
      p.copy(L.to);
      S.grounded = true;
      S.airJumps = 1;
      if (L.target.alive) killEnemy(L.target);
      S.lunge = null;
    } else {
      p.lerpVectors(L.from, L.to, L.t);
    }
  } else {
    if (S.slide > 0) {
      S.slide -= dt;
      p.addScaledVector(S.slideDir, SLIDE_SPEED * dt);
      if (S.airDash) S.vy = 0; // エアダッシュ中は高度維持
      ghostTimer -= dt;
      if (ghostTimer <= 0) { spawnGhost(); ghostTimer = 0.04; }
      petalTimer -= dt;
      if (petalTimer <= 0) { spawnPetal(); spawnPetal(); petalTimer = 0.022; }
      if (S.slide <= 0) {
        S.airDash = false;
        document.getElementById('dash-tint').style.opacity = '0';
      }
    } else {
      const d = inputDir();
      const speed = (d.z < -0.5 ? BACK_SPEED : MOVE_SPEED) * (S.wall !== 0 ? 1.15 : 1);
      p.addScaledVector(d, speed * dt);
      S.runPhase += d.lengthSq() > 0.01 ? dt * 11 : dt * 2;
    }

    // ノックバック等の外力
    p.addScaledVector(S.impulse, dt);
    S.impulse.multiplyScalar(Math.exp(-5 * dt));

    // ---- 壁走り判定 ----
    const wantsWall = !S.grounded && S.slide <= 0 && p.y > 0.5 && p.y < 3.0 &&
      S.wallTime < WALLRUN_MAX && inputDir().z > 0.3 && Math.abs(p.x) >= PATH_HALF - 0.05 && S.vy < 8;
    if (wantsWall) {
      if (S.wall === 0) { popup('壁走り'); Sfx.wall(); }
      S.wall = Math.sign(p.x);
      S.wallTime += dt;
      S.vy = -1.2; // ゆっくり降下しながら走る
      ghostTimer -= dt;
      if (ghostTimer <= 0) { spawnGhost(); ghostTimer = 0.06; }
      petalTimer -= dt;
      if (petalTimer <= 0) { spawnPetal(); petalTimer = 0.05; }
    } else {
      S.wall = 0;
    }

    // ---- 重力 ----
    if (!S.airDash && S.wall === 0) S.vy -= GRAVITY * dt;
    p.y += S.vy * dt;
    if (p.y <= 0) {
      if (!S.grounded && S.vy < -8) { spawnParticles(p.clone().add(new THREE.Vector3(0, 0.1, 0)), 0x9aa4c0, 4); Sfx.land(); }
      p.y = 0;
      S.vy = 0;
      S.grounded = true;
      S.airJumps = 1;
      S.wallTime = 0;
    } else {
      S.grounded = false;
    }
  }

  p.x = THREE.MathUtils.clamp(p.x, -PATH_HALF, PATH_HALF);
  p.z = THREE.MathUtils.clamp(p.z, 0, cur.len + 2);

  S.slideCd = Math.max(0, S.slideCd - dt);
  S.slashCd = Math.max(0, S.slashCd - dt);
  S.invuln = Math.max(0, S.invuln - dt);
  S.swing = Math.max(0, S.swing - dt);

  // 影は地面に貼りつけ、高さで薄くする
  player.blob.position.y = 0.02 - p.y;
  player.blob.material.opacity = Math.max(0.08, 0.4 - p.y * 0.08);

  // ---- ポーズ / アニメーション ----
  const m = player.model;
  const lerpR = (curV, target, k) => THREE.MathUtils.lerp(curV, target, Math.min(1, k));
  if (S.slide > 0 && !S.airDash) {
    m.rotation.x = lerpR(m.rotation.x, -1.15, dt * 18);
    m.position.y = lerpR(m.position.y, -0.35, dt * 18);
    player.legL.rotation.x = lerpR(player.legL.rotation.x, -1.3, dt * 14);
    player.legR.rotation.x = lerpR(player.legR.rotation.x, -1.1, dt * 14);
    player.armL.rotation.x = lerpR(player.armL.rotation.x, 2.4, dt * 14);
  } else if (S.slide > 0) {
    // エアダッシュ: 前傾して突っ込む
    m.rotation.x = lerpR(m.rotation.x, 0.85, dt * 18);
    m.position.y = lerpR(m.position.y, 0, dt * 18);
    player.legL.rotation.x = lerpR(player.legL.rotation.x, 0.4, dt * 14);
    player.legR.rotation.x = lerpR(player.legR.rotation.x, 0.6, dt * 14);
  } else if (S.lunge) {
    m.rotation.x = lerpR(m.rotation.x, 0.5, dt * 20);
    m.position.y = lerpR(m.position.y, 0.1, dt * 20);
    player.armR.rotation.x = -2.6;
  } else if (S.wall !== 0) {
    // 壁走り: 壁側へ大きく傾ける
    m.rotation.x = lerpR(m.rotation.x, 0.25, dt * 14);
    m.rotation.z = lerpR(m.rotation.z, S.wall * 0.85, dt * 14);
    m.position.y = lerpR(m.position.y, 0, dt * 14);
    const sw = Math.sin(S.runPhase * 1.5);
    player.legL.rotation.x = sw * 1.0;
    player.legR.rotation.x = -sw * 1.0;
    player.armL.rotation.x = -sw * 0.8;
    player.armR.rotation.x = sw * 0.8;
    S.runPhase += dt * 6;
  } else if (!S.grounded) {
    // 空中: 脚をたたむ
    m.rotation.x = lerpR(m.rotation.x, 0.22, dt * 10);
    m.position.y = lerpR(m.position.y, 0, dt * 10);
    player.legL.rotation.x = lerpR(player.legL.rotation.x, -0.9, dt * 10);
    player.legR.rotation.x = lerpR(player.legR.rotation.x, -0.35, dt * 10);
    player.armL.rotation.x = lerpR(player.armL.rotation.x, -1.6, dt * 8);
    if (S.swing <= 0) player.armR.rotation.x = lerpR(player.armR.rotation.x, -1.4, dt * 8);
  } else {
    // 走行中は前傾姿勢で疾走感を出す
    const running = inputDir().lengthSq() > 0.01;
    m.rotation.x = lerpR(m.rotation.x, running ? 0.34 : 0.02, dt * 10);
    m.position.y = lerpR(m.position.y, Math.abs(Math.sin(S.runPhase)) * 0.08, dt * 14);
    const sw = Math.sin(S.runPhase);
    player.legL.rotation.x = sw * 0.85;
    player.legR.rotation.x = -sw * 0.85;
    player.armL.rotation.x = -sw * 0.7;
    if (S.swing <= 0) player.armR.rotation.x = sw * 0.7;
  }
  if (S.swing > 0) {
    const k = 1 - S.swing / 0.3;
    player.armR.rotation.x = -2.8 + k * 3.6;
    player.armR.rotation.z = -0.5 + k * 1.0;
  } else if (S.wall === 0) {
    player.armR.rotation.z = lerpR(player.armR.rotation.z, 0, dt * 10);
  }
  if (S.wall === 0 && S.lunge === null) {
    const d2 = inputDir();
    m.rotation.z = lerpR(m.rotation.z, -d2.x * 0.16, dt * 8);
  }
  m.visible = S.invuln > 0 && S.slide <= 0 && !S.lunge ? Math.floor(S.time * 20) % 2 === 0 : true;

  // ポニーテールと帯のたなびき(速いほど後ろへ流れる)
  const wave = Math.sin(S.time * 9);
  const fast = S.slide > 0 || S.wall !== 0;
  const speedK = fast ? 1.8 : 1;
  const moving = inputDir().lengthSq() > 0.01;
  player.ponyBase.rotation.x = lerpR(player.ponyBase.rotation.x, fast ? -0.05 : moving ? -0.35 : -0.85, dt * 6);
  player.ponySegs.forEach((seg, i) => {
    seg.rotation.x = wave * 0.16 * (i + 1) * 0.5 * speedK - 0.08;
  });
  player.sashBase.rotation.x = lerpR(player.sashBase.rotation.x, fast ? -0.1 : moving ? -0.3 : -0.55, dt * 6);
  player.sashSegs.forEach((seg, i) => {
    seg.rotation.x = wave * 0.2 * (i + 1) * 0.4 * speedK - 0.06;
  });

  // 回復の霊珠
  for (const h of heals) {
    if (h.taken) continue;
    h.mesh.position.y = 1.1 + Math.sin(S.time * 3 + h.z) * 0.2;
    h.mesh.rotation.y += dt * 2;
    if (h.mesh.position.distanceTo(p) < 1.5) {
      h.taken = true;
      scene.remove(h.mesh);
      S.hp = Math.min(MAX_HP, S.hp + 25);
      popup('回復');
      spawnParticles(h.mesh.position.clone(), 0x5cffa8, 10);
      Sfx.dodge();
    }
  }

  if (p.z >= cur.len - 1.5) gameClear();
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
      e.mesh.lookAt(p.x, 0, p.z);

      // 3連射キューの処理
      if (e.queue.length > 0) {
        e.queue[0].t -= dt;
        if (e.queue[0].t <= 0) {
          e.queue.shift();
          const from = ep.clone().add(new THREE.Vector3(0, 1.35, 0));
          spawnBullet('orb', from, aimedVel(from.clone(), BULLET_SPEC.orb.speed * diff.speedMul));
          spawnMuzzle(from);
          if (ep.distanceTo(p) < 48) Sfx.shoot();
        }
      }

      if (dz > -8 && dz < 62) {
        if (e.windup > 0) {
          e.windup -= dt;
          const k = 1 + Math.sin(S.time * 40) * 0.5;
          if (e.mesh.userData.eye) e.mesh.userData.eye.scale.setScalar(k);
          if (e.windup <= 0) {
            if (e.mesh.userData.eye) e.mesh.userData.eye.scale.setScalar(1);
            gunnerAttack(e);
          }
        } else {
          e.fireTimer -= dt;
          if (e.fireTimer <= 0) {
            e.windup = diff.windup;
            e.fireTimer = diff.fireInt * (0.8 + Math.random() * 0.5);
          }
        }
      }
    } else {
      const dist = ep.distanceTo(p);
      e.mesh.lookAt(p.x, 0, p.z);
      if (dist < 32) {
        const dir = p.clone().sub(ep).setY(0).normalize();
        ep.addScaledVector(dir, 5.2 * diff.bruteMul * dt);
        ep.y = Math.abs(Math.sin(e.bob * 2.4)) * 0.18;
      }
      if (dist < 1.9 && p.y < 2.2) {
        damagePlayer(25, '鬼武者');
        const dir = p.clone().sub(ep).setY(0).normalize();
        S.impulse.addScaledVector(dir, 14);
      }
    }
  }
}

function updateBullets(dt) {
  const pc = playerCenter();
  const p = player.root.position;
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.life -= dt;
    b.mesh.position.addScaledVector(b.vel, dt);

    // 種類ごとの見た目の動き
    if (b.kind === 'shuriken') {
      b.mesh.rotation.y += 22 * dt;
    } else if (b.kind === 'big') {
      const k = 1 + Math.sin(S.time * 10) * 0.12;
      b.mesh.scale.setScalar(k);
    } else if (b.kind === 'wave') {
      b.mesh.material.opacity = 0.55 + Math.sin(S.time * 24) * 0.2;
    }

    if (b.life <= 0 || b.mesh.position.y < -0.5 || b.mesh.position.z < p.z - 30) {
      scene.remove(b.mesh);
      bullets.splice(i, 1);
      continue;
    }

    let hit = false;
    let graze = false;
    if (b.kind === 'wave') {
      // 衝撃波: 低空にいる時だけ当たる → ジャンプで回避
      hit = Math.abs(b.mesh.position.z - p.z) < 0.55 && Math.abs(b.mesh.position.x - p.x) < b.halfW && p.y < 1.05;
    } else {
      const d = b.mesh.position.distanceTo(pc);
      hit = d < b.r;
      graze = d < b.r + 0.5;
    }

    if (hit || graze) {
      if (S.slide > 0 || S.invuln > 0) {
        // ダッシュ中の見切り(かすめ避け): スローモーション + ダッシュ回復短縮
        if (S.slide > 0 && !b.dodged) {
          b.dodged = true;
          S.slowmo = Math.max(S.slowmo, 0.08);
          S.slideCd = Math.max(0, S.slideCd - 0.5);
          popup('見切り');
          Sfx.dodge();
        }
      } else if (hit) {
        damagePlayer(b.dmg, b.kind === 'wave' ? '衝撃波' : b.kind === 'shuriken' ? '手裏剣' : '銃火');
        if (b.kind !== 'wave') {
          spawnParticles(b.mesh.position.clone(), 0xff7a45, 6);
          scene.remove(b.mesh);
          bullets.splice(i, 1);
        }
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
      if (e.mesh.geometry && !e.sharedGeo) e.mesh.geometry.dispose();
      if (e.mesh.material) e.mesh.material.dispose();
      effects.splice(i, 1);
    } else {
      e.update(e, k, dt);
    }
  }
}

const camPos = new THREE.Vector3(0, 4.2, -8);
function updateCamera(dt) {
  const p = player.root.position;
  const lowY = (S.slide > 0 && !S.airDash ? 2.8 : 4.2) + p.y * 0.6;
  const target = new THREE.Vector3(p.x * 0.8, lowY, p.z - 7.4);
  camPos.lerp(target, Math.min(1, dt * 6));

  S.shake = Math.max(0, S.shake - dt * 2.2);
  const sx = (Math.random() - 0.5) * S.shake * 0.5;
  const sy = (Math.random() - 0.5) * S.shake * 0.5;

  camera.position.set(camPos.x + sx, camPos.y + sy, camPos.z);
  camera.lookAt(p.x * 0.85, 1.9 + p.y * 0.7 + sy, p.z + 9);

  const targetFov = S.slide > 0 ? 86 : S.lunge ? 82 : S.wall !== 0 ? 80 : 72;
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
  el.timer.textContent = `${S.time.toFixed(1)} s`;
  const prog = Math.min(1, player.root.position.z / cur.len);
  el.progressFill.style.width = `${prog * 100}%`;
  el.distNum.textContent = Math.max(0, Math.ceil(cur.len - player.root.position.z));
}

// ============================================================
// メインループ
// ============================================================
let lastT = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const realDt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;

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
    S.runPhase += dt * 2;
    player.model.position.y = Math.abs(Math.sin(S.time)) * 0.02;
    S.time += dt;
  }

  updateEffects(dt);
  updateCamera(S.mode === 'title' ? dt * 0.5 : dt);

  cur.goalGlow.scale.setScalar(1 + Math.sin(now * 0.004) * 0.18);

  renderer.render(scene, camera);
}
requestAnimationFrame(loop);

// デバッグ・動作確認用フック
window.__game = { S, sel, player, enemies, bullets, get cur() { return cur; }, damagePlayer, DIFFS, STAGES };
