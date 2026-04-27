import * as THREE from 'three'
import './styles.css'

const app = document.getElementById('app')

const LANE_X = [-2.35, 0, 2.35]
const TRACK_LENGTH = 20
const TRACK_COUNT = 12
const PLAYER_Z = 0
const BASE_SPEED = 14
const MAX_SPEED = 33
const ROAD_HALF_WIDTH = 4.1
const STORAGE_KEY = 'code-instant-runner-best'

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x08111d)
scene.fog = new THREE.Fog(0x08111d, 18, 120)

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 220)
camera.position.set(0, 4.5, 10)

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.1
renderer.domElement.style.touchAction = 'none'
app.appendChild(renderer.domElement)

const ambient = new THREE.HemisphereLight(0xb6ddff, 0x0b1020, 2.2)
scene.add(ambient)

const sun = new THREE.DirectionalLight(0xffffff, 2.5)
sun.position.set(-4, 10, 8)
sun.castShadow = true
sun.shadow.mapSize.set(2048, 2048)
sun.shadow.camera.near = 0.5
sun.shadow.camera.far = 40
sun.shadow.camera.left = -18
sun.shadow.camera.right = 18
sun.shadow.camera.top = 18
sun.shadow.camera.bottom = -18
scene.add(sun)

const fill = new THREE.DirectionalLight(0x7fe0ff, 1.3)
fill.position.set(5, 4, 6)
scene.add(fill)

const world = new THREE.Group()
scene.add(world)

const stars = createStars()
scene.add(stars)

const roadTexture = makeRoadTexture()
roadTexture.wrapS = THREE.RepeatWrapping
roadTexture.wrapT = THREE.RepeatWrapping
roadTexture.repeat.set(1, 1)

const player = createPlayer()
scene.add(player.group)

const trackSegments = []
for (let i = 0; i < TRACK_COUNT; i++) {
  const seg = createTrackSegment(i * TRACK_LENGTH)
  trackSegments.push(seg)
  scene.add(seg)
}

const obstacles = []
const coins = []
const powerups = []

const hud = document.createElement('div')
hud.className = 'hud'
hud.innerHTML = `
  <div class="topbar">
    <div class="row">
      <div class="chip"><b>score</b><span id="score">0</span></div>
      <div class="chip"><b>coins</b><span id="coins">0</span></div>
      <div class="chip"><b>best</b><span id="best">0</span></div>
      <div class="chip"><b>speed</b><span id="speed">0</span></div>
    </div>
    <div class="chip"><b>power</b><span id="power">none</span></div>
  </div>
  <div class="panel centerOverlay" id="overlay"></div>
  <div class="bottomHint" id="hint">Swipe or use arrow keys. Up to jump, down to slide.</div>
  <div class="mobileControls" aria-hidden="true">
    <button id="leftBtn" type="button">◀</button>
    <button id="jumpBtn" type="button">⬆</button>
    <button id="rightBtn" type="button">▶</button>
  </div>
  <div class="flash" id="flash"></div>
`
document.body.appendChild(hud)

const scoreEl = hud.querySelector('#score')
const coinsEl = hud.querySelector('#coins')
const bestEl = hud.querySelector('#best')
const speedEl = hud.querySelector('#speed')
const powerEl = hud.querySelector('#power')
const overlayEl = hud.querySelector('#overlay')
const flashEl = hud.querySelector('#flash')
const hintEl = hud.querySelector('#hint')

const bestScoreStored = Number(localStorage.getItem(STORAGE_KEY) ?? 0) || 0
const game = {
  mode: 'ready',
  score: 0,
  coins: 0,
  best: bestScoreStored,
  speed: BASE_SPEED,
  runDistance: 0,
  lane: 1,
  laneX: 0,
  targetLaneX: 0,
  y: 0,
  vy: 0,
  grounded: true,
  slideTimer: 0,
  shieldTimer: 0,
  magnetTimer: 0,
  spawnTimer: 0,
  nextSpawnDelay: 1,
  nextPowerDelay: 9,
  shake: 0,
}

bestEl.textContent = String(game.best)
setOverlay('ready')

const input = {
  startX: 0,
  startY: 0,
  active: false,
}

const clock = new THREE.Clock()
let raf = 0
requestAnimationFrame(loop)
bindInputs()
window.addEventListener('resize', onResize)
onResize()

function loop() {
  raf = requestAnimationFrame(loop)
  const dt = Math.min(clock.getDelta(), 0.033)
  update(dt)
  renderer.render(scene, camera)
}

function update(dt) {
  animateStars(dt)
  updateCamera(dt)
  updatePlayer(dt)

  if (game.mode === 'running') {
    game.runDistance += game.speed * dt
    game.score = Math.floor(game.runDistance * 8 + game.coins * 120)
    game.speed = Math.min(MAX_SPEED, BASE_SPEED + game.runDistance * 0.05)
    game.spawnTimer += dt
    game.nextPowerDelay -= dt

    if (game.spawnTimer >= game.nextSpawnDelay) {
      game.spawnTimer = 0
      game.nextSpawnDelay = randomRange(0.7, 1.28)
      spawnChallenge()
    }

    if (game.nextPowerDelay <= 0) {
      game.nextPowerDelay = randomRange(11, 18)
      spawnPowerup()
    }

    moveTrack(dt)
    updateHazards(dt)
    updateCoins(dt)
    updatePowerups(dt)
    updatePickups()
    checkCollisions()

    if (game.shieldTimer > 0) game.shieldTimer = Math.max(0, game.shieldTimer - dt)
    if (game.magnetTimer > 0) game.magnetTimer = Math.max(0, game.magnetTimer - dt)
    if (game.slideTimer > 0) game.slideTimer = Math.max(0, game.slideTimer - dt)

    if (game.shake > 0) {
      game.shake = Math.max(0, game.shake - dt * 2)
      camera.position.x += (Math.random() - 0.5) * game.shake * 0.08
      camera.position.y += (Math.random() - 0.5) * game.shake * 0.05
    }
  }

  updateHUD()
}

function updateCamera(dt) {
  const targetX = THREE.MathUtils.lerp(camera.position.x, player.group.position.x * 0.28, 0.08)
  const targetY = THREE.MathUtils.lerp(camera.position.y, 4.5 + Math.min(0.35, player.jumpBob), 0.05)
  camera.position.x = targetX
  camera.position.y = targetY
  camera.lookAt(player.group.position.x * 0.22, 1.45 + player.jumpBob * 0.2, -10)

  sun.position.x = camera.position.x - 4
  sun.position.z = camera.position.z - 2
}

function updatePlayer(dt) {
  const targetX = LANE_X[game.lane]
  game.laneX = THREE.MathUtils.lerp(game.laneX, targetX, 1 - Math.pow(0.001, dt))
  player.group.position.x = game.laneX

  if (game.mode === 'running') {
    if (!game.grounded) {
      game.vy -= 19.5 * dt
      game.y += game.vy * dt
      if (game.y <= 0) {
        game.y = 0
        game.vy = 0
        game.grounded = true
      }
    }
  }

  const slide = game.slideTimer > 0
  const bob = game.grounded ? Math.sin(performance.now() * 0.01) * 0.03 : game.y * 0.05
  player.jumpBob = bob
  player.group.position.y = 0.85 + game.y - (slide ? 0.18 : 0)
  player.group.rotation.z = THREE.MathUtils.lerp(player.group.rotation.z, (game.laneX - player.group.position.x) * -0.03, 0.08)
  player.group.rotation.x = THREE.MathUtils.lerp(player.group.rotation.x, slide ? 0.12 : -0.04, 0.08)

  const runningPhase = performance.now() * 0.018 * (0.8 + game.speed / MAX_SPEED)
  const sway = Math.sin(runningPhase) * 0.45
  player.leftLeg.rotation.x = sway
  player.rightLeg.rotation.x = -sway
  player.leftArm.rotation.x = -sway * 0.85
  player.rightArm.rotation.x = sway * 0.85
  player.body.rotation.y = Math.sin(runningPhase * 0.5) * 0.07

  if (slide) {
    player.body.scale.y = 0.72
    player.strap.scale.y = 0.75
    player.goggles.position.y = 0.82
    player.legs.visible = false
    player.leftArm.position.y = 0.42
    player.rightArm.position.y = 0.42
  } else {
    player.body.scale.y = 1
    player.strap.scale.y = 1
    player.goggles.position.y = 1.12
    player.legs.visible = true
    player.leftArm.position.y = 0.72
    player.rightArm.position.y = 0.72
  }

  player.legs.rotation.y = player.body.rotation.y * 0.3
  player.goggles.rotation.y = player.body.rotation.y * 0.2
}

function moveTrack(dt) {
  const dz = game.speed * dt
  for (const seg of trackSegments) {
    seg.position.z -= dz
  }
  let furthest = -Infinity
  for (const seg of trackSegments) furthest = Math.max(furthest, seg.position.z)
  for (const seg of trackSegments) {
    if (seg.position.z < -TRACK_LENGTH * 2) {
      seg.position.z = furthest + TRACK_LENGTH
      furthest = seg.position.z
    }
  }
}

function updateHazards(dt) {
  const dz = game.speed * dt
  for (let i = obstacles.length - 1; i >= 0; i--) {
    const o = obstacles[i]
    o.group.position.z -= dz
    o.group.rotation.y += dt * 0.8
    if (o.group.position.z < -20) {
      scene.remove(o.group)
      obstacles.splice(i, 1)
    }
  }
}

function updateCoins(dt) {
  const dz = game.speed * dt
  for (let i = coins.length - 1; i >= 0; i--) {
    const c = coins[i]
    c.group.position.z -= dz
    c.group.rotation.y += dt * 3.8
    c.group.rotation.z += dt * 1.7
    c.group.position.y = c.baseY + Math.sin((performance.now() * 0.007) + c.phase) * 0.08
    if (c.group.position.z < -20) {
      scene.remove(c.group)
      coins.splice(i, 1)
    }
  }
}

function updatePowerups(dt) {
  const dz = game.speed * dt
  for (let i = powerups.length - 1; i >= 0; i--) {
    const p = powerups[i]
    p.group.position.z -= dz
    p.group.rotation.y += dt * 1.3
    p.group.position.y = p.baseY + Math.sin(performance.now() * 0.005 + p.phase) * 0.14
    if (p.group.position.z < -20) {
      scene.remove(p.group)
      powerups.splice(i, 1)
    }
  }
}

function updatePickups() {
  const playerBox = getPlayerBox()

  for (let i = coins.length - 1; i >= 0; i--) {
    const coin = coins[i]
    const box = new THREE.Box3().setFromObject(coin.group)
    if (playerBox.intersectsBox(box) || (game.magnetTimer > 0 && Math.abs(coin.group.position.x - player.group.position.x) < 2.5 && Math.abs(coin.group.position.z) < 8)) {
      game.coins += 1
      game.score += 80
      pulseFlash('rgba(255, 217, 77, 0.35)')
      scene.remove(coin.group)
      coins.splice(i, 1)
    }
  }

  for (let i = powerups.length - 1; i >= 0; i--) {
    const p = powerups[i]
    const box = new THREE.Box3().setFromObject(p.group)
    if (playerBox.intersectsBox(box)) {
      if (p.kind === 'shield') {
        game.shieldTimer = 9
      } else if (p.kind === 'magnet') {
        game.magnetTimer = 8
      }
      pulseFlash(p.kind === 'shield' ? 'rgba(120, 222, 255, 0.28)' : 'rgba(158, 255, 143, 0.22)')
      scene.remove(p.group)
      powerups.splice(i, 1)
    }
  }
}

function checkCollisions() {
  const playerBox = getPlayerBox()

  for (let i = obstacles.length - 1; i >= 0; i--) {
    const obstacle = obstacles[i]
    const box = getObstacleBox(obstacle)
    if (!playerBox.intersectsBox(box)) continue

    if (game.shieldTimer > 0) {
      game.shieldTimer = 0
      game.shake = 1
      pulseFlash('rgba(127, 224, 255, 0.42)')
      scene.remove(obstacle.group)
      obstacles.splice(i, 1)
      continue
    }

    endRun()
    return
  }
}

function spawnChallenge() {
  const pattern = Math.floor(Math.random() * 6)
  const lane = Math.floor(Math.random() * 3)
  const z = 85 + Math.random() * 18

  if (pattern === 0) {
    spawnObstacle('crate', lane, z)
    spawnCoinsLine(lane, z + 4, 4, 0.45)
  } else if (pattern === 1) {
    spawnObstacle('barrier', lane, z)
    spawnCoinsArc(lane, z + 1, 5)
  } else if (pattern === 2) {
    spawnObstacle('arch', lane, z)
    spawnCoinsLine(lane, z + 2, 3, 0.2)
  } else if (pattern === 3) {
    const other = (lane + 1 + Math.floor(Math.random() * 2)) % 3
    spawnObstacle('crate', lane, z)
    spawnObstacle('crate', other, z + 5)
    spawnCoinsLine(1, z + 2, 3, 0.5)
  } else if (pattern === 4) {
    spawnObstacle('drone', lane, z)
    spawnCoinsArc(lane, z + 2, 5)
  } else {
    const p1 = lane
    const p2 = (lane + 2) % 3
    spawnObstacle('barrier', p1, z)
    spawnObstacle('arch', p2, z + 7)
    spawnCoinsLine((lane + 1) % 3, z + 3, 4, 0.45)
  }
}

function spawnObstacle(kind, lane, z) {
  const group = new THREE.Group()
  group.position.set(LANE_X[lane], 0, z)

  const mat = materials.obstacle.clone()
  const accent = materials.obstacleAccent.clone()
  let height = 1.2

  if (kind === 'crate') {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.25, 1.25, 1.25), mat)
    mesh.castShadow = true
    mesh.receiveShadow = true
    group.add(mesh)
    const band = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.16, 1.3), accent)
    band.position.y = 0.1
    band.castShadow = true
    group.add(band)
    height = 1.25
    group.position.y = 0.62
  } else if (kind === 'barrier') {
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.84, 1.08), mat)
    base.position.y = 0.42
    base.castShadow = true
    base.receiveShadow = true
    group.add(base)
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.18, 1.12), accent)
    stripe.position.y = 0.78
    stripe.castShadow = true
    group.add(stripe)
    height = 0.84
    group.position.y = 0
  } else if (kind === 'arch') {
    const left = new THREE.Mesh(new THREE.BoxGeometry(0.36, 1.35, 0.38), mat)
    left.position.set(-0.68, 0.68, 0)
    const right = left.clone()
    right.position.x = 0.68
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.28, 0.55), accent)
    top.position.y = 1.34
    top.castShadow = true
    left.castShadow = right.castShadow = true
    group.add(left, right, top)
    height = 1.62
    group.position.y = 0
  } else if (kind === 'drone') {
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.48, 18, 18), materials.drone)
    body.castShadow = true
    body.receiveShadow = true
    group.add(body)
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.1, 10, 20), materials.droneRing)
    ring.rotation.x = Math.PI / 2
    ring.castShadow = true
    group.add(ring)
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.12, 14, 14), materials.eye)
    eye.position.set(0, 0.05, 0.42)
    group.add(eye)
    height = 1.0
    group.position.y = 2.1
  }

  scene.add(group)
  obstacles.push({ kind, group, height, hitBox: getObstacleHitBox(kind) })
}

function spawnCoinsLine(lane, z, count = 5, yOffset = 0.35) {
  for (let i = 0; i < count; i++) {
    const coin = createCoin(LANE_X[lane], 1.15 + Math.sin(i * 0.45) * yOffset, z + i * 1.2)
    coins.push(coin)
    scene.add(coin.group)
  }
}

function spawnCoinsArc(lane, z, count = 5) {
  for (let i = 0; i < count; i++) {
    const offset = i - (count - 1) / 2
    const coin = createCoin(LANE_X[lane] + offset * 0.25, 1.0 + Math.sin((i / (count - 1)) * Math.PI) * 1.0, z + i * 1.05)
    coins.push(coin)
    scene.add(coin.group)
  }
}

function spawnPowerup() {
  const kind = Math.random() < 0.55 ? 'shield' : 'magnet'
  const lane = Math.floor(Math.random() * 3)
  const group = new THREE.Group()
  group.position.set(LANE_X[lane], kind === 'shield' ? 1.05 : 1.1, 96)

  const outer = new THREE.Mesh(
    new THREE.TetrahedronGeometry(0.56, 0),
    kind === 'shield' ? materials.shield : materials.magnet,
  )
  outer.castShadow = true
  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(0.33, 16, 16),
    kind === 'shield' ? materials.shieldCore : materials.magnetCore,
  )
  glow.castShadow = true
  group.add(outer, glow)
  scene.add(group)
  powerups.push({ kind, group, baseY: group.position.y, phase: Math.random() * Math.PI * 2 })
}

function createCoin(x, y, z) {
  const group = new THREE.Group()
  group.position.set(x, y, z)
  const coin = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.13, 10, 20), materials.coin)
  coin.rotation.x = Math.PI / 2
  coin.castShadow = true
  coin.receiveShadow = true
  group.add(coin)
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 12), materials.coinCore)
  core.castShadow = true
  group.add(core)
  return { group, baseY: y, phase: Math.random() * Math.PI * 2 }
}

function createPlayer() {
  const group = new THREE.Group()
  group.position.set(0, 0.85, 0)

  const bodyMat = materials.player
  const suitMat = materials.suit
  const darkMat = materials.dark
  const eyeMat = materials.eye
  const metalMat = materials.metal

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.66, 0.92, 6, 12), bodyMat)
  body.castShadow = true
  body.receiveShadow = true
  body.position.y = 0.92
  group.add(body)

  const suit = new THREE.Mesh(new THREE.BoxGeometry(1.12, 0.68, 0.72), suitMat)
  suit.position.set(0, 0.46, 0)
  suit.castShadow = true
  suit.receiveShadow = true
  group.add(suit)

  const strap = new THREE.Mesh(new THREE.BoxGeometry(1.26, 0.12, 0.86), darkMat)
  strap.position.set(0, 1.04, 0)
  group.add(strap)

  const goggles = new THREE.Group()
  goggles.position.set(0, 1.12, 0.1)
  const ring1 = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.09, 8, 16), metalMat)
  ring1.position.x = -0.18
  ring1.rotation.x = Math.PI / 2
  const ring2 = ring1.clone()
  ring2.position.x = 0.18
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.06, 0.08), darkMat)
  bridge.position.z = 0.02
  goggles.add(ring1, ring2, bridge)
  group.add(goggles)

  const eye1 = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 12), eyeMat)
  eye1.position.set(-0.18, 0, 0.18)
  const eye2 = eye1.clone()
  eye2.position.x = 0.18
  goggles.add(eye1, eye2)

  const leftArm = makeLimb(0.12, 0.72, 0.12, bodyMat)
  leftArm.position.set(-0.74, 0.78, 0)
  leftArm.rotation.z = 0.34
  const rightArm = makeLimb(0.12, 0.72, 0.12, bodyMat)
  rightArm.position.set(0.74, 0.78, 0)
  rightArm.rotation.z = -0.34

  const leftLeg = makeLimb(0.14, 0.7, 0.14, suitMat)
  leftLeg.position.set(-0.24, 0.05, 0)
  leftLeg.rotation.z = 0.08
  const rightLeg = makeLimb(0.14, 0.7, 0.14, suitMat)
  rightLeg.position.set(0.24, 0.05, 0)
  rightLeg.rotation.z = -0.08

  const shoeMat = new THREE.MeshStandardMaterial({ color: 0x1d2c46, roughness: 0.9, metalness: 0.1 })
  const leftShoe = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.12, 0.42), shoeMat)
  leftShoe.position.set(0, -0.38, 0.04)
  leftLeg.add(leftShoe)
  const rightShoe = leftShoe.clone()
  rightShoe.position.z = -0.04
  rightLeg.add(rightShoe)

  const legs = new THREE.Group()
  legs.add(leftLeg, rightLeg)
  group.add(leftArm, rightArm, legs)

  return {
    group,
    body,
    goggles,
    strap,
    leftArm,
    rightArm,
    leftLeg,
    rightLeg,
    legs,
    jumpBob: 0,
  }
}

function makeLimb(radiusTop, height, radiusBottom, material) {
  const limb = new THREE.Mesh(new THREE.CapsuleGeometry(radiusTop, height, 4, 10), material)
  limb.castShadow = true
  limb.receiveShadow = true
  return limb
}

function createTrackSegment(z) {
  const seg = new THREE.Group()
  seg.position.z = z

  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(ROAD_HALF_WIDTH * 2, TRACK_LENGTH, 1, 1),
    new THREE.MeshStandardMaterial({ map: roadTexture, roughness: 1, metalness: 0 }),
  )
  road.rotation.x = -Math.PI / 2
  road.receiveShadow = true
  seg.add(road)

  const curbMat = new THREE.MeshStandardMaterial({ color: 0x182539, roughness: 1 })
  const curbL = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.18, TRACK_LENGTH), curbMat)
  curbL.position.set(-ROAD_HALF_WIDTH - 0.15, 0.09, 0)
  curbL.receiveShadow = true
  curbL.castShadow = true
  const curbR = curbL.clone()
  curbR.position.x = ROAD_HALF_WIDTH + 0.15
  seg.add(curbL, curbR)

  const stripeMat = new THREE.MeshStandardMaterial({ color: 0x73dfff, emissive: 0x214968, emissiveIntensity: 0.35, roughness: 0.4 })
  const line = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.02, TRACK_LENGTH), stripeMat)
  line.position.set(0, 0.02, 0)
  seg.add(line)

  const rails = [
    makeStreetLight(-ROAD_HALF_WIDTH + 0.5, 0.0, -6),
    makeStreetLight(ROAD_HALF_WIDTH - 0.5, 0.0, 6),
  ]
  rails.forEach((r) => seg.add(r))

  return seg
}

function makeStreetLight(x, y, z) {
  const g = new THREE.Group()
  g.position.set(x, y, z)
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 3.8, 10), new THREE.MeshStandardMaterial({ color: 0x223349, roughness: 0.9 }))
  pole.position.y = 1.9
  pole.castShadow = true
  g.add(pole)
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.06, 0.06), new THREE.MeshStandardMaterial({ color: 0x2f4561, roughness: 0.9 }))
  arm.position.set(0.25, 3.55, 0)
  arm.castShadow = true
  g.add(arm)
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 14), new THREE.MeshStandardMaterial({ color: 0xb6f4ff, emissive: 0x8beeff, emissiveIntensity: 2.5 }))
  bulb.position.set(0.56, 3.52, 0)
  g.add(bulb)
  const glow = new THREE.PointLight(0x8beeff, 0.85, 7, 2)
  glow.position.set(0.56, 3.48, 0)
  g.add(glow)
  return g
}

const materials = {
  player: new THREE.MeshStandardMaterial({ color: 0xf0d43b, roughness: 0.72, metalness: 0.05 }),
  suit: new THREE.MeshStandardMaterial({ color: 0x2f6fff, roughness: 0.85, metalness: 0.03 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x24324a, roughness: 0.95, metalness: 0.05 }),
  eye: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0.05 }),
  metal: new THREE.MeshStandardMaterial({ color: 0xbac6d6, roughness: 0.3, metalness: 0.75 }),
  obstacle: new THREE.MeshStandardMaterial({ color: 0xffa33c, roughness: 0.82, metalness: 0.04 }),
  obstacleAccent: new THREE.MeshStandardMaterial({ color: 0x2fe0ff, roughness: 0.4, metalness: 0.1, emissive: 0x11384f, emissiveIntensity: 0.45 }),
  coin: new THREE.MeshStandardMaterial({ color: 0xffdb58, roughness: 0.25, metalness: 0.8, emissive: 0x6d5400, emissiveIntensity: 0.2 }),
  coinCore: new THREE.MeshStandardMaterial({ color: 0xfff0a0, roughness: 0.2, metalness: 0.5 }),
  shield: new THREE.MeshStandardMaterial({ color: 0x79dfff, roughness: 0.2, metalness: 0.45, emissive: 0x0c2f49, emissiveIntensity: 0.6 }),
  shieldCore: new THREE.MeshStandardMaterial({ color: 0xeafaff, roughness: 0.1, metalness: 0.1, emissive: 0x4ccfff, emissiveIntensity: 0.8 }),
  magnet: new THREE.MeshStandardMaterial({ color: 0x9dff8c, roughness: 0.35, metalness: 0.25, emissive: 0x16491a, emissiveIntensity: 0.7 }),
  magnetCore: new THREE.MeshStandardMaterial({ color: 0xf1ffeb, roughness: 0.15, metalness: 0.1, emissive: 0x8dff7a, emissiveIntensity: 0.85 }),
  drone: new THREE.MeshStandardMaterial({ color: 0xff5575, roughness: 0.45, metalness: 0.2, emissive: 0x2d0710, emissiveIntensity: 0.6 }),
  droneRing: new THREE.MeshStandardMaterial({ color: 0x1f355a, roughness: 0.9, metalness: 0.15 }),
}

function makeRoadTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 1024
  const ctx = canvas.getContext('2d')

  ctx.fillStyle = '#111a27'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  const grd = ctx.createLinearGradient(0, 0, canvas.width, 0)
  grd.addColorStop(0, '#0b1320')
  grd.addColorStop(0.2, '#1b2a3d')
  grd.addColorStop(0.5, '#283c56')
  grd.addColorStop(0.8, '#1c2b3d')
  grd.addColorStop(1, '#0b1320')
  ctx.fillStyle = grd
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  for (let y = 0; y < canvas.height; y += 48) {
    ctx.fillStyle = y % 96 === 0 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.07)'
    ctx.fillRect(0, y, canvas.width, 24)
  }

  ctx.strokeStyle = 'rgba(255,255,255,0.92)'
  ctx.lineWidth = 18
  ctx.setLineDash([64, 48])
  ctx.beginPath()
  ctx.moveTo(canvas.width * 0.5, 0)
  ctx.lineTo(canvas.width * 0.5, canvas.height)
  ctx.stroke()
  ctx.setLineDash([])

  ctx.strokeStyle = 'rgba(127,224,255,0.5)'
  ctx.lineWidth = 7
  ctx.beginPath()
  ctx.moveTo(canvas.width * 0.25, 0)
  ctx.lineTo(canvas.width * 0.25, canvas.height)
  ctx.moveTo(canvas.width * 0.75, 0)
  ctx.lineTo(canvas.width * 0.75, canvas.height)
  ctx.stroke()

  ctx.fillStyle = 'rgba(0,0,0,0.12)'
  for (let i = 0; i < 320; i++) {
    const x = Math.random() * canvas.width
    const y = Math.random() * canvas.height
    const s = Math.random() * 2.5 + 0.4
    ctx.fillRect(x, y, s, s)
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  return texture
}

function createStars() {
  const geo = new THREE.BufferGeometry()
  const points = []
  for (let i = 0; i < 240; i++) {
    points.push(
      THREE.MathUtils.randFloatSpread(180),
      THREE.MathUtils.randFloat(12, 80),
      THREE.MathUtils.randFloatSpread(220),
    )
  }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(points, 3))
  const mat = new THREE.PointsMaterial({ color: 0xb2dcff, size: 0.24, transparent: true, opacity: 0.65 })
  const pts = new THREE.Points(geo, mat)
  return pts
}

function animateStars(dt) {
  stars.rotation.y += dt * 0.015
}

function getPlayerBox() {
  const slide = game.slideTimer > 0
  const height = slide ? 0.95 : (game.grounded ? 1.9 : 1.9 + game.y)
  const centerY = player.group.position.y + (slide ? 0.18 : 0.0)
  const halfX = 0.5
  const halfZ = 0.48
  const halfY = height * 0.5
  return new THREE.Box3(
    new THREE.Vector3(player.group.position.x - halfX, centerY - halfY, PLAYER_Z - halfZ),
    new THREE.Vector3(player.group.position.x + halfX, centerY + halfY, PLAYER_Z + halfZ),
  )
}

function getObstacleHitBox(kind) {
  if (kind === 'crate') return { x: 0, y: 0.62, z: 0, w: 1.25, h: 1.25, d: 1.25 }
  if (kind === 'barrier') return { x: 0, y: 0.42, z: 0, w: 1.6, h: 0.84, d: 1.08 }
  if (kind === 'arch') return { x: 0, y: 1.34, z: 0, w: 1.7, h: 0.28, d: 0.55 }
  return { x: 0, y: 2.1, z: 0, w: 1.0, h: 1.0, d: 1.0 }
}

function getObstacleBox(obstacle) {
  const hb = obstacle.hitBox
  const center = new THREE.Vector3(
    obstacle.group.position.x + hb.x,
    obstacle.group.position.y + hb.y,
    obstacle.group.position.z + hb.z,
  )
  const half = new THREE.Vector3(hb.w / 2, hb.h / 2, hb.d / 2)
  return new THREE.Box3(center.clone().sub(half), center.clone().add(half))
}

function pulseFlash(color) {
  flashEl.style.background = `radial-gradient(circle at center, ${color}, rgba(255,255,255,0))`
  flashEl.classList.add('on')
  clearTimeout(pulseFlash._t)
  pulseFlash._t = setTimeout(() => flashEl.classList.remove('on'), 90)
}

function updateHUD() {
  scoreEl.textContent = String(game.score)
  coinsEl.textContent = String(game.coins)
  bestEl.textContent = String(game.best)
  speedEl.textContent = `${Math.round(game.speed)} m/s`

  const parts = []
  if (game.shieldTimer > 0) parts.push(`shield ${game.shieldTimer.toFixed(1)}s`)
  if (game.magnetTimer > 0) parts.push(`magnet ${game.magnetTimer.toFixed(1)}s`)
  powerEl.textContent = parts.length ? parts.join(' · ') : 'none'

  if (game.mode === 'running') {
    overlayEl.style.display = 'none'
    hintEl.style.display = 'block'
  } else {
    overlayEl.style.display = 'block'
    hintEl.style.display = 'none'
  }
}

function setOverlay(mode) {
  if (mode === 'ready') {
    overlayEl.innerHTML = `
      <div class="title">Code Instant Runner</div>
      <div class="copy">3D endless runner built with Three.js. Dodge crates, slide under arches, leap barriers, and chain coin lines.</div>
      <div class="actions">
        <button id="startBtn" type="button">Start Run</button>
      </div>
    `
  } else if (mode === 'gameover') {
    overlayEl.innerHTML = `
      <div class="title" style="color: var(--danger)">Run ended</div>
      <div class="copy">Score ${game.score.toLocaleString()} · Coins ${game.coins} · Best ${game.best.toLocaleString()}</div>
      <div class="actions">
        <button id="restartBtn" type="button">Run Again</button>
        <button id="againBtn" type="button" class="secondary">Keep Playing</button>
      </div>
    `
  }

  const startBtn = overlayEl.querySelector('#startBtn')
  const restartBtn = overlayEl.querySelector('#restartBtn')
  const againBtn = overlayEl.querySelector('#againBtn')
  if (startBtn) startBtn.addEventListener('click', () => startRun())
  if (restartBtn) restartBtn.addEventListener('click', () => startRun())
  if (againBtn) againBtn.addEventListener('click', () => startRun())
}

function startRun() {
  if (game.mode === 'running') return
  resetRun()
  game.mode = 'running'
  setOverlay('ready')
  updateHUD()
}

function endRun() {
  game.mode = 'gameover'
  game.best = Math.max(game.best, game.score)
  localStorage.setItem(STORAGE_KEY, String(game.best))
  bestEl.textContent = String(game.best)
  setOverlay('gameover')
  pulseFlash('rgba(255, 110, 135, 0.26)')
}

function resetRun() {
  game.score = 0
  game.coins = 0
  game.speed = BASE_SPEED
  game.runDistance = 0
  game.lane = 1
  game.laneX = 0
  game.targetLaneX = 0
  game.y = 0
  game.vy = 0
  game.grounded = true
  game.slideTimer = 0
  game.shieldTimer = 0
  game.magnetTimer = 0
  game.spawnTimer = 0
  game.nextSpawnDelay = 0.8
  game.nextPowerDelay = 8
  game.shake = 0
  game.mode = 'running'

  player.group.position.set(0, 0.85, 0)
  player.group.rotation.set(0, 0, 0)
  player.body.scale.set(1, 1, 1)
  player.strap.scale.set(1, 1, 1)
  player.goggles.position.set(0, 1.12, 0.1)
  player.legs.visible = true

  for (const list of [obstacles, coins, powerups]) {
    while (list.length) {
      const item = list.pop()
      scene.remove(item.group)
    }
  }

  for (let i = 0; i < TRACK_COUNT; i++) {
    trackSegments[i].position.z = i * TRACK_LENGTH
  }
  camera.position.set(0, 4.5, 10)
}

function bindInputs() {
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase()
    if (k === 'arrowleft' || k === 'a') {
      e.preventDefault()
      if (game.mode !== 'running') startRun()
      laneLeft()
    } else if (k === 'arrowright' || k === 'd') {
      e.preventDefault()
      if (game.mode !== 'running') startRun()
      laneRight()
    } else if (k === 'arrowup' || k === 'w' || k === ' ') {
      e.preventDefault()
      if (game.mode !== 'running') startRun()
      jump()
    } else if (k === 'arrowdown' || k === 's') {
      e.preventDefault()
      if (game.mode !== 'running') startRun()
      slide()
    } else if (k === 'enter') {
      if (game.mode !== 'running') startRun()
    }
  }, { passive: false })

  renderer.domElement.addEventListener('pointerdown', (e) => {
    input.active = true
    input.startX = e.clientX
    input.startY = e.clientY
    if (game.mode !== 'running') startRun()
  })

  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!input.active) return
    input.active = false
    const dx = e.clientX - input.startX
    const dy = e.clientY - input.startY
    if (Math.abs(dx) < 20 && Math.abs(dy) < 20) {
      jump()
      return
    }
    if (Math.abs(dx) > Math.abs(dy)) {
      dx > 0 ? laneRight() : laneLeft()
    } else {
      dy > 0 ? slide() : jump()
    }
  })

  renderer.domElement.addEventListener('pointercancel', () => {
    input.active = false
  })

  const leftBtn = hud.querySelector('#leftBtn')
  const jumpBtn = hud.querySelector('#jumpBtn')
  const rightBtn = hud.querySelector('#rightBtn')
  leftBtn.addEventListener('click', () => { if (game.mode !== 'running') startRun(); laneLeft() })
  jumpBtn.addEventListener('click', () => { if (game.mode !== 'running') startRun(); jump() })
  rightBtn.addEventListener('click', () => { if (game.mode !== 'running') startRun(); laneRight() })
}

function laneLeft() {
  game.lane = Math.max(0, game.lane - 1)
}

function laneRight() {
  game.lane = Math.min(2, game.lane + 1)
}

function jump() {
  if (game.mode !== 'running') return
  if (!game.grounded || game.slideTimer > 0) return
  game.grounded = false
  game.vy = 8.3 + Math.min(1.8, game.speed * 0.04)
}

function slide() {
  if (game.mode !== 'running') return
  if (!game.grounded) return
  game.slideTimer = 0.78
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
}

function randomRange(min, max) {
  return min + Math.random() * (max - min)
}

function spawnChallenge() {
  const pattern = Math.floor(Math.random() * 6)
  const lane = Math.floor(Math.random() * 3)
  const z = 88 + Math.random() * 14

  if (pattern === 0) {
    spawnObstacle('crate', lane, z)
    spawnCoinsLine(lane, z + 4, 4, 0.42)
  } else if (pattern === 1) {
    spawnObstacle('barrier', lane, z)
    spawnCoinsArc(lane, z + 1, 5)
  } else if (pattern === 2) {
    spawnObstacle('arch', lane, z)
    spawnCoinsLine(lane, z + 2, 3, 0.18)
  } else if (pattern === 3) {
    const other = (lane + 1 + Math.floor(Math.random() * 2)) % 3
    spawnObstacle('crate', lane, z)
    spawnObstacle('crate', other, z + 5)
    spawnCoinsLine(1, z + 2, 3, 0.5)
  } else if (pattern === 4) {
    spawnObstacle('drone', lane, z)
    spawnCoinsArc(lane, z + 2, 5)
  } else {
    spawnObstacle('barrier', lane, z)
    spawnObstacle('arch', (lane + 2) % 3, z + 7)
    spawnCoinsLine((lane + 1) % 3, z + 3, 4, 0.45)
  }
}

