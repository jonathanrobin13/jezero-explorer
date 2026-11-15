import * as THREE from 'three'
import {
  createAstronaut, createBeacon, createGroundMaterial, createLander,
  createRocks, createSky, createSurfaceMarkers,
} from './missionSceneObjects.js'

const LANDING_SECONDS = 5.8
const EGRESS_SECONDS = 6.2
const LOOK_LIMIT = 1.38
const radiansToDegrees = THREE.MathUtils.radToDeg

const keyboardControls = new Map([
  ['KeyW', 'forward'], ['KeyS', 'back'], ['KeyA', 'left'], ['KeyD', 'right'],
  ['ArrowLeft', 'turnLeft'], ['ArrowRight', 'turnRight'], ['ArrowUp', 'lookUp'], ['ArrowDown', 'lookDown'],
])

export function startMissionScene({ canvas, world, texture, landing, onPhase, onTelemetry, onError }) {
  let renderer
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  } catch {
    throw new Error('Could not start WebGL 2 for the astronaut mission. Try a browser with hardware acceleration.')
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
  const scene = new THREE.Scene()
  scene.fog = new THREE.FogExp2('#be846b', 0.00018)
  const camera = new THREE.PerspectiveCamera(68, 1, 0.28, 45000)
  camera.rotation.order = 'YXZ'
  const sunDirection = new THREE.Vector3(-0.62, 0.39, -0.65).normalize()
  const sky = createSky(sunDirection)
  sky.scale.setScalar(35000)
  sky.renderOrder = -100
  sky.frustumCulled = false
  scene.add(sky)
  const sun = new THREE.DirectionalLight('#ffdcc1', 2.2)
  sun.position.copy(sunDirection).multiplyScalar(1000)
  scene.add(new THREE.HemisphereLight('#ffe0ce', '#8e4b35', 1.62), sun)

  if (texture) {
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
  }
  scene.add(
    new THREE.Mesh(world.realGeometry, createGroundMaterial(texture ? '#dd976e' : '#ad6041', texture)),
    new THREE.Mesh(world.exterior, createGroundMaterial('#a76650', null)),
    createSurfaceMarkers(world),
    createRocks(world, landing),
  )

  const { craft, hatch, ramp, flame } = createLander()
  const { suit, pose } = createAstronaut()
  const beacon = createBeacon()
  scene.add(craft, suit, beacon)

  const exhaustPositions = new Float32Array(108 * 3)
  const exhaustGeometry = new THREE.BufferGeometry()
  exhaustGeometry.setAttribute('position', new THREE.BufferAttribute(exhaustPositions, 3))
  const exhaustMaterial = new THREE.PointsMaterial({
    color: '#e3a779', size: 1.8, transparent: true, opacity: 0.52, depthWrite: false,
  })
  const exhaust = new THREE.Points(exhaustGeometry, exhaustMaterial)
  exhaust.frustumCulled = false
  scene.add(exhaust)

  const landingHeight = world.heightAt(landing.x, landing.z)
  const exitHeading = Math.atan2(-landing.x, -landing.z)
  const exitX = Math.sin(exitHeading)
  const exitZ = Math.cos(exitHeading)
  const sideX = exitZ
  const sideZ = -exitX
  craft.rotation.y = exitHeading
  suit.rotation.y = exitHeading
  const position = { x: landing.x, z: landing.z }
  const keyboard = new Set()
  const touch = new Set()
  let drag = null
  let mode = 'walk'
  let phase = 'landing'
  let destination = null
  let elapsed = 0
  let lastFrame = performance.now()
  let lastUpdate = 0
  let frame
  let yaw = Math.PI - exitHeading
  let pitch = 0
  let speed = 0
  let atLimit = false

  function notify() {
    onTelemetry({
      ...world.telemetry(position.x, position.z),
      ...position,
      heading: (radiansToDegrees(yaw) % 360 + 360) % 360,
      speed,
      atLimit,
    })
  }

  function enterEVA() {
    if (phase === 'eva') return
    const x = landing.x + exitX * 14
    const z = landing.z + exitZ * 14
    if (world.heightAt(x, z) !== null) Object.assign(position, { x, z })
    phase = 'eva'
    craft.position.set(landing.x, landingHeight, landing.z)
    hatch.rotation.x = -2.3
    ramp.visible = true
    suit.visible = false
    flame.visible = false
    exhaust.visible = false
    onPhase(phase)
    notify()
    canvas.focus({ preventScroll: true })
  }

  function stageFlight() {
    const t = Math.min(1, elapsed / LANDING_SECONDS)
    const altitude = 190 * (1 - t) ** 2.25
    craft.position.set(landing.x, landingHeight + altitude, landing.z)
    flame.scale.y = 0.68 + 0.28 * Math.sin(elapsed * 45)
    flame.visible = t < 0.97
    exhaust.visible = t > 0.25
    exhaustMaterial.opacity = 0.5 * Math.min(1, (t - 0.25) * 3)
    for (let index = 0; index < exhaustPositions.length / 3; index++) {
      const shift = (index * 0.178 + elapsed * 1.65) % 1
      const radius = 1 + 23 * shift * t
      const angle = index * 2.39996
      const x = landing.x + Math.sin(angle) * radius
      const z = landing.z + Math.cos(angle) * radius
      exhaustPositions[index * 3] = x
      exhaustPositions[index * 3 + 1] = (world.heightAt(x, z) ?? landingHeight) + 0.5 + (1 - shift) * (2 + altitude * 0.24)
      exhaustPositions[index * 3 + 2] = z
    }
    exhaustGeometry.attributes.position.needsUpdate = true
    const range = 28 + 65 * (1 - t)
    camera.position.set(landing.x + sideX * range + exitX * 15,
      landingHeight + 7 + altitude * 0.42, landing.z + sideZ * range + exitZ * 15)
    camera.lookAt(landing.x, landingHeight + 5 + altitude, landing.z)

    if (t === 1) {
      phase = 'egress'
      elapsed = 0
      onPhase(phase)
    }
  }

  function stageEgress() {
    hatch.rotation.x = -2.3 * Math.min(1, elapsed / 0.9)
    ramp.visible = elapsed > 0.82
    suit.visible = elapsed >= 1
    exhaustMaterial.opacity = Math.max(0, 0.48 - elapsed * 0.74)
    const progress = THREE.MathUtils.clamp((elapsed - 1) / 3.35, 0, 1)
    const distance = 1.93 + progress * 12.07
    const x = landing.x + exitX * distance
    const z = landing.z + exitZ * distance
    const y = world.heightAt(x, z) ?? landingHeight
    suit.position.set(x, y + Math.max(0, 2.16 - (distance - 1.93) * 0.55), z)
    pose(progress > 0 && progress < 1 ? Math.sin(elapsed * 9) * 0.43 : 0,
      elapsed >= 4.35 ? Math.sin((elapsed - 4.35) * 3.1) * 0.95 : 0)
    const cameraX = x + sideX * (8.4 - progress * 4) + exitX * 4.8
    const cameraZ = z + sideZ * (8.4 - progress * 4) + exitZ * 4.8
    camera.position.set(cameraX, Math.max(y, world.heightAt(cameraX, cameraZ) ?? y) + 3.2, cameraZ)
    camera.lookAt(x - exitX * (1 - progress) * 4, suit.position.y + 1.24, z - exitZ * (1 - progress) * 4)
    if (elapsed >= EGRESS_SECONDS) enterEVA()
  }

  function move(dt) {
    const pressed = (key) => Number(keyboard.has(key) || touch.has(key))
    const steer = pressed('right') - pressed('left')
    const driving = mode === 'buggy'
    yaw += (pressed('turnRight') - pressed('turnLeft') + (driving ? steer : 0)) * dt * 1.5
    pitch = THREE.MathUtils.clamp(pitch + (pressed('lookUp') - pressed('lookDown')) * dt * 1.15, -LOOK_LIMIT, LOOK_LIMIT)
    const forward = pressed('forward') - pressed('back')
    const strafe = driving ? 0 : steer
    const magnitude = Math.hypot(forward, strafe)
    speed = 0
    if (magnitude) {
      const pace = driving ? 65 : 8
      const distance = dt * pace / magnitude
      const play = world.play
      const x = THREE.MathUtils.clamp(position.x + (forward * Math.sin(yaw) + strafe * Math.cos(yaw)) * distance, play.xMin, play.xMax)
      const z = THREE.MathUtils.clamp(position.z + (-forward * Math.cos(yaw) + strafe * Math.sin(yaw)) * distance, play.zMin, play.zMax)
      if (world.heightAt(x, z) !== null) {
        speed = Math.hypot(x - position.x, z - position.z) / Math.max(dt, 0.001)
        Object.assign(position, { x, z })
      }
    }
    atLimit = position.x === world.play.xMin || position.x === world.play.xMax
      || position.z === world.play.zMin || position.z === world.play.zMax
    const bob = mode === 'walk' && speed > 0 ? Math.sin(elapsed * 13) * 0.046 : 0
    camera.position.set(position.x, world.heightAt(position.x, position.z) + (driving ? 2.45 : 1.67) + bob, position.z)
    camera.rotation.set(pitch, -yaw, 0)
    if (destination) beacon.scale.setScalar(1 + Math.sin(elapsed * 2.5) * 0.07)
  }

  function tick(now) {
    const dt = Math.min(0.08, (now - lastFrame) / 1000)
    lastFrame = now
    elapsed += dt
    if (phase === 'landing') stageFlight()
    else if (phase === 'egress') stageEgress()
    else {
      move(dt)
      if (now - lastUpdate > 125) {
        lastUpdate = now
        notify()
      }
    }
    sky.position.copy(camera.position)
    renderer.render(scene, camera)
    frame = requestAnimationFrame(tick)
  }

  function resize() {
    const { clientWidth, clientHeight } = canvas
    if (!clientWidth || !clientHeight) return
    renderer.setSize(clientWidth, clientHeight, false)
    camera.aspect = clientWidth / clientHeight
    camera.updateProjectionMatrix()
  }

  function onKeyDown(event) {
    const control = keyboardControls.get(event.code)
    if (!control || phase !== 'eva') return
    event.preventDefault()
    keyboard.add(control)
  }

  function onKeyUp(event) {
    keyboard.delete(keyboardControls.get(event.code))
  }

  function onPointerDown(event) {
    if (phase !== 'eva' || !event.isPrimary || event.button !== 0) return
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY }
    canvas.focus({ preventScroll: true })
    canvas.setPointerCapture(event.pointerId)
  }

  function onPointerMove(event) {
    if (drag?.id !== event.pointerId) return
    yaw += (event.clientX - drag.x) * 0.0044
    pitch = THREE.MathUtils.clamp(pitch - (event.clientY - drag.y) * 0.0044, -LOOK_LIMIT, LOOK_LIMIT)
    drag.x = event.clientX
    drag.y = event.clientY
  }

  function endDrag(event) {
    if (drag?.id === event.pointerId) drag = null
  }

  function releaseInput() {
    drag = null
    keyboard.clear()
    touch.clear()
  }

  function onContextLoss(event) {
    event.preventDefault()
    cancelAnimationFrame(frame)
    releaseInput()
    onError('The 3D display was interrupted. Return to the landing map to restart.')
  }

  const listeners = {
    keydown: onKeyDown, keyup: onKeyUp, blur: releaseInput,
    pointerdown: onPointerDown, pointermove: onPointerMove, pointerup: endDrag,
    pointercancel: endDrag, lostpointercapture: endDrag, webglcontextlost: onContextLoss,
  }
  for (const [event, listener] of Object.entries(listeners)) canvas.addEventListener(event, listener)
  const observer = new ResizeObserver(resize)
  observer.observe(canvas)
  resize()
  onPhase(phase)
  stageFlight()
  frame = requestAnimationFrame(tick)

  return {
    skip: enterEVA,
    setMode(value) {
      mode = value
      canvas.focus({ preventScroll: true })
    },
    setDestination(value) {
      destination = value
      beacon.visible = Boolean(value)
      if (value) beacon.position.set(value.x, world.heightAt(value.x, value.z), value.z)
    },
    setControl(key, active) {
      if (active) touch.add(key)
      else touch.delete(key)
    },
    dispose() {
      cancelAnimationFrame(frame)
      observer.disconnect()
      for (const [event, listener] of Object.entries(listeners)) canvas.removeEventListener(event, listener)
      const geometries = new Set()
      const materials = new Set()
      scene.traverse((object) => {
        if (object.geometry && object.geometry !== world.realGeometry && object.geometry !== world.exterior) {
          geometries.add(object.geometry)
        }
        if (object.material) materials.add(object.material)
      })
      geometries.forEach(geometry => geometry.dispose())
      materials.forEach(material => material.dispose())
      renderer.dispose()
    },
  }
}

