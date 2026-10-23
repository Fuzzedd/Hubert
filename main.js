import * as THREE from 'three';

// ====================== SETTINGS ======================
const MODEL_HEIGHT = 2.1;
const FOOT_OFFSET  = 0;
const FACE_OFFSET  = 0;
const WALK_SPEED   = 6;
const RUN_SPEED    = 10;
const JUMP_SPEED   = 12;
const GRAVITY      = 25;
const PLAYER_HALF_WIDTH = 0.4;
// ======================================================

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 60, 220);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 500);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

window.addEventListener('contextmenu', e => e.preventDefault());

// ---------- Lights ----------
scene.add(new THREE.HemisphereLight(0xffffff, 0x556655, 0.8));
const sun = new THREE.DirectionalLight(0xffffff, 1.4);
sun.position.set(40, 60, 25);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 200 });
scene.add(sun);
scene.add(sun.target);

// ---------- World Setup ----------
const colliders = [];

function addBox(x, y, z, w, h, d, color) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color, roughness: 0.6 })
  );
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  colliders.push(new THREE.Box3().setFromObject(mesh));
  return mesh;
}

// Baseplate
const BASE_SIZE = 300;
const baseTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#3fa34d'; g.fillRect(0, 0, 128, 128);
  g.strokeStyle = '#2f8a3c'; g.lineWidth = 4; g.strokeRect(0, 0, 128, 128);
  g.fillStyle = '#4dbb5c'; g.beginPath(); g.arc(64, 64, 26, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(BASE_SIZE / 2, BASE_SIZE / 2);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();

const base = new THREE.Mesh(
  new THREE.BoxGeometry(BASE_SIZE, 2, BASE_SIZE),
  [0x2f8a3c, 0x2f8a3c, new THREE.MeshStandardMaterial({ map: baseTex }), 0x2f8a3c, 0x2f8a3c, 0x2f8a3c]
    .map(m => (m instanceof THREE.Material ? m : new THREE.MeshStandardMaterial({ color: m })))
);
base.position.y = -1;
base.receiveShadow = true;
scene.add(base);
colliders.push(new THREE.Box3().setFromObject(base));

// Playground Obstacles
const colors = [0xe3000b, 0x0055bf, 0xfac80a, 0xf57c00, 0x9b59b6, 0x00a3a3];
for (let i = 0; i < 6; i++) { 
  const h = (i + 1) * 0.4; 
  addBox(8, h / 2, -6 - i * 2, 4, h, 2, colors[i % colors.length]); 
}
addBox(-8, 1.2, -8, 5, 0.8, 5, colors[0]);
addBox(-14, 2.2, -12, 4, 0.8, 4, colors[1]);
addBox(-20, 3.2, -8, 4, 0.8, 4, colors[2]);
addBox(-14, 4.2, -2, 4, 0.8, 4, colors[3]);
addBox(12, 0.8, 8, 2, 1.6, 2, colors[4]);
addBox(15, 1.2, 10, 3, 2.4, 3, colors[5]);
addBox(-6, 0.8, 12, 6, 1.6, 2, colors[1]);
addBox(0, 2.5, 25, 6, 5, 6, colors[3]);
addBox(0, 5.5, 25, 3, 1.5, 3, colors[2]);
addBox(25, 2, 0, 1, 4, 20, colors[0]);

// ---------- Player Setup ----------
const player = {
  pos: new THREE.Vector3(0, 0, 0),
  vel: new THREE.Vector3(),
  onGround: false,
  height: MODEL_HEIGHT,
  yaw: 0,
};

const playerGroup = new THREE.Group();
scene.add(playerGroup);

let fallbackParts = null;

function createRoundedBoxGeometry(width, height, depth, radius = 0.04, smoothness = 4) {
  const shape = new THREE.Shape();
  const w = width / 2 - radius;
  const h = height / 2 - radius;

  shape.moveTo(-w, -h - radius);
  shape.lineTo(w, -h - radius);
  shape.quadraticCurveTo(w + radius, -h - radius, w + radius, -h);
  shape.lineTo(w + radius, h);
  shape.quadraticCurveTo(w + radius, h + radius, w, h + radius);
  shape.lineTo(-w, h + radius);
  shape.quadraticCurveTo(-w - radius, h + radius, -w - radius, h);
  shape.lineTo(-w - radius, -h);
  shape.quadraticCurveTo(-w - radius, -h - radius, -w, -h - radius);

  const extrudeSettings = {
    depth: depth - radius * 2,
    bevelEnabled: true,
    bevelSegments: smoothness,
    steps: 1,
    bevelSize: radius,
    bevelThickness: radius,
    curveSegments: smoothness
  };

  const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
  geometry.center();
  return geometry;
}

function setupModel(object) {
  playerGroup.add(object);
  object.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });

  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object, true);
  const size = box.getSize(new THREE.Vector3());
  object.scale.multiplyScalar(MODEL_HEIGHT / size.y);
  object.updateMatrixWorld(true);

  const box2 = new THREE.Box3().setFromObject(object, true);
  const center = box2.getCenter(new THREE.Vector3());
  object.position.x -= center.x;
  object.position.z -= center.z;
  object.position.y -= box2.min.y - FOOT_OFFSET;
}

function buildCharacter() {
  const g = new THREE.Group();
  const mat = color => new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.05 });

  const headMat = mat(0xffffff);
  const torsoMat = mat(0x111111);
  const armsMat = mat(0xffffff);
  const legsMat = mat(0xffffff);

  const legGeo = createRoundedBoxGeometry(0.34, 0.8, 0.34, 0.04, 4);
  legGeo.translate(0, -0.4, 0);

  const legL = new THREE.Mesh(legGeo, legsMat);
  legL.position.set(-0.17, 0.8, 0);
  g.add(legL);

  const legR = new THREE.Mesh(legGeo, legsMat);
  legR.position.set(0.17, 0.8, 0);
  g.add(legR);

  const torsoGeo = createRoundedBoxGeometry(0.68, 0.75, 0.38, 0.05, 4);
  const torso = new THREE.Mesh(torsoGeo, torsoMat);
  torso.position.set(0, 1.22, 0);
  g.add(torso);

  const armGeo = createRoundedBoxGeometry(0.28, 0.7, 0.28, 0.04, 4);
  armGeo.translate(0, -0.35, 0);

  const armL = new THREE.Mesh(armGeo, armsMat);
  armL.position.set(-0.46, 1.5, 0);
  g.add(armL);

  const armR = new THREE.Mesh(armGeo, armsMat);
  armR.position.set(0.46, 1.5, 0);
  g.add(armR);

  const headGeo = createRoundedBoxGeometry(0.46, 0.46, 0.46, 0.08, 4);
  const head = new THREE.Mesh(headGeo, headMat);
  head.position.set(0, 1.82, 0);
  g.add(head);

  const textureLoader = new THREE.TextureLoader();
  const faceTexture = textureLoader.load('./face11.png', undefined, undefined, () => {});
  faceTexture.colorSpace = THREE.SRGBColorSpace;

  const faceMat = new THREE.MeshBasicMaterial({ map: faceTexture, transparent: true, alphaTest: 0.05 });
  const facePlane = new THREE.Mesh(new THREE.PlaneGeometry(0.38, 0.38), faceMat);
  facePlane.position.set(0, 1.82, 0.236);
  g.add(facePlane);

  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  fallbackParts = { legL, legR, armL, armR };
  setupModel(g);
}

buildCharacter();

// ====================== 3D CHAT BUBBLES ======================
const speechBubbles = [];

function createSpeechBubble(text) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  
  canvas.width = 512;
  canvas.height = 128;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
  ctx.beginPath();
  ctx.roundRect(10, 10, 492, 108, 20);
  ctx.fill();

  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 4;
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 36px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const truncated = text.length > 25 ? text.substring(0, 25) + '...' : text;
  ctx.fillText(truncated, 256, 64);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const spriteMat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(spriteMat);
  sprite.scale.set(3.5, 0.875, 1);
  
  return sprite;
}

function showBubbleForPlayer(parentGroup, text) {
  const existing = parentGroup.children.find(c => c.isSprite);
  if (existing) parentGroup.remove(existing);

  const bubble = createSpeechBubble(text);
  bubble.position.set(0, MODEL_HEIGHT + 0.6, 0);
  parentGroup.add(bubble);

  speechBubbles.push({ sprite: bubble, parent: parentGroup, expires: Date.now() + 5000 });
}

// ====================== MULTIPLAYER & CHAT LOGIC ======================
const remotePlayers = {};
const connections = {};
const localPeerId = 'player_' + Math.floor(Math.random() * 10000);
const shortName = 'Player #' + localPeerId.slice(-4);

const chatMessagesDiv = document.getElementById('chat-messages');
const chatInputBox = document.getElementById('chat-input-box');

let isChatFocused = false;

chatInputBox.addEventListener('focus', () => { isChatFocused = true; });
chatInputBox.addEventListener('blur', () => { isChatFocused = false; });

function addChatMessageToHUD(sender, text) {
  const msgEl = document.createElement('div');
  msgEl.className = 'chat-msg';
  msgEl.innerHTML = `<span class="sender">${sender}:</span> ${escapeHTML(text)}`;
  chatMessagesDiv.appendChild(msgEl);
  chatMessagesDiv.scrollTop = chatMessagesDiv.scrollHeight;
}

function escapeHTML(str) {
  return str.replace(/[&<>'"]/g, 
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag));
}

function sendChatMessage(text) {
  if (!text.trim()) return;

  addChatMessageToHUD(shortName, text);
  showBubbleForPlayer(playerGroup, text);

  const chatPacket = {
    type: 'chat',
    id: peer ? peer.id : localPeerId,
    sender: shortName,
    text: text
  };

  // Send via PeerJS
  Object.values(connections).forEach(conn => {
    if (conn.open) conn.send(chatPacket);
  });

  // Send via BroadcastChannel (multi-tab testing)
  bc.postMessage(chatPacket);

  chatInputBox.value = '';
}

// Multi-tab sync via BroadcastChannel
const bc = new BroadcastChannel('hubert_game_room');
bc.onmessage = (event) => {
  const data = event.data;
  if (data.id === (peer ? peer.id : localPeerId)) return;

  if (data.type === 'chat') {
    addChatMessageToHUD(data.sender, data.text);
    if (remotePlayers[data.id]) {
      showBubbleForPlayer(remotePlayers[data.id].parts.group, data.text);
    }
  } else {
    updateRemotePlayer(data);
  }
};

// PeerJS setup
const peer = new Peer('hubert_room_' + Math.floor(Math.random() * 1000000));

peer.on('open', (id) => {
  connectToPeer('hubert_room_main_lobby');
});

peer.on('connection', (conn) => {
  setupConnection(conn);
});

function connectToPeer(targetId) {
  if (targetId === peer.id || connections[targetId]) return;
  const conn = peer.connect(targetId);
  setupConnection(conn);
}

function setupConnection(conn) {
  conn.on('open', () => { connections[conn.peer] = conn; });
  conn.on('data', (data) => {
    if (data.type === 'chat') {
      addChatMessageToHUD(data.sender, data.text);
      if (remotePlayers[data.id]) {
        showBubbleForPlayer(remotePlayers[data.id].parts.group, data.text);
      }
    } else {
      updateRemotePlayer(data);
    }
  });
  conn.on('close', () => {
    if (remotePlayers[conn.peer]) {
      scene.remove(remotePlayers[conn.peer].parts.group);
      delete remotePlayers[conn.peer];
    }
    delete connections[conn.peer];
  });
}

function createRemotePlayerMesh() {
  const g = new THREE.Group();
  const mat = c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.35, metalness: 0.05 });

  const legGeo = createRoundedBoxGeometry(0.34, 0.8, 0.34, 0.04, 2);
  legGeo.translate(0, -0.4, 0);
  const torsoGeo = createRoundedBoxGeometry(0.68, 0.75, 0.38, 0.05, 2);
  const armGeo = createRoundedBoxGeometry(0.28, 0.7, 0.28, 0.04, 2);
  armGeo.translate(0, -0.35, 0);
  const headGeo = createRoundedBoxGeometry(0.46, 0.46, 0.46, 0.08, 2);

  const whiteMat = mat(0xffffff);
  const blackMat = mat(0x111111);

  const legL = new THREE.Mesh(legGeo, whiteMat); legL.position.set(-0.17, 0.8, 0);
  const legR = new THREE.Mesh(legGeo, whiteMat); legR.position.set(0.17, 0.8, 0);
  const torso = new THREE.Mesh(torsoGeo, blackMat); torso.position.set(0, 1.22, 0);
  const armL = new THREE.Mesh(armGeo, whiteMat); armL.position.set(-0.46, 1.5, 0);
  const armR = new THREE.Mesh(armGeo, whiteMat); armR.position.set(0.46, 1.5, 0);
  const head = new THREE.Mesh(headGeo, whiteMat); head.position.set(0, 1.82, 0);

  const textureLoader = new THREE.TextureLoader();
  const faceTexture = textureLoader.load('./face11.png');
  faceTexture.colorSpace = THREE.SRGBColorSpace;
  const faceMat = new THREE.MeshBasicMaterial({ map: faceTexture, transparent: true, alphaTest: 0.05 });
  const facePlane = new THREE.Mesh(new THREE.PlaneGeometry(0.38, 0.38), faceMat);
  facePlane.position.set(0, 1.82, 0.236);

  g.add(legL, legR, torso, armL, armR, head, facePlane);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  scene.add(g);
  return { group: g, legL, legR, armL, armR };
}

function updateRemotePlayer(data) {
  if (!remotePlayers[data.id]) {
    remotePlayers[data.id] = {
      parts: createRemotePlayerMesh(),
      lastSeen: Date.now()
    };
  }

  const p = remotePlayers[data.id];
  p.parts.group.position.set(data.x, data.y, data.z);
  p.parts.group.rotation.y = data.yaw;
  p.lastSeen = Date.now();

  if (data.moving) {
    const time = performance.now() * 0.008;
    p.parts.legL.rotation.x = Math.sin(time) * 0.7;
    p.parts.legR.rotation.x = -Math.sin(time) * 0.7;
    p.parts.armL.rotation.x = -Math.sin(time) * 0.7;
    p.parts.armR.rotation.x = Math.sin(time) * 0.7;
  } else {
    p.parts.legL.rotation.x = p.parts.legR.rotation.x = 0;
    p.parts.armL.rotation.x = p.parts.armR.rotation.x = 0;
  }
}

function sendMovement(isMoving) {
  const packet = {
    type: 'move',
    id: peer ? peer.id : localPeerId,
    x: player.pos.x,
    y: player.pos.y,
    z: player.pos.z,
    yaw: player.yaw,
    moving: isMoving
  };

  Object.values(connections).forEach(conn => {
    if (conn.open) conn.send(packet);
  });
  bc.postMessage(packet);
}

// ---------- Controls & Camera ----------
const keys = {};
window.addEventListener('keydown', e => {
  if (e.code === 'Enter') {
    if (document.activeElement === chatInputBox) {
      sendChatMessage(chatInputBox.value);
      chatInputBox.blur();
    } else {
      chatInputBox.focus();
    }
    return;
  }

  if (e.code === 'Escape' && document.activeElement === chatInputBox) {
    chatInputBox.blur();
    return;
  }

  if (!isChatFocused) {
    keys[e.code] = true;
    if (e.code === 'Space') e.preventDefault();
  }
});

window.addEventListener('keyup', e => {
  if (!isChatFocused) keys[e.code] = false;
});

let isRightMouseDown = false;
let camYaw = 0, camPitch = 0.35, camDist = 7;

window.addEventListener('mousedown', e => { if (e.button === 2) isRightMouseDown = true; });
window.addEventListener('mouseup', e => { if (e.button === 2) isRightMouseDown = false; });
window.addEventListener('mousemove', e => {
  if (!isRightMouseDown) return;
  camYaw -= e.movementX * 0.0035;
  camPitch += e.movementY * 0.0035;
  camPitch = Math.max(-0.4, Math.min(1.35, camPitch));
});
window.addEventListener('wheel', e => {
  camDist = Math.max(2.5, Math.min(18, camDist + Math.sign(e.deltaY) * 0.6));
});
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- Collision Logic ----------
const EPS = 0.001;
function overlaps(b) {
  const x0 = player.pos.x - PLAYER_HALF_WIDTH, x1 = player.pos.x + PLAYER_HALF_WIDTH;
  const z0 = player.pos.z - PLAYER_HALF_WIDTH, z1 = player.pos.z + PLAYER_HALF_WIDTH;
  const y0 = player.pos.y,                      y1 = player.pos.y + player.height;
  return x0 < b.max.x && x1 > b.min.x && y0 < b.max.y && y1 > b.min.y && z0 < b.max.z && z1 > b.min.z;
}

function resolve(axis) {
  for (const b of colliders) {
    if (!overlaps(b)) continue;
    if (axis === 'x') {
      const dir = player.vel.x !== 0 ? player.vel.x > 0 : player.pos.x < (b.min.x + b.max.x) / 2;
      player.pos.x = dir ? b.min.x - PLAYER_HALF_WIDTH - EPS : b.max.x + PLAYER_HALF_WIDTH + EPS;
      player.vel.x = 0;
    } else if (axis === 'z') {
      const dir = player.vel.z !== 0 ? player.vel.z > 0 : player.pos.z < (b.min.z + b.max.z) / 2;
      player.pos.z = dir ? b.min.z - PLAYER_HALF_WIDTH - EPS : b.max.z + PLAYER_HALF_WIDTH + EPS;
      player.vel.z = 0;
    } else {
      if (player.vel.y > 0) { player.pos.y = b.min.y - player.height - EPS; }
      else { player.pos.y = b.max.y; player.onGround = true; }
      player.vel.y = 0;
    }
  }
}

// ---------- Main Game Loop ----------
const clock = new THREE.Clock();
const moveDir = new THREE.Vector3();

function update(dt) {
  if (isChatFocused) {
    Object.keys(keys).forEach(k => keys[k] = false);
  }

  const fwd = new THREE.Vector3(-Math.sin(camYaw), 0, -Math.cos(camYaw));
  const right = new THREE.Vector3(Math.cos(camYaw), 0, -Math.sin(camYaw));
  moveDir.set(0, 0, 0);

  if (!isChatFocused) {
    if (keys['KeyW'] || keys['ArrowUp'])    moveDir.add(fwd);
    if (keys['KeyS'] || keys['ArrowDown'])  moveDir.sub(fwd);
    if (keys['KeyD'] || keys['ArrowRight']) moveDir.add(right);
    if (keys['KeyA'] || keys['ArrowLeft'])  moveDir.sub(right);
  }

  const moving = moveDir.lengthSq() > 0;
  if (moving) moveDir.normalize();

  const speed = (keys['ShiftLeft'] || keys['ShiftRight']) ? RUN_SPEED : WALK_SPEED;
  player.vel.x = moveDir.x * speed;
  player.vel.z = moveDir.z * speed;

  if (keys['Space'] && player.onGround && !isChatFocused) {
    player.vel.y = JUMP_SPEED;
    player.onGround = false;
  }
  player.vel.y = Math.max(player.vel.y - GRAVITY * dt, -40);

  player.onGround = false;
  player.pos.x += player.vel.x * dt; resolve('x');
  player.pos.z += player.vel.z * dt; resolve('z');
  player.pos.y += player.vel.y * dt; resolve('y');

  if (player.pos.y < -40) { player.pos.set(0, 2, 0); player.vel.set(0, 0, 0); }

  if (moving) {
    const target = Math.atan2(moveDir.x, moveDir.z) + FACE_OFFSET;
    let diff = target - player.yaw;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    player.yaw += diff * Math.min(1, dt * 14);
  }

  playerGroup.position.copy(player.pos);
  playerGroup.rotation.y = player.yaw;

  if (fallbackParts) {
    const time = performance.now() * 0.001;
    if (player.onGround) {
      const animSpeed = moving ? (speed / WALK_SPEED) * 10 : 2;
      const swing = moving ? Math.sin(time * animSpeed) * 0.7 : 0;
      fallbackParts.legL.rotation.x = swing;
      fallbackParts.legR.rotation.x = -swing;
      fallbackParts.armL.rotation.x = -swing;
      fallbackParts.armR.rotation.x = swing;
    } else {
      fallbackParts.armL.rotation.x = -Math.PI * 0.6 + Math.sin(time * 15) * 0.15;
      fallbackParts.armR.rotation.x = -Math.PI * 0.6 - Math.sin(time * 15) * 0.15;
      fallbackParts.legL.rotation.x = 0.4;
      fallbackParts.legR.rotation.x = -0.4;
    }
  }

  const target = new THREE.Vector3(player.pos.x, player.pos.y + player.height * 0.85, player.pos.z);
  camera.position.set(
    target.x + Math.sin(camYaw) * Math.cos(camPitch) * camDist,
    target.y + Math.sin(camPitch) * camDist,
    target.z + Math.cos(camYaw) * Math.cos(camPitch) * camDist
  );
  camera.position.y = Math.max(camera.position.y, 0.3);
  camera.lookAt(target);

  sun.position.set(player.pos.x + 40, 60, player.pos.z + 25);
  sun.target.position.copy(player.pos);

  // Expire speech bubbles after 5 seconds
  const now = Date.now();
  for (let i = speechBubbles.length - 1; i >= 0; i--) {
    if (now > speechBubbles[i].expires) {
      speechBubbles[i].parent.remove(speechBubbles[i].sprite);
      speechBubbles.splice(i, 1);
    }
  }

  sendMovement(moving);
}

function loop() {
  requestAnimationFrame(loop);
  update(Math.min(clock.getDelta(), 1 / 30));
  renderer.render(scene, camera);
}

loop();