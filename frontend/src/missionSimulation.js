import * as THREE from 'three'
import {
  createAstronaut, createBeacon, createEndpointMarker, createGroundMaterial, createLander, createOverviewLabels,
  createRocks, createScienceMarkers, createSky, createSurfaceMarkers,
} from './missionSceneObjects.js'
import { routeRibbon } from './missionRouteRibbon.js'

const LANDING_SECONDS = 7.3
const TOUCHDOWN_SECONDS = 1.7
const EGRESS_SECONDS = 7.2
const LOOK_LIMIT = 1.38
const radiansToDegrees = THREE.MathUtils.radToDeg

const keyboardControls = new Map([
  ['KeyW', 'forward'], ['KeyS', 'back'], ['KeyA', 'left'], ['KeyD', 'right'],
  ['ArrowLeft', 'turnLeft'], ['ArrowRight', 'turnRight'], ['ArrowUp', 'lookUp'], ['ArrowDown', 'lookDown'],
])

export function startMissionScene({ canvas, world, texture, landing, bounds, scienceFeatures, landmarks = [], onPhase, onTelemetry, onMapPick, onError }) {
  const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)')
  let renderer
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  } catch {
    throw new Error('Could not start WebGL 2 for the astronaut mission. Try a browser with hardware acceleration.')
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1))
  const scene = new THREE.Scene()
  scene.fog = new THREE.FogExp2('#cc947b', 0.000145)
  const camera = new THREE.PerspectiveCamera(68, 1, 0.28, 120000)
  camera.rotation.order = 'YXZ'
  const sunDirection = new THREE.Vector3(-0.62, 0.25, -0.65).normalize()
  const sky = createSky(sunDirection)
  sky.scale.setScalar(35000)
  sky.renderOrder = -100
  sky.frustumCulled = false
  scene.add(sky)
  const sun = new THREE.DirectionalLight('#ffe4c9', 1.9)
  sun.position.copy(sunDirection).multiplyScalar(1000)
  scene.add(new THREE.HemisphereLight('#f7d5bc', '#8e4b35', 1.12), sun)

  if (texture) {
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
  }
  const { craft, deployGear, openAirlock, throttle } = createLander()
  const { suit, pose } = createAstronaut()
  const beacon = createBeacon()
  scene.add(craft, suit, beacon)

  const exhaustPositions = new Float32Array(220 * 3)
  const exhaustGeometry = new THREE.BufferGeometry()
  exhaustGeometry.setAttribute('position', new THREE.BufferAttribute(exhaustPositions, 3))
  const exhaustMaterial = new THREE.PointsMaterial({
    color: '#d7976d', size: 3.5, transparent: true, opacity: 0.4, depthWrite: false,
  })
  exhaustMaterial.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <alphamap_fragment>', `#include <alphamap_fragment>
      diffuseColor.a *= 1.0 - smoothstep(0.0, 0.5, length(gl_PointCoord - 0.5));`)
  }
  const exhaust = new THREE.Points(exhaustGeometry, exhaustMaterial)
  exhaust.frustumCulled = false
  scene.add(exhaust)

  const landingHeight = world.heightAt(landing.x, landing.z)
  const exitHeading = Math.atan2(-landing.x, -landing.z)
  const exitX = Math.sin(exitHeading)
  const exitZ = Math.cos(exitHeading)
  const sideX = exitZ
  const sideZ = -exitX
  const surfaces = [
    new THREE.Mesh(world.realGeometry, createGroundMaterial(texture ? '#cf9a77' : '#a66d54', texture)),
    new THREE.Mesh(world.exterior, createGroundMaterial('#98604d', null)),
  ]
  const science = createScienceMarkers(world, bounds, scienceFeatures)
  const labels = createOverviewLabels(world, bounds, landmarks)
  const routeGroup = new THREE.Group()
  const startMarker = createEndpointMarker('#ffd381')
  const finishMarker = createEndpointMarker('#8af5e4')
  scene.add(...surfaces, science, labels, routeGroup, startMarker, finishMarker,
    createSurfaceMarkers(world),
    createRocks(world, landing, { x: exitX, z: exitZ }),
  )
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
  let planning = false
  let mapBlend = 0
  let needsRender = true
  const eye = new THREE.Vector3()
  const eyeAngles = new THREE.Euler(0, 0, 0, 'YXZ')
  const eyeRotation = new THREE.Quaternion()
  const mapRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0))
  const overhead = new THREE.Vector3()
  const ray = new THREE.Raycaster()
  const pointer = new THREE.Vector2()

  function notify() {
    onTelemetry({
      ...world.telemetry(position.x, position.z),
      ...position,
      heading: (radiansToDegrees(yaw) % 360 + 360) % 360,
      speed,
      atLimit,
      distanceFromLander: Math.hypot(position.x - landing.x, position.z - landing.z),
    })
  }

  function enterEVA() {
    if (phase === 'eva') return
    const x = landing.x + exitX * 14
    const z = landing.z + exitZ * 14
    if (world.heightAt(x, z) !== null) Object.assign(position, { x, z })
    phase = 'eva'
    craft.position.set(landing.x, landingHeight, landing.z)
    craft.rotation.set(0, exitHeading, 0)
    deployGear(1)
    openAirlock(1)
    suit.visible = false
    throttle(0, 0)
    exhaust.visible = false
    onPhase(phase)
    notify()
    canvas.focus({ preventScroll: true })
  }

  function updateDust(growth, opacity) {
    exhaust.visible = opacity > 0
    exhaustMaterial.opacity = opacity
    for (let index = 0; index < exhaustPositions.length / 3; index++) {
      const spread = ((index * 0.178) % 1) ** 0.72
      const radius = 1 + spread * (12 + growth * 40)
      const angle = index * 2.39996 + growth * 0.32
      const x = landing.x + Math.sin(angle) * radius
      const z = landing.z + Math.cos(angle) * radius
      exhaustPositions[index * 3] = x
      exhaustPositions[index * 3 + 1] = (world.heightAt(x, z) ?? landingHeight) + 0.5 + (1 - spread) * (2.4 + growth * 2)
      exhaustPositions[index * 3 + 2] = z
    }
    exhaustGeometry.attributes.position.needsUpdate = true
  }

  function stageFlight() {
    const t = Math.min(1, elapsed / LANDING_SECONDS)
    const remaining = (1 - t) ** 2.45
    const altitude = 176 * remaining
    const lateral = 64 * remaining
    craft.position.set(landing.x - exitX * lateral, landingHeight + altitude, landing.z - exitZ * lateral)
    craft.rotation.set(-0.16 * remaining, exitHeading, 0.1 * remaining)
    deployGear(THREE.MathUtils.smoothstep(t, 0.18, 0.53))
    throttle(t < 1 ? 0.76 + 0.28 * (1 - t) : 0, elapsed)
    updateDust(t * 0.64, 0.48 * THREE.MathUtils.smoothstep(t, 0.52, 0.95))
    const range = THREE.MathUtils.lerp(98, 24, t)
    const cameraX = landing.x + sideX * range + exitX * 15
    const cameraZ = landing.z + sideZ * range + exitZ * 15
    camera.position.set(cameraX, Math.max(landingHeight, world.heightAt(cameraX, cameraZ) ?? landingHeight)
      + 5.4 + altitude * 0.56, cameraZ)
    camera.lookAt(craft.position.x, craft.position.y + 4.5, craft.position.z)

    if (t === 1) {
      phase = 'touchdown'
      elapsed = 0
      onPhase(phase)
    }
  }

  function stageTouchdown() {
    const t = Math.min(1, elapsed / TOUCHDOWN_SECONDS)
    updateDust(0.64 + t * 0.72, 0.48 * (1 - t))
    const range = 24 - 7 * t
    const cameraX = landing.x + sideX * range + exitX * (15 - 3 * t)
    const cameraZ = landing.z + sideZ * range + exitZ * (15 - 3 * t)
    camera.position.set(cameraX, Math.max(landingHeight, world.heightAt(cameraX, cameraZ) ?? landingHeight) + 5.4, cameraZ)
    camera.lookAt(landing.x, landingHeight + 4 - t, landing.z)
    if (t === 1) {
      phase = 'egress'
      elapsed = 0
      onPhase(phase)
    }
  }

  function stageEgress() {
    openAirlock(THREE.MathUtils.smoothstep(elapsed, 0.1, 1.45))
    suit.visible = elapsed >= 1.4
    const progress = THREE.MathUtils.clamp((elapsed - 1.4) / 4.05, 0, 1)
    const distance = 1.96 + progress * 12.04
    const x = landing.x + exitX * distance
    const z = landing.z + exitZ * distance
    const y = world.heightAt(x, z) ?? landingHeight
    const rampY = landingHeight + 2.23 - (distance - 1.96) * 0.546
    const stride = progress > 0 && progress < 1 ? Math.sin(elapsed * 12) * 0.51 : 0
    const scan = Math.max(0, Math.sin((elapsed - 5.45) * 1.75))
    suit.position.set(x, THREE.MathUtils.lerp(rampY, y, THREE.MathUtils.smoothstep(distance, 5.3, 6.2))
      + Math.abs(stride) * 0.055, z)
    pose(stride, elapsed >= 5.45 ? Math.sin((elapsed - 5.45) * 3.1) * 0.86 : 0, elapsed >= 5.45 ? scan : 0)
    const cameraX = x + sideX * (10.4 - progress * 7.3) + exitX * (5.8 - progress * 2.4)
    const cameraZ = z + sideZ * (10.4 - progress * 7.3) + exitZ * (5.8 - progress * 2.4)
    camera.position.set(cameraX, Math.max(y, world.heightAt(cameraX, cameraZ) ?? y) + 2.4, cameraZ)
    camera.lookAt(x - exitX * (1 - progress) * 3, suit.position.y + 1.24, z - exitZ * (1 - progress) * 3)
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
    const bob = !motionPreference.matches && mode === 'walk' && speed > 0 ? Math.sin(elapsed * 13) * 0.046 : 0
    camera.position.set(position.x, world.heightAt(position.x, position.z) + (driving ? 2.45 : 1.67) + bob, position.z)
    camera.rotation.set(pitch, -yaw, 0)
    if (destination) beacon.scale.setScalar(motionPreference.matches ? 1 : 1 + Math.sin(elapsed * 2.5) * 0.07)
  }

  function updateView(dt, frameSeconds) {
    if (!planning && !mapBlend) {
      move(dt)
      return
    }
    speed = 0
    const step = motionPreference.matches ? 1 : Math.min(0.25, frameSeconds) / 1.25
    mapBlend = THREE.MathUtils.clamp(mapBlend + (planning ? step : -step), 0, 1)
    const blend = THREE.MathUtils.smootherstep(mapBlend, 0, 1)
    scene.fog.density = 0.000145 * (1 - blend)
    routeGroup.children.forEach(mesh => { mesh.visible = mesh.userData.overview ? mapBlend > 0.55 : mapBlend <= 0.55 })
    labels.visible = science.visible && mapBlend > 0.95
    science.children.forEach(marker => marker.scale.setScalar(1 + 85 * blend))
    camera.near = 0.28 + blend * 30
    camera.updateProjectionMatrix()
    if (!blend) {
      move(0)
      return
    }
    const { xMin, xMax, zMin, zMax } = world.play
    const tangent = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
    const altitude = Math.max((xMax - xMin) / camera.aspect, zMax - zMin) / (2 * tangent) * 1.2
    overhead.set((xMin + xMax) / 2, Math.min(altitude, 104000), (zMin + zMax) / 2)
    eye.set(position.x, world.heightAt(position.x, position.z) + (mode === 'buggy' ? 2.45 : 1.67), position.z)
    eyeRotation.setFromEuler(eyeAngles.set(pitch, -yaw, 0))
    camera.position.copy(eye).lerp(overhead, blend)
    camera.quaternion.copy(eyeRotation).slerp(mapRotation, blend)
  }

  function clearRoute() {
    for (const mesh of [...routeGroup.children]) {
      mesh.geometry.dispose()
      mesh.material.dispose()
      routeGroup.remove(mesh)
    }
  }

  function placeMarker(marker, point) {
    marker.visible = Boolean(point)
    if (point) marker.position.set(point.x, world.heightAt(point.x, point.z) ?? 0, point.z)
  }

  function tick(now) {
    const frameSeconds = (now - lastFrame) / 1000
    const dt = Math.min(0.08, frameSeconds)
    lastFrame = now
    elapsed += phase === 'eva' ? dt : Math.min(0.5, frameSeconds)
    const rendering = phase !== 'eva' || needsRender || keyboard.size || touch.size
      || (planning ? mapBlend < 1 : mapBlend > 0)
    if (phase === 'landing') stageFlight()
    else if (phase === 'touchdown') stageTouchdown()
    else if (phase === 'egress') stageEgress()
    else {
      updateView(dt, frameSeconds)
      if (now - lastUpdate > 125) {
        lastUpdate = now
        notify()
      }
    }
    if (rendering) {
      needsRender = false
      sky.position.copy(camera.position)
      renderer.render(scene, camera)
    }
    frame = requestAnimationFrame(tick)
  }

  function resize() {
    const { clientWidth, clientHeight } = canvas
    if (!clientWidth || !clientHeight) return
    renderer.setSize(clientWidth, clientHeight, false)
    camera.aspect = clientWidth / clientHeight
    camera.updateProjectionMatrix()
    needsRender = true
  }

  function onKeyDown(event) {
    const control = keyboardControls.get(event.code)
    if (!control || phase !== 'eva' || planning || mapBlend) return
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
    if (planning || mapBlend) return
    needsRender = true
    yaw += (event.clientX - drag.x) * 0.0044
    pitch = THREE.MathUtils.clamp(pitch - (event.clientY - drag.y) * 0.0044, -LOOK_LIMIT, LOOK_LIMIT)
    drag.x = event.clientX
    drag.y = event.clientY
  }

  function endDrag(event) {
    if (drag?.id !== event.pointerId) return
    const picked = Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 7
    drag = null
    if (!planning || mapBlend < 0.97 || !picked || event.type !== 'pointerup') return
    const rect = canvas.getBoundingClientRect()
    pointer.set(2 * (event.clientX - rect.left) / rect.width - 1, 1 - 2 * (event.clientY - rect.top) / rect.height)
    ray.setFromCamera(pointer, camera)
    const hit = ray.intersectObjects(surfaces, false)[0]?.point
    if (hit && hit.x >= world.play.xMin && hit.x <= world.play.xMax
      && hit.z >= world.play.zMin && hit.z <= world.play.zMax) onMapPick?.({ x: hit.x, z: hit.z })
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
      needsRender = true
      canvas.focus({ preventScroll: true })
    },
    setDestination(value) {
      destination = value
      needsRender = true
      beacon.visible = Boolean(value)
      if (value) beacon.position.set(value.x, world.heightAt(value.x, value.z), value.z)
    },
    setPlanning(value) {
      planning = value
      needsRender = true
      releaseInput()
      if (!value) {
        startMarker.visible = false
        finishMarker.visible = false
        canvas.focus({ preventScroll: true })
      }
    },
    setPlanningPoints(start, finish) {
      needsRender = true
      placeMarker(startMarker, start)
      placeMarker(finishMarker, finish)
    },
    setScienceVisibility(value) {
      needsRender = true
      science.visible = value
    },
    setRoute(points) {
      needsRender = true
      clearRoute()
      if (points?.length > 1) routeGroup.add(routeRibbon(world, points, false), routeRibbon(world, points, true))
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
      labels.children.forEach(sprite => sprite.material.map.dispose())
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

