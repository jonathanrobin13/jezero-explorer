import * as THREE from 'three'

const makeMaterial = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.85 })

function mesh(parent, geometry, material, x, y, z) {
  const part = new THREE.Mesh(geometry, material)
  part.position.set(x, y, z)
  parent.add(part)
  return part
}

export function createLander() {
  const craft = new THREE.Group()
  const hatch = new THREE.Group()
  const ceramic = makeMaterial('#e9ded3')
  const red = makeMaterial('#b6472a')
  const metal = makeMaterial('#36343d')
  const glass = new THREE.MeshStandardMaterial({ color: '#83cad4', metalness: 0.55, roughness: 0.22 })
  mesh(craft, new THREE.CylinderGeometry(1.6, 2, 6.6, 24), ceramic, 0, 5.4, 0)
  mesh(craft, new THREE.ConeGeometry(1.61, 3.3, 24), red, 0, 10.35, 0)
  mesh(craft, new THREE.CylinderGeometry(1.25, 1.55, 1.8, 18), metal, 0, 1.9, 0)
  mesh(craft, new THREE.CylinderGeometry(1.65, 1.76, 0.7, 24), red, 0, 7.1, 0)
  const port = mesh(craft, new THREE.SphereGeometry(0.49, 16, 12), glass, 0, 6.2, 1.64)
  port.scale.z = 0.43
  const landingGear = []
  for (const x of [-1, 1]) {
    for (const z of [-1, 1]) {
      const gear = new THREE.Group()
      gear.position.set(x * 1.4, 2.7, z * 1.4)
      const leg = mesh(gear, new THREE.CylinderGeometry(0.13, 0.21, 2.77, 9), metal, x * 0.42, -1.25, z * 0.42)
      leg.rotation.set(-z * 0.3, 0, x * 0.3)
      mesh(gear, new THREE.CylinderGeometry(0.48, 0.58, 0.2, 12), red, x * 0.86, -2.58, z * 0.86)
      craft.add(gear)
      landingGear.push({ gear, x, z })
    }
  }

  const cabin = new THREE.MeshBasicMaterial({ color: '#c8a479' })
  mesh(craft, new THREE.BoxGeometry(1.17, 2.32, 0.32), metal, 0, 3.34, 1.77)
  mesh(craft, new THREE.PlaneGeometry(0.83, 1.78), cabin, 0, 3.34, 1.938)
  hatch.position.set(-0.52, 2.21, 1.99)
  mesh(hatch, new THREE.BoxGeometry(1.05, 2.25, 0.18), red, 0.52, 1.12, 0.04)
  craft.add(hatch)
  const ramp = new THREE.Group()
  ramp.position.set(0, 2.22, 1.96)
  mesh(ramp, new THREE.BoxGeometry(1.08, 0.1, 0.38), metal, 0, 0, 0.22)
  for (let step = 0; step < 7; step++) {
    mesh(ramp, new THREE.BoxGeometry(1.08, 0.15, 0.49), metal, 0, -0.31 * (step + 1), 0.57 * (step + 1))
  }
  ramp.visible = false
  craft.add(ramp)

  const flame = mesh(craft, new THREE.ConeGeometry(0.96, 7.5, 16), new THREE.MeshBasicMaterial({
    color: '#ffc460', transparent: true, opacity: 0.8, depthWrite: false,
  }), 0, -2.2, 0)
  flame.rotation.z = Math.PI
  const core = mesh(craft, new THREE.ConeGeometry(0.51, 6, 16), new THREE.MeshBasicMaterial({
    color: '#f5fbff', transparent: true, opacity: 0.93, depthWrite: false,
  }), 0, -1.8, 0)
  core.rotation.z = Math.PI

  function deployGear(deployment) {
    for (const { gear, x, z } of landingGear) {
      gear.rotation.set(z * (1 - deployment) * 0.68, 0, -x * (1 - deployment) * 0.68)
    }
  }

  function openAirlock(progress) {
    hatch.rotation.y = -Math.min(1, progress * 1.5) * 2.38
    ramp.visible = progress > 0.1
    ramp.rotation.x = -(1 - progress) * 1.65
  }

  function throttle(power, time) {
    flame.visible = core.visible = power > 0
    flame.scale.y = power * (0.92 + 0.11 * Math.sin(time * 39))
    core.scale.y = power * (0.9 + 0.12 * Math.sin(time * 50))
  }

  return { craft, deployGear, openAirlock, throttle }
}

export function createAstronaut() {
  const suit = new THREE.Group()
  const ceramic = makeMaterial('#eff3e9')
  const trim = makeMaterial('#464351')
  const orange = makeMaterial('#d96636')
  const visor = new THREE.MeshStandardMaterial({ color: '#382818', metalness: 0.55, roughness: 0.22 })
  const straps = new THREE.BoxGeometry(0.39, 0.46, 0.27)
  mesh(suit, straps, ceramic, 0, 1.12, 0)
  mesh(suit, new THREE.BoxGeometry(0.36, 0.43, 0.16), trim, 0, 1.17, -0.17)
  mesh(suit, new THREE.BoxGeometry(0.29, 0.08, 0.04), orange, 0, 1.16, 0.153)
  mesh(suit, new THREE.BoxGeometry(0.115, 0.154, 0.065), trim, -0.06, 1.19, 0.167)
  mesh(suit, new THREE.BoxGeometry(0.1, 0.043, 0.075), new THREE.MeshBasicMaterial({ color: '#8af8d6' }), -0.06, 1.22, 0.175)
  const head = new THREE.Group()
  head.position.y = 1.53
  suit.add(head)
  mesh(head, new THREE.SphereGeometry(0.205, 16, 12), ceramic, 0, 0, 0)
  const face = mesh(head, new THREE.SphereGeometry(0.16, 16, 12), visor, 0, 0, 0.121)
  face.scale.set(1, 0.75, 0.62)

  function limb(x, y, length, radius) {
    const joint = new THREE.Group()
    joint.position.set(x, y, 0)
    suit.add(joint)
    mesh(joint, new THREE.CapsuleGeometry(radius, length, 4, 8), ceramic, 0, -length / 2, 0)
    mesh(joint, new THREE.BoxGeometry(radius * 1.9, 0.12, radius * 3.4), trim, 0, -length, 0.03)
    return joint
  }

  const arms = [limb(-0.27, 1.32, 0.41, 0.073), limb(0.27, 1.32, 0.41, 0.073)]
  const legs = [limb(-0.13, 0.96, 0.84, 0.112), limb(0.13, 0.96, 0.84, 0.112)]

  function pose(stride, turn, scan = 0) {
    arms[0].rotation.x = stride * 0.65 - scan * 0.68
    arms[1].rotation.x = -stride * 0.65 - scan * 0.41
    legs[0].rotation.x = -stride
    legs[1].rotation.x = stride
    head.rotation.y = turn
    head.rotation.x = scan * 0.24
  }
  suit.visible = false
  return { suit, pose }
}

export function createSky(sunDirection) {
  return new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      zenith: { value: new THREE.Color('#644542') },
      horizon: { value: new THREE.Color('#cc947b') },
      sunDirection: { value: sunDirection },
    },
    vertexShader: `
      varying vec3 direction;
      void main() {
        direction = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 zenith;
      uniform vec3 horizon;
      uniform vec3 sunDirection;
      varying vec3 direction;
      void main() {
        vec3 ray = normalize(direction);
        float sky = pow(clamp(ray.y + 0.035, 0.0, 1.0), 0.47);
        float solar = max(dot(ray, sunDirection), 0.0);
        vec3 color = mix(horizon, zenith, sky);
        color += vec3(0.21, 0.34, 0.48) * pow(solar, 28.0);
        color += vec3(1.0, 0.81, 0.69) * smoothstep(0.99988, 0.99996, solar);
        gl_FragColor = vec4(color, 1.0);
        #include <colorspace_fragment>
      }
    `,
  }))
}

export function createGroundMaterial(color, map) {
  const material = new THREE.MeshLambertMaterial({ color, map })
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 terrainPoint;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nterrainPoint = position;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 terrainPoint;
        float gritHash(vec2 p) {
          vec3 d = fract(vec3(p.xyx) * 0.1031);
          d += dot(d, d.yzx + 33.33);
          return fract((d.x + d.y) * d.z);
        }
        float gritNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f*f*(3.0 - 2.0*f);
          return mix(mix(gritHash(i), gritHash(i + vec2(1, 0)), u.x),
            mix(gritHash(i + vec2(0, 1)), gritHash(i + 1.0), u.x), u.y);
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 p = terrainPoint.xz;
        float pixel = length(fwidth(p));
        float soilVariation = gritNoise(p * 0.043);
        float gravel = gritNoise(p * 0.72) - 0.5;
        float grains = gritNoise(p * 9.0) - 0.5;
        float drift = sin(dot(p, vec2(0.89, 0.37)) + 7.0 * gritNoise(p * 0.137));
        float detail = 0.48 * gravel * (1.0 - smoothstep(0.28, 1.45, pixel))
          + 0.18 * grains * (1.0 - smoothstep(0.04, 0.14, pixel))
          + 0.13 * drift * (1.0 - smoothstep(0.3, 1.2, pixel));
        float reliefTone = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
        vec3 regolith = mix(vec3(0.055, 0.021, 0.009), vec3(0.26, 0.115, 0.048), clamp(soilVariation * 0.7 + reliefTone * 0.42, 0.0, 1.0));
        diffuseColor = vec4(regolith * (0.92 + detail), 1.0);`)
  }
  return material
}

export function createSurfaceMarkers(world) {
  const { real, realX, realZ, heightAt } = world
  const edge = [
    ...realX.map(x => [x, real.zMin]),
    ...realZ.slice(1).map(z => [real.xMax, z]),
    ...realX.slice(0, -1).reverse().map(x => [x, real.zMax]),
    ...realZ.slice(1, -1).reverse().map(z => [real.xMin, z]),
  ].map(([x, z]) => [x, (heightAt(x, z) ?? 0) + 2.4, z])
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(edge.flat(), 3))
  const marker = new THREE.LineLoop(geometry, new THREE.LineBasicMaterial({ color: '#73fff0' }))
  const postLocations = edge.filter((_, index) => index % 8 === 0)
  const posts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.8, 1.05, 5, 7),
    new THREE.MeshBasicMaterial({ color: '#73fff0' }), postLocations.length)
  const transform = new THREE.Matrix4()
  postLocations.forEach(([x, y, z], index) => {
    posts.setMatrixAt(index, transform.makeTranslation(x, y, z))
  })
  const group = new THREE.Group()
  group.add(marker, posts)
  return group
}

export function createScienceMarkers(world, bounds, features = []) {
  const group = new THREE.Group()
  const materials = {
    mineral: new THREE.MeshBasicMaterial({ color: '#67e8f9', transparent: true, opacity: 0.88 }),
    water: new THREE.MeshBasicMaterial({ color: '#7dd3fc', transparent: true, opacity: 0.88 }),
  }
  const ringGeometry = new THREE.TorusGeometry(3.2, 0.28, 6, 24)
  const poleGeometry = new THREE.CylinderGeometry(0.12, 0.2, 4.5, 7)
  const iconGeometry = new THREE.OctahedronGeometry(0.9, 0)

  for (const feature of features) {
    const u = (feature.longitude - bounds.west) / (bounds.east - bounds.west)
    const v = (bounds.north - feature.latitude) / (bounds.north - bounds.south)
    const point = world.groundPosition(u, v)
    const height = world.heightAt(point.x, point.z)
    if (height === null) continue

    const marker = new THREE.Group()
    const material = materials[feature.kind === 'water' ? 'water' : 'mineral']
    const ring = new THREE.Mesh(ringGeometry, material)
    ring.rotation.x = -Math.PI / 2
    ring.position.y = 0.35
    marker.add(ring)
    const pole = new THREE.Mesh(poleGeometry, material)
    pole.position.y = 2.6
    marker.add(pole)
    const icon = new THREE.Mesh(iconGeometry, material)
    icon.position.y = 5.2
    marker.add(icon)
    marker.position.set(point.x, height, point.z)
    marker.userData.scienceFeatureId = feature.id
    group.add(marker)
  }

  group.userData.disposeGeometries = [ringGeometry, poleGeometry, iconGeometry]
  return group
}

export function createOverviewLabels(world, bounds, landmarks) {
  const group = new THREE.Group()
  group.visible = false
  for (const landmark of landmarks) {
    const u = (landmark.longitude - bounds.west) / (bounds.east - bounds.west)
    const v = (bounds.north - landmark.latitude) / (bounds.north - bounds.south)
    const { x, z } = world.groundPosition(u, v)
    if (x < world.play.xMin || x > world.play.xMax || z < world.play.zMin || z > world.play.zMax) continue
    const height = world.heightAt(x, z)
    if (height === null) continue
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (!context) continue
    const label = landmark.name ?? landmark.title
    context.font = '600 27px system-ui'
    canvas.width = Math.ceil(context.measureText(label).width + 26)
    canvas.height = 46
    context.fillStyle = '#172a36ee'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.font = '600 27px system-ui'
    context.fillStyle = landmark.kind === 'water' ? '#92e1ff' : '#e2f9fb'
    context.fillText(label, 13, 31)
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, depthWrite: false, fog: false }))
    sprite.position.set(x, height + 30, z)
    sprite.scale.set(canvas.width * 9, canvas.height * 9, 1)
    sprite.renderOrder = 3
    group.add(sprite)
  }
  return group
}

export function createEndpointMarker(color) {
  const pin = new THREE.Mesh(new THREE.RingGeometry(120, 235, 30), new THREE.MeshBasicMaterial({
    color, depthTest: false, depthWrite: false, side: THREE.DoubleSide, fog: false,
  }))
  pin.rotation.x = -Math.PI / 2
  pin.renderOrder = 2
  pin.visible = false
  return pin
}

export function createBeacon() {
  const marker = new THREE.Group()
  const material = new THREE.MeshBasicMaterial({ color: '#69ffe6', transparent: true, opacity: 0.76, depthWrite: false })
  const ring = mesh(marker, new THREE.TorusGeometry(9, 0.45, 7, 36), material, 0, 1, 0)
  ring.rotation.x = Math.PI / 2
  mesh(marker, new THREE.CylinderGeometry(0.9, 2.2, 210, 10, 1, true), material, 0, 105, 0)
  marker.visible = false
  return marker
}

export function createRocks(world, landing, exit) {
  const rock = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), makeMaterial('#fff4e5'), 900)
  const transform = new THREE.Object3D()
  const color = new THREE.Color()
  let seed = 39136
  function random() {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0
    return seed / 4294967296
  }
  for (let index = 0; index < rock.count; index++) {
    const radius = 5 + Math.sqrt(random()) * 100
    const angle = random() * Math.PI * 2
    const nearby = index < 195
    const x = nearby ? landing.x + radius * Math.cos(angle) : THREE.MathUtils.lerp(world.play.xMin, world.play.xMax, random())
    const z = nearby ? landing.z + radius * Math.sin(angle) : THREE.MathUtils.lerp(world.play.zMin, world.play.zMax, random())
    const size = nearby ? 0.12 + random() ** 3 * 1.6 : 0.32 + random() ** 4 * 6
    const y = world.heightAt(x, z)
    const alongRamp = (x - landing.x) * exit.x + (z - landing.z) * exit.z
    const acrossRamp = (x - landing.x) * exit.z - (z - landing.z) * exit.x
    const egressLane = alongRamp >= -1 && alongRamp < 20 && Math.abs(acrossRamp) < 2.4
    transform.position.set(x, y === null || egressLane ? -3000 : y - size * 0.12, z)
    transform.scale.set(size, size * 0.68, size * 0.84)
    transform.rotation.set(random(), random() * Math.PI, random())
    transform.updateMatrix()
    rock.setMatrixAt(index, transform.matrix)
    rock.setColorAt(index, color.setHSL(0.039 + 0.05 * random(), 0.23 + 0.33 * random(), 0.24 + 0.2 * random()))
  }
  return rock
}
