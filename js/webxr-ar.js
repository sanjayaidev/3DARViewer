// Advanced AR — Three.js + WebXR
// Handheld AR only works on Chrome/Android right now (iOS Safari has no
// WebXR support at all — that's a browser limitation, not something this
// module can work around). Capability is checked before this ever runs.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const MODEL_URL = 'https://modelviewer.dev/shared-assets/models/Astronaut.glb';
const MIN_SCALE = 0.15;
const MAX_SCALE = 1.5;
const BASE_SCALE = 0.35;

let renderer, scene, camera, reticle, controller;
let hitTestSource = null;
let hitTestSourceRequested = false;
let framesSinceReady = 0;
let framesWithHit = 0;
let placedModel = null;
let loadedGltfTemplate = null;
let session = null;

let canvas, overlayEl, hintEl, exitBtn, cartBtn;
let onExitCallback = null;

// Touch gesture state
const touch = { mode: null, lastX: 0, lastY: 0, lastDist: 0 };

async function isSupported() {
  if (!('xr' in navigator)) return false;
  try {
    return await navigator.xr.isSessionSupported('immersive-ar');
  } catch {
    return false;
  }
}

function setupScene() {
  scene = new THREE.Scene();

  scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.2));
  const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
  dirLight.position.set(1, 2, 1);
  scene.add(dirLight);

  const reticleGeo = new THREE.RingGeometry(0.06, 0.08, 32).rotateX(-Math.PI / 2);
  const reticleMat = new THREE.MeshBasicMaterial({ color: 0xe3a63d });
  reticle = new THREE.Mesh(reticleGeo, reticleMat);
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);
}

function loadModel() {
  return new Promise((resolve, reject) => {
    new GLTFLoader().load(MODEL_URL, (gltf) => resolve(gltf.scene), undefined, reject);
  });
}

function placeModel() {
  if (!reticle.visible || placedModel) return;
  placedModel = loadedGltfTemplate.clone(true);
  placedModel.scale.setScalar(BASE_SCALE);
  placedModel.position.setFromMatrixPosition(reticle.matrix);
  placedModel.quaternion.setFromRotationMatrix(reticle.matrix);
  scene.add(placedModel);
  reticle.visible = false;
  hintEl.textContent = 'Drag to rotate · pinch to resize · two fingers to move';
  cartBtn.hidden = false;
}

function onTouchStart(e) {
  if (!placedModel) return;
  if (e.touches.length === 1) {
    touch.mode = 'rotate';
    touch.lastX = e.touches[0].clientX;
  } else if (e.touches.length === 2) {
    const [a, b] = e.touches;
    touch.lastDist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    touch.lastX = (a.clientX + b.clientX) / 2;
    touch.lastY = (a.clientY + b.clientY) / 2;
    touch.mode = 'pinchpan';
  }
}

function onTouchMove(e) {
  if (!placedModel || !touch.mode) return;
  e.preventDefault();

  if (touch.mode === 'rotate' && e.touches.length === 1) {
    const x = e.touches[0].clientX;
    placedModel.rotation.y += (x - touch.lastX) * 0.01;
    touch.lastX = x;
    return;
  }

  if (touch.mode === 'pinchpan' && e.touches.length === 2) {
    const [a, b] = e.touches;
    const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const newScale = THREE.MathUtils.clamp(
      placedModel.scale.x * (dist / touch.lastDist),
      MIN_SCALE,
      MAX_SCALE
    );
    placedModel.scale.setScalar(newScale);
    touch.lastDist = dist;

    const midX = (a.clientX + b.clientX) / 2;
    const midY = (a.clientY + b.clientY) / 2;
    const panX = (midX - touch.lastX) * 0.003;
    const panY = (midY - touch.lastY) * 0.003;

    // Move relative to where the phone is facing, flattened to the floor plane
    const forward = new THREE.Vector3();
    controller.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

    placedModel.position.addScaledVector(right, panX);
    placedModel.position.addScaledVector(forward, -panY);

    touch.lastX = midX;
    touch.lastY = midY;
  }
}

function onTouchEnd(e) {
  if (e.touches.length === 0) touch.mode = null;
}

function cleanupListeners() {
  // Listeners live on overlayEl, not canvas — see start() for why.
  overlayEl.removeEventListener('touchstart', onTouchStart);
  overlayEl.removeEventListener('touchmove', onTouchMove);
  overlayEl.removeEventListener('touchend', onTouchEnd);
}

function onSessionEnd() {
  hitTestSourceRequested = false;
  hitTestSource = null;
  placedModel = null;
  framesSinceReady = 0;
  framesWithHit = 0;
  overlayEl.hidden = true;
  cartBtn.hidden = true;
  cleanupListeners();
  if (renderer) renderer.setAnimationLoop(null);
  if (typeof onExitCallback === 'function') onExitCallback();
}

function render(timestamp, frame) {
  try {
    if (!frame) return;
    const referenceSpace = renderer.xr.getReferenceSpace();
    const xrSession = renderer.xr.getSession();

    if (!hitTestSourceRequested) {
      hitTestSourceRequested = true; // set immediately so we never re-enter this branch
      xrSession
        .requestReferenceSpace('viewer')
        .then((viewerSpace) => xrSession.requestHitTestSource({ space: viewerSpace }))
        .then((source) => {
          hitTestSource = source;
          console.log('[AR] hit-test source ready');
        })
        .catch((err) => {
          // Previously this rejection was unhandled, so a failure here left
          // hitTestSource permanently null with no visible error — the
          // reticle would simply never appear and the hint text would stay
          // stuck on "find a surface" forever, looking identical to a
          // real-world tracking issue.
          console.error('[AR] failed to set up hit-test source:', err);
          if (hintEl) hintEl.textContent = 'Hit-test setup failed: ' + err.message;
        });
      xrSession.addEventListener('end', onSessionEnd);
    }

    if (hitTestSource && !placedModel) {
      const results = frame.getHitTestResults(hitTestSource);
      framesSinceReady++;
      if (results.length > 0) {
        framesWithHit++;
        const pose = results[0].getPose(referenceSpace);
        reticle.visible = true;
        reticle.matrix.fromArray(pose.transform.matrix);
      } else {
        reticle.visible = false;
      }
      // Lightweight on-screen diagnostics: updates roughly once a second so
      // you can see live hit-test activity without a devtools connection.
      if (framesSinceReady % 60 === 0 && hintEl) {
        hintEl.textContent = results.length > 0
          ? 'Surface found — tap to place'
          : `Scanning for a surface… (${framesWithHit}/${framesSinceReady} frames hit)`;
      }
    }

    renderer.render(scene, camera);
  } catch (err) {
    console.error('Advanced AR render error:', err);
    if (hintEl) hintEl.textContent = 'AR error: ' + err.message;
    if (renderer) renderer.setAnimationLoop(null);
  }
}

async function start({ onExit, onAddToCart }) {
  onExitCallback = onExit;

  canvas = document.getElementById('xr-canvas');
  overlayEl = document.getElementById('arOverlay');
  hintEl = document.getElementById('arHint');
  exitBtn = document.getElementById('arExitBtn');
  cartBtn = document.getElementById('arAddToCartBtn');

  overlayEl.hidden = false;
  hintEl.textContent = 'Move your phone slowly to find a surface, then tap to place.';
  cartBtn.hidden = true;

  setupScene();

  renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(canvas.clientWidth, canvas.clientHeight);
  renderer.xr.enabled = true;
  // Without this, the renderer clears each frame to opaque black and paints
  // straight over the camera passthrough — the classic "AR shows a black
  // screen" bug. Alpha must be 0 so the camera feed shows through.
  renderer.setClearColor(0x000000, 0);

  camera = new THREE.PerspectiveCamera();

  // Three.js defaults to the 'local-floor' reference space, which is only
  // guaranteed on VR headsets. Handheld phone AR does not guarantee floor
  // tracking, so requesting it can throw "NotSupportedError: ... reference
  // space type is not supported by this device" and leave the session with
  // no working camera pose — which renders as a black screen even though
  // the AR session itself started fine. 'local' is the space guaranteed for
  // immersive-ar sessions, so use that instead.
  renderer.xr.setReferenceSpaceType('local');

  try {
    loadedGltfTemplate = await loadModel();
  } catch (err) {
    console.error('Failed to load AR model:', err);
    hintEl.textContent = 'Could not load the 3D model. Try again.';
    return;
  }

  controller = renderer.xr.getController(0);
  controller.addEventListener('select', placeModel);
  scene.add(controller);

  // During an immersive-ar session with dom-overlay, only elements inside
  // the overlay root receive real DOM touch events — the canvas itself
  // sits outside that root and never sees touchstart/touchmove/touchend,
  // even though it's visually on screen. Attach gestures to overlayEl
  // instead (see the matching pointer-events change in style.css).
  overlayEl.addEventListener('touchstart', onTouchStart, { passive: true });
  overlayEl.addEventListener('touchmove', onTouchMove, { passive: false });
  overlayEl.addEventListener('touchend', onTouchEnd, { passive: true });

  exitBtn.addEventListener(
    'click',
    () => {
      if (session) session.end();
    },
    { once: true }
  );

  cartBtn.addEventListener('click', () => {
    if (typeof onAddToCart === 'function') onAddToCart();
    cartBtn.textContent = 'Added ✓';
    setTimeout(() => {
      cartBtn.textContent = 'Add to cart';
    }, 1400);
  });

  try {
    session = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay'],
      domOverlay: { root: overlayEl },
    });
  } catch (err) {
    console.error('Failed to start AR session:', err);
    overlayEl.hidden = true;
    if (typeof onExit === 'function') onExit();
    return;
  }

  await renderer.xr.setSession(session);
  renderer.setAnimationLoop(render);
}

window.AdvancedAR = { isSupported, start };
