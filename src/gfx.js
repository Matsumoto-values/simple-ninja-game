// 描画強化モジュール: セルルック変換 / 輪郭線 / プロシージャルテクスチャ /
// グラデーション空 / ポストプロセス(ブルーム等)
import * as THREE from 'three';
import {
  EffectComposer, RenderPass, EffectPass,
  BloomEffect, VignetteEffect,
} from 'postprocessing';

// ------------------------------------------------------------
// トゥーン用グラデーションマップ(4段階のセル調ライティング)
// ------------------------------------------------------------
let _gradMap = null;
export function gradientMap() {
  if (_gradMap) return _gradMap;
  const data = new Uint8Array([90, 150, 210, 255]);
  const tex = new THREE.DataTexture(data, 4, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  _gradMap = tex;
  return tex;
}

export function toonMat(color, opts = {}) {
  return new THREE.MeshToonMaterial({ color, gradientMap: gradientMap(), ...opts });
}

// ------------------------------------------------------------
// 既存モデルを一括でセルルック化 + 影の設定
// MeshStandardMaterial → MeshToonMaterial に置換し、
// 発光系(MeshBasicMaterial)は影を落とさない光り物として扱う
// ------------------------------------------------------------
const _convCache = new Map();
export function applyToonAndShadows(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    const m = o.material;
    if (m && m.isMeshStandardMaterial) {
      let conv = _convCache.get(m);
      if (!conv) {
        conv = new THREE.MeshToonMaterial({
          color: m.color.clone(),
          map: m.map || null,
          gradientMap: gradientMap(),
          emissive: m.emissive ? m.emissive.clone() : undefined,
          emissiveIntensity: m.emissiveIntensity ?? 1,
          transparent: m.transparent,
          opacity: m.opacity,
        });
        _convCache.set(m, conv);
      }
      o.material = conv;
      o.castShadow = true;
      o.receiveShadow = true;
    } else if (m && m.isMeshToonMaterial) {
      o.castShadow = true;
      o.receiveShadow = true;
    } else {
      // 発光・半透明エフェクト類は影に関与させない
      o.castShadow = false;
    }
  });
}

// ------------------------------------------------------------
// 輪郭線(背面法): メッシュを少し膨らませた黒い裏面メッシュを重ねる
// ------------------------------------------------------------
const OUTLINE_MAT = new THREE.MeshBasicMaterial({ color: 0x0c0e16, side: THREE.BackSide });
export function addOutline(root, thickness = 1.06) {
  const targets = [];
  root.traverse((o) => {
    if (o.isMesh && o.material && (o.material.isMeshToonMaterial || o.material.isMeshStandardMaterial)) {
      targets.push(o);
    }
  });
  for (const mesh of targets) {
    const outline = new THREE.Mesh(mesh.geometry, OUTLINE_MAT);
    outline.scale.setScalar(thickness);
    outline.castShadow = false;
    outline.receiveShadow = false;
    outline.raycast = () => {};
    mesh.add(outline);
  }
}

// ------------------------------------------------------------
// プロシージャルテクスチャ(canvas製・外部アセット不要)
// ------------------------------------------------------------
function canvasTex(size, draw, repeatX = 1, repeatY = 1) {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d');
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// 石畳(参道用)
export function stoneTex(repeatX, repeatY) {
  return canvasTex(256, (ctx, s) => {
    ctx.fillStyle = '#8f8f96';
    ctx.fillRect(0, 0, s, s);
    const cols = 4, rows = 4;
    const w = s / cols, h = s / rows;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const off = (y % 2) * w * 0.5;
        const l = 78 + Math.random() * 24;
        ctx.fillStyle = `hsl(228, 8%, ${l * 0.6}%)`;
        ctx.fillRect(((x * w + off) % s), y * h, w - 3, h - 3);
        // ハイライト
        ctx.fillStyle = 'rgba(255,255,255,0.07)';
        ctx.fillRect(((x * w + off) % s), y * h, w - 3, 3);
      }
    }
    // 目地の影
    ctx.strokeStyle = 'rgba(10,12,20,0.55)';
    ctx.lineWidth = 3;
    for (let y = 0; y <= rows; y++) { ctx.beginPath(); ctx.moveTo(0, y * h - 1); ctx.lineTo(s, y * h - 1); ctx.stroke(); }
    // 汚れ
    for (let i = 0; i < 240; i++) {
      ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.1})`;
      ctx.fillRect(Math.random() * s, Math.random() * s, 2 + Math.random() * 4, 2 + Math.random() * 4);
    }
  }, repeatX, repeatY);
}

// 地面(草地・土用のノイズ)
export function noiseTex(repeatX, repeatY) {
  return canvasTex(256, (ctx, s) => {
    ctx.fillStyle = '#909090';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 2600; i++) {
      const v = 108 + Math.random() * 60;
      ctx.fillStyle = `rgba(${v},${v},${v},0.5)`;
      ctx.fillRect(Math.random() * s, Math.random() * s, 2 + Math.random() * 3, 2 + Math.random() * 3);
    }
  }, repeatX, repeatY);
}

// 塀(漆喰+横木)
export function plasterTex(repeatX, repeatY) {
  return canvasTex(256, (ctx, s) => {
    ctx.fillStyle = '#a8a8a8';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 1500; i++) {
      const v = 140 + Math.random() * 50;
      ctx.fillStyle = `rgba(${v},${v},${v},0.35)`;
      ctx.fillRect(Math.random() * s, Math.random() * s, 3 + Math.random() * 5, 2 + Math.random() * 3);
    }
    // 上下の横木ライン
    ctx.fillStyle = 'rgba(40,34,30,0.85)';
    ctx.fillRect(0, 0, s, 14);
    ctx.fillRect(0, s - 18, s, 18);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(0, 14, s, 3);
  }, repeatX, repeatY);
}

// ------------------------------------------------------------
// グラデーションの空ドーム
// ------------------------------------------------------------
export function makeSkyDome(topColor, horizonColor, radius = 340) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(topColor) },
      horizon: { value: new THREE.Color(horizonColor) },
    },
    vertexShader: `
      varying vec3 vPos;
      void main() {
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 top;
      uniform vec3 horizon;
      varying vec3 vPos;
      void main() {
        float h = clamp(normalize(vPos).y * 1.05 + 0.05, 0.0, 1.0);
        vec3 col = mix(horizon, top, pow(h, 0.6));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(radius, 24, 16), mat);
  dome.renderOrder = -10;
  return dome;
}

// ------------------------------------------------------------
// ポストプロセス(ブルーム + ビネット)
// ------------------------------------------------------------
export function setupComposer(renderer, scene, camera, lowPower) {
  const composer = new EffectComposer(renderer, {
    multisampling: lowPower ? 0 : 4,
  });
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new BloomEffect({
    mipmapBlur: true,
    intensity: 1.0,
    luminanceThreshold: 0.32,
    luminanceSmoothing: 0.25,
  });
  const vignette = new VignetteEffect({ darkness: 0.42, offset: 0.28 });
  composer.addPass(new EffectPass(camera, bloom, vignette));
  return composer;
}

// ------------------------------------------------------------
// 影つき太陽光のセットアップ(プレイヤー追従はmain側で行う)
// ------------------------------------------------------------
export function setupShadowLight(light, lowPower) {
  light.castShadow = true;
  light.shadow.mapSize.set(lowPower ? 1024 : 2048, lowPower ? 1024 : 2048);
  const cam = light.shadow.camera;
  cam.left = -24; cam.right = 24;
  cam.top = 30; cam.bottom = -14;
  cam.near = 1; cam.far = 140;
  light.shadow.bias = -0.0004;
  light.shadow.normalBias = 0.03;
}
