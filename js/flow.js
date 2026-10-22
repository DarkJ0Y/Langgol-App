/*
 * "How it works": one order's journey through six stations. Scrolling the steps moves a crate
 * along the road and the camera with it. The price station's bars are the real demo split.
 */
import * as THREE from 'three'
import { palette, onThemeChange, prefersReducedMotion, whenVisible } from './theme.js'

const STATIONS = [
  new THREE.Vector3(-12, 0, 2),
  new THREE.Vector3(-7, 0, -2.5),
  new THREE.Vector3(-1.5, 0, 1.5),
  new THREE.Vector3(3.5, 0, -2.5),
  new THREE.Vector3(8.5, 0, 1.5),
  new THREE.Vector3(13.5, 0, -1.5),
]

/** Share of the buyer's taka, demo data: farmer, delivery, commission, handling. */
const SPLIT = [0.567, 0.41, 0.018, 0.005]

function mat(color, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.75, flatShading: true, ...extra })
}

function box(w, h, d, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material)
  m.position.set(x, y + h / 2, z)
  m.castShadow = true
  m.receiveShadow = true
  return m
}

export function initFlow(canvas, steps, caption) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'low-power',
  })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 120)

  const hemi = new THREE.HemisphereLight(0xffffff, 0x333333, 1.0)
  scene.add(hemi)
  const sun = new THREE.DirectionalLight(0xffffff, 1.8)
  sun.position.set(-8, 14, 10)
  sun.castShadow = true
  sun.shadow.mapSize.set(1024, 1024)
  Object.assign(sun.shadow.camera, { left: -20, right: 20, top: 12, bottom: -12, near: 1, far: 50 })
  scene.add(sun)

  /* ---- shared materials, recoloured by the theme */
  const m = {
    ground: mat('#000'),
    road: mat('#000'),
    green: mat('#2f7d3a'),
    greenLight: mat('#4caf50'),
    soil: mat('#4a3b2a'),
    white: mat('#e9ece6'),
    dark: mat('#2a2f2a'),
    wood: mat('#b8894f'),
    gold: mat('#e5b93a', { roughness: 0.35, metalness: 0.3 }),
    fill: mat('#86efac', { emissive: '#86efac', emissiveIntensity: 0.35 }),
    ring: new THREE.MeshBasicMaterial({
      color: '#86efac',
      transparent: true,
      opacity: 0.25,
      side: THREE.DoubleSide,
    }),
    viz: [mat('#16a34a'), mat('#3987e5'), mat('#d95926'), mat('#9085e9')],
  }

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 40), m.ground)
  ground.rotation.x = -Math.PI / 2
  ground.receiveShadow = true
  scene.add(ground)

  /* ---- the road the order travels */
  const curve = new THREE.CatmullRomCurve3(
    STATIONS.map((p) => p.clone().setY(0.03)),
    false,
    'centripetal',
  )
  const road = new THREE.Mesh(new THREE.TubeGeometry(curve, 200, 0.32, 8, false), m.road)
  road.scale.y = 0.08
  road.receiveShadow = true
  scene.add(road)

  /* ---- stations */
  const rings = []
  const stationGroups = STATIONS.map((p) => {
    const g = new THREE.Group()
    g.position.copy(p)
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.9, 2.15, 48), m.ring.clone())
    ring.rotation.x = -Math.PI / 2
    ring.position.y = 0.02
    g.add(ring)
    rings.push(ring)
    scene.add(g)
    return g
  })

  // 0 · the farm: plots of crops and a small store
  {
    const g = stationGroups[0]
    for (let x = -1; x <= 1; x++) {
      for (let z = -1; z <= 0; z++) {
        g.add(box(0.85, 0.12, 0.85, m.soil, x * 0.95 - 0.4, 0, z * 0.95 + 0.2))
        for (let k = 0; k < 4; k++) {
          const crop = new THREE.Mesh(
            new THREE.ConeGeometry(0.1, 0.45, 5),
            (x + z) % 2 ? m.green : m.greenLight,
          )
          crop.position.set(
            x * 0.95 - 0.4 + (k % 2) * 0.35 - 0.17,
            0.33,
            z * 0.95 + 0.2 + Math.floor(k / 2) * 0.35 - 0.17,
          )
          crop.castShadow = true
          g.add(crop)
        }
      }
    }
    g.add(box(0.9, 0.7, 0.8, m.white, 1.2, 0, 1.0))
    const roof = new THREE.Mesh(new THREE.ConeGeometry(0.75, 0.45, 4), m.dark)
    roof.position.set(1.2, 0.92, 1.0)
    roof.rotation.y = Math.PI / 4
    roof.castShadow = true
    g.add(roof)
  }

  // 1 · the listing: a phone with a produce card on screen
  {
    const g = stationGroups[1]
    const phone = new THREE.Group()
    phone.add(box(1.1, 2.0, 0.12, m.dark, 0, 0, 0))
    phone.add(box(0.94, 0.62, 0.02, m.greenLight, 0, 1.15, 0.07))
    phone.add(box(0.94, 0.16, 0.02, m.white, 0, 0.82, 0.07))
    phone.add(box(0.6, 0.12, 0.02, m.white, -0.17, 0.6, 0.07))
    phone.add(box(0.94, 0.22, 0.02, m.fill, 0, 0.22, 0.07))
    phone.position.y = 0.15
    phone.rotation.y = 0.35
    phone.rotation.x = -0.12
    g.add(phone)
    g.userData.sway = phone
  }

  // 2 · the price, worked out to the door: bars in the proportions of the demo split
  {
    const g = stationGroups[2]
    g.add(box(2.6, 0.12, 1.2, m.white, 0, 0, 0))
    SPLIT.forEach((share, i) => {
      const h = Math.max(0.06, share * 3.2)
      g.add(box(0.45, h, 0.45, m.viz[i], -0.9 + i * 0.6, 0.12, 0))
    })
  }

  // 3 · reserved stock: crates held, with a ring that says "held"
  {
    const g = stationGroups[3]
    const crates = [
      [0, 0, 0],
      [0.62, 0, 0.1],
      [0.3, 0.52, 0.05],
      [-0.6, 0, -0.2],
    ]
    for (const [x, y, z] of crates) g.add(box(0.55, 0.5, 0.55, m.wood, x, y, z))
    const lock = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.05, 8, 48), m.fill)
    lock.rotation.x = Math.PI / 2
    lock.position.y = 0.55
    g.add(lock)
    g.userData.spin = lock
  }

  // 4 · the truck
  {
    const g = stationGroups[4]
    const truck = new THREE.Group()
    truck.add(box(1.5, 0.95, 0.9, m.white, -0.25, 0.28, 0))
    truck.add(box(0.6, 0.7, 0.85, m.greenLight, 0.85, 0.28, 0))
    truck.add(box(0.05, 0.3, 0.7, m.dark, 1.16, 0.6, 0))
    for (const [x, z] of [
      [-0.6, 0.45],
      [-0.6, -0.45],
      [0.75, 0.45],
      [0.75, -0.45],
    ]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.14, 16), m.dark)
      w.rotation.x = Math.PI / 2
      w.position.set(x, 0.22, z)
      w.castShadow = true
      truck.add(w)
    }
    truck.rotation.y = -0.5
    g.add(truck)
    g.userData.bob = truck
  }

  // 5 · the buyer's home, and the ledger: a stack of coins that balances
  {
    const g = stationGroups[5]
    g.add(box(1.2, 0.9, 1.0, m.white, -0.5, 0, 0))
    const roof = new THREE.Mesh(new THREE.ConeGeometry(0.95, 0.6, 4), m.greenLight)
    roof.position.set(-0.5, 1.2, 0)
    roof.rotation.y = Math.PI / 4
    roof.castShadow = true
    g.add(roof)
    g.add(box(0.25, 0.45, 0.04, m.dark, -0.5, 0, 0.51))
    for (let k = 0; k < 6; k++) {
      const coin = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.08, 20), m.gold)
      coin.position.set(0.85, 0.05 + k * 0.09, 0.25)
      coin.castShadow = true
      g.add(coin)
    }
  }

  /* ---- the order itself */
  const crate = box(0.42, 0.36, 0.42, m.fill)
  crate.geometry.translate(0, -0.18, 0)
  scene.add(crate)

  function applyTheme() {
    const p = palette()
    scene.background = new THREE.Color(p.surface)
    scene.fog = new THREE.Fog(p.surface, 18, 40)
    m.ground.color.set(p.dark ? '#151915' : '#eef1ea')
    m.road.color.set(p.dark ? '#2b322b' : '#d4d9cf')
    m.soil.color.set(p.dark ? '#4a3b2a' : '#b89c74')
    m.fill.color.set(p.fill)
    m.fill.emissive.set(p.fill)
    p.viz.forEach((c, i) => m.viz[i].color.set(c))
    hemi.intensity = p.dark ? 0.9 : 1.2
  }
  applyTheme()

  /* ---- scroll → progress (0 … 5, fractional between steps) */
  let target = 0
  let progress = 0
  let shownStep = -1
  function readScroll() {
    const mid = window.innerHeight * 0.5
    const centres = steps.map((s) => {
      const r = s.getBoundingClientRect()
      return r.top + r.height / 2
    })
    if (mid <= centres[0]) target = 0
    else if (mid >= centres[centres.length - 1]) target = centres.length - 1
    else {
      for (let i = 0; i < centres.length - 1; i++) {
        if (mid >= centres[i] && mid <= centres[i + 1]) {
          target = i + (mid - centres[i]) / (centres[i + 1] - centres[i])
          break
        }
      }
    }
    const active = Math.round(target)
    if (active !== shownStep) {
      shownStep = active
      steps.forEach((s, i) => s.classList.toggle('is-active', i === active))
      caption.textContent = `${active + 1} · ${steps[active].querySelector('h3').textContent}`
    }
  }
  window.addEventListener('scroll', readScroll, { passive: true })
  readScroll()

  /* ---- camera */
  const camPos = new THREE.Vector3()
  const look = new THREE.Vector3()
  let offset = new THREE.Vector3(4.5, 5.5, 8)
  function resize() {
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    if (!w || !h) return
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    offset = w / h < 1 ? new THREE.Vector3(3, 7, 10) : new THREE.Vector3(4.5, 5.5, 8)
  }
  new ResizeObserver(resize).observe(canvas)
  resize()

  function place(t, smooth) {
    progress = smooth ? progress + (target - progress) * 0.08 : target
    const u = progress / (STATIONS.length - 1)
    curve.getPointAt(Math.min(Math.max(u, 0), 1), crate.position)
    crate.position.y = 0.55 + Math.abs(Math.sin(t * 3)) * 0.12
    const tangent = curve.getTangentAt(Math.min(Math.max(u, 0.001), 0.999))
    crate.rotation.y = Math.atan2(tangent.x, tangent.z)

    look.copy(crate.position).setY(0.6)
    camPos.copy(look).add(offset)
    if (smooth) camera.position.lerp(camPos, 0.08)
    else camera.position.copy(camPos)
    camera.lookAt(look)

    rings.forEach((ring, i) => {
      const near = Math.max(0, 1 - Math.abs(progress - i))
      ring.material.opacity = 0.15 + near * 0.7
      ring.scale.setScalar(1 + near * 0.08 * Math.sin(t * 3) ** 2)
    })
    for (const g of stationGroups) {
      if (g.userData.spin) g.userData.spin.rotation.z = smooth ? t * 0.6 : 0
      if (g.userData.sway)
        g.userData.sway.rotation.y = 0.35 + (smooth ? Math.sin(t * 0.9) * 0.3 : 0)
      if (g.userData.bob) g.userData.bob.position.y = smooth ? Math.sin(t * 4) * 0.03 : 0
    }
    renderer.render(scene, camera)
  }

  const clock = new THREE.Clock()
  onThemeChange(() => {
    applyTheme()
    place(clock.getElapsedTime(), false)
  })

  if (prefersReducedMotion()) {
    // No animation: the scene jumps to each step as it becomes current.
    place(0, false)
    window.addEventListener('scroll', () => place(0, false), { passive: true })
    new ResizeObserver(() => place(0, false)).observe(canvas)
    return
  }
  whenVisible(canvas, renderer, () => place(clock.getElapsedTime(), true))
}
