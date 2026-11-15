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
  for (const x of [-1, 1]) {
    for (const z of [-1, 1]) {
      const leg = mesh(craft, new THREE.CylinderGeometry(0.14, 0.25, 2.8, 9), metal, x * 1.78, 1.27, z * 1.78)
      leg.rotation.set(-z * 0.38, 0, x * 0.38)
      mesh(craft, new THREE.CylinderGeometry(0.48, 0.58, 0.2, 12), red, x * 2.35, 0.16, z * 2.35)
    }
  }

  mesh(craft, new THREE.BoxGeometry(1.17, 2.32, 0.32), metal, 0, 3.34, 1.77)
  hatch.position.set(0, 2.21, 1.96)
  mesh(hatch, new THREE.BoxGeometry(1.05, 2.25, 0.18), red, 0, 1.12, 0)
  craft.add(hatch)
  const ramp = new THREE.Group()
  for (let step = 0; step < 7; step++) {
    mesh(ramp, new THREE.BoxGeometry(1.08, 0.15, 0.5), metal, 0, 2.05 - step * 0.31, 2.05 + step * 0.56)
  }
  ramp.visible = false
  craft.add(ramp)

  const flame = mesh(craft, new THREE.ConeGeometry(0.96, 7.5, 16), new THREE.MeshBasicMaterial({
    color: '#ffc460', transparent: true, opacity: 0.8, depthWrite: false,
  }), 0, -2.2, 0)
  flame.rotation.z = Math.PI
  return { craft, hatch, ramp, flame }
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

  function pose(stride, turn) {
    arms[0].rotation.x = stride * 0.65
    arms[1].rotation.x = -stride * 0.65
    legs[0].rotation.x = -stride
    legs[1].rotation.x = stride
    head.rotation.y = turn
  }
  suit.visible = false
  return { suit, pose }
}

export function createSky(sunDirection) {
  return new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      zenith: { value: new THREE.Color('#392939') },
      horizon: { value: new THREE.Color('#be846b') },
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
        float sky = pow(clamp(ray.y + 0.05, 0.0, 1.0), 0.52);
        float solar = max(dot(ray, sunDirection), 0.0);
        vec3 color = mix(horizon, zenith, sky);
        color += vec3(0.65, 0.24, 0.09) * pow(solar, 14.0);
        color += vec3(1.0, 0.73, 0.44) * smoothstep(0.9992, 0.99975, solar);
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
      .replace('#include <common>', '#include <common>\nvarying vec3 terrainPoint;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float dust = sin(terrainPoint.x * 0.61 + sin(terrainPoint.z * 0.23))
          * sin(terrainPoint.z * 0.89 + sin(terrainPoint.x * 1.21));
        float strata = sin((terrainPoint.y + terrainPoint.x * 0.08) * 0.39);
        diffuseColor.rgb *= 0.96 + 0.115 * dust + 0.085 * strata;`)
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

export function createBeacon() {
  const marker = new THREE.Group()
  const material = new THREE.MeshBasicMaterial({ color: '#69ffe6', transparent: true, opacity: 0.76, depthWrite: false })
  const ring = mesh(marker, new THREE.TorusGeometry(9, 0.45, 7, 36), material, 0, 1, 0)
  ring.rotation.x = Math.PI / 2
  mesh(marker, new THREE.CylinderGeometry(0.9, 2.2, 210, 10, 1, true), material, 0, 105, 0)
  marker.visible = false
  return marker
}

export function createRocks(world, landing) {
  const rock = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), makeMaterial('#915540'), 600)
  const transform = new THREE.Object3D()
  let seed = 39136
  function random() {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0
    return seed / 4294967296
  }
  for (let index = 0; index < rock.count; index++) {
    const radius = 16 + Math.sqrt(random()) * 420
    const angle = random() * Math.PI * 2
    const nearby = index < 135
    const x = nearby ? landing.x + radius * Math.cos(angle) : THREE.MathUtils.lerp(world.play.xMin, world.play.xMax, random())
    const z = nearby ? landing.z + radius * Math.sin(angle) : THREE.MathUtils.lerp(world.play.zMin, world.play.zMax, random())
    const size = (0.32 + random() ** 3 * 3.6) * (nearby ? 1 : 3)
    const y = world.heightAt(x, z)
    transform.position.set(x, y === null ? -3000 : y - size * 0.12, z)
    transform.scale.set(size, size * 0.68, size * 0.84)
    transform.rotation.set(random(), random() * Math.PI, random())
    transform.updateMatrix()
    rock.setMatrixAt(index, transform.matrix)
  }
  return rock
}
