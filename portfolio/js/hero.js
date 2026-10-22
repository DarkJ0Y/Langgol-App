/*
 * Hero: a field of farm plots, a market town, and orders travelling from farms to the market.
 * Low-poly, flat colours, no textures — it loads fast and reads as a diagram, not a game.
 */
import * as THREE from 'three'
import { palette, onThemeChange, prefersReducedMotion, whenVisible } from './theme.js'

const COLS = 15
const ROWS = 15
const CELL = 0.92

/** Cheap smooth noise: enough to make the field look tended rather than random. */
function field(x, z) {
  return Math.sin(x * 0.35) * Math.cos(z * 0.42) * 0.5 + Math.sin((x + z) * 0.18) * 0.5
}

export function initHero(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'low-power',
  })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200)

  scene.add(new THREE.HemisphereLight(0xffffff, 0x223322, 1.1))
  const sun = new THREE.DirectionalLight(0xffffff, 1.6)
  sun.position.set(-6, 12, 8)
  scene.add(sun)

  const world = new THREE.Group()
  scene.add(world)

  /* ---- plots: one instanced mesh, so 540 boxes cost one draw call */
  const plotGeo = new THREE.BoxGeometry(CELL * 0.94, 1, CELL * 0.94)
  plotGeo.translate(0, 0.5, 0)
  const plotMat = new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true })
  const plots = new THREE.InstancedMesh(plotGeo, plotMat, COLS * ROWS)
  const plotInfo = []
  const m4 = new THREE.Matrix4()
  const river = (x) => Math.sin(x * 0.45) * 1.4 + 0.9
  let i = 0
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      const x = (c - COLS / 2) * CELL
      const z = (r - ROWS / 2) * CELL
      const n = field(c, r)
      const isWater = Math.abs(z - river(x)) < 0.75
      const h = isWater ? 0.04 : 0.12 + (n + 1) * 0.16
      const kind = isWater
        ? 'water'
        : n > 0.35
          ? 'paddy'
          : n > -0.2
            ? 'veg'
            : n > -0.6
              ? 'young'
              : 'soil'
      plotInfo.push({ x, z, h, kind, phase: c * 0.4 + r * 0.7 })
      m4.compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion(), new THREE.Vector3(1, h, 1))
      plots.setMatrixAt(i++, m4)
    }
  }
  world.add(plots)

  /* ---- market town, where every order is going */
  const hub = new THREE.Vector3(-2.6, 0, -2.4)
  const town = new THREE.Group()
  const townMat = new THREE.MeshStandardMaterial({ roughness: 0.7, flatShading: true })
  const blocks = [
    [0, 0, 1.6],
    [0.9, 0.2, 1.1],
    [-0.8, 0.5, 1.3],
    [0.3, -0.9, 0.9],
    [-0.5, -0.6, 0.7],
    [1.1, -0.8, 0.6],
    [-1.2, 1.2, 0.5],
  ]
  for (const [dx, dz, h] of blocks) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.75, h, 0.75), townMat)
    b.position.set(hub.x + dx, h / 2 + 0.3, hub.z + dz)
    town.add(b)
  }
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(2, 2.1, 0.3, 6), townMat)
  plinth.position.set(hub.x, 0.15, hub.z)
  town.add(plinth)
  world.add(town)

  /* ---- farms: a beacon each, and an arc to the market */
  const farms = [
    [3.4, 3.8],
    [5, -2.6],
    [1, -5.4],
    [5.6, 1.2],
    [-0.8, 4.6],
    [2, -0.4],
    [-5, 4.2],
    [-5.6, -5.6],
  ].map(([x, z]) => new THREE.Vector3(x, 0, z))
  const beaconMat = new THREE.MeshStandardMaterial({ emissiveIntensity: 1.4, roughness: 0.4 })
  const postMat = new THREE.MeshStandardMaterial({ roughness: 0.6 })
  const arcMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.45 })
  const packetMat = new THREE.MeshBasicMaterial()
  const packetGeo = new THREE.SphereGeometry(0.11, 12, 12)
  const curves = []
  const packets = []
  for (const f of farms) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.1, 8), postMat)
    post.position.set(f.x, 0.75, f.z)
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 16), beaconMat)
    head.position.set(f.x, 1.35, f.z)
    world.add(post, head)

    const start = new THREE.Vector3(f.x, 1.35, f.z)
    const end = new THREE.Vector3(hub.x, 2.1, hub.z)
    const mid = start.clone().lerp(end, 0.5)
    mid.y += 2.2 + start.distanceTo(end) * 0.12
    const curve = new THREE.QuadraticBezierCurve3(start, mid, end)
    curves.push(curve)
    world.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(48)), arcMat))
    for (let k = 0; k < 2; k++) {
      const p = new THREE.Mesh(packetGeo, packetMat)
      packets.push({ mesh: p, curve, offset: Math.random(), speed: 0.06 + Math.random() * 0.05 })
      world.add(p)
    }
  }

  /* ---- colours follow the theme */
  const kinds = {}
  function applyTheme() {
    const p = palette()
    scene.background = new THREE.Color(p.bg)
    scene.fog = new THREE.Fog(p.bg, 22, 46)
    Object.assign(kinds, {
      paddy: new THREE.Color(p.dark ? '#2f7d3a' : '#4caf50'),
      veg: new THREE.Color(p.dark ? '#246b31' : '#66bb6a'),
      young: new THREE.Color(p.dark ? '#3f8f47' : '#9ccc65'),
      soil: new THREE.Color(p.dark ? '#3b3226' : '#c9b48f'),
      water: new THREE.Color(p.dark ? '#1d3a4a' : '#9cc9de'),
    })
    plotInfo.forEach((info, idx) => plots.setColorAt(idx, kinds[info.kind]))
    plots.instanceColor.needsUpdate = true
    townMat.color.set(p.dark ? '#d9ddd5' : '#ffffff')
    postMat.color.set(p.dark ? '#cfd5cb' : '#5b6358')
    beaconMat.color.set(p.fill)
    beaconMat.emissive.set(p.fill)
    arcMat.color.set(p.fill)
    packetMat.color.set(p.dark ? '#ffffff' : '#15803d')
  }
  applyTheme()

  /* ---- camera and size */
  const pointer = { x: 0, y: 0 }
  window.addEventListener('pointermove', (e) => {
    pointer.x = e.clientX / window.innerWidth - 0.5
    pointer.y = e.clientY / window.innerHeight - 0.5
  })

  function resize() {
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    if (!w || !h) return
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    // The canvas has its own column (styles.css), so the whole field is framed in it. A tall
    // canvas needs the camera further back to fit the field's width.
    const back = w / h < 1 ? 1 + (1 - w / h) * 0.9 : 1
    camera.position.set(0, 16 * back, 21 * back)
    camera.lookAt(0, -0.5, 0)
  }
  new ResizeObserver(resize).observe(canvas)
  resize()

  /* ---- animation */
  const clock = new THREE.Clock()
  const pos = new THREE.Vector3()
  const scale = new THREE.Vector3()
  const quat = new THREE.Quaternion()
  function frame(t) {
    // Crops sway a little in the wind; water stays still.
    plotInfo.forEach((info, idx) => {
      if (info.kind === 'water' || info.kind === 'soil') return
      const h = info.h * (1 + Math.sin(t * 1.4 + info.phase) * 0.12)
      pos.set(info.x, 0, info.z)
      scale.set(1, h, 1)
      m4.compose(pos, quat, scale)
      plots.setMatrixAt(idx, m4)
    })
    plots.instanceMatrix.needsUpdate = true

    for (const p of packets) {
      const u = (p.offset + t * p.speed) % 1
      p.curve.getPoint(u, p.mesh.position)
      p.mesh.scale.setScalar(u > 0.92 ? (1 - u) / 0.08 : 1)
    }
    world.rotation.y = Math.sin(t * 0.08) * 0.12 + pointer.x * 0.12
    world.rotation.x = pointer.y * 0.04
    renderer.render(scene, camera)
  }

  onThemeChange(() => {
    applyTheme()
    frame(clock.getElapsedTime())
  })

  if (prefersReducedMotion()) {
    frame(2)
    new ResizeObserver(() => frame(2)).observe(canvas)
    return
  }
  whenVisible(canvas, renderer, () => frame(clock.getElapsedTime()))
}
