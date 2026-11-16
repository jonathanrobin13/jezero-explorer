import { BufferGeometry, Float32BufferAttribute, Mesh, MeshBasicMaterial, DoubleSide } from 'three'

export function routeRibbon(world, points, overview) {
  const positions = []
  const indices = []
  const width = overview ? 100 : 0.85
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1]
    const b = points[index]
    const length = Math.hypot(b.x - a.x, b.z - a.z)
    if (!length) continue
    const steps = overview ? 1 : Math.ceil(length / 4)
    const east = (b.x - a.x) / length
    const south = (b.z - a.z) / length
    for (let step = 0; step <= steps; step++) {
      const distance = length * step / steps
      const x = a.x + east * distance
      const z = a.z + south * distance
      for (const side of [-1, 1]) {
        const px = x - south * width * side
        const pz = z + east * width * side
        const y = world.heightAt(px, pz) ?? world.heightAt(x, z) ?? 0
        positions.push(px, y + (overview ? 14 : 0.28), pz)
      }
      const end = positions.length / 3 - 1
      if (end > 1) indices.push(end - 3, end - 2, end - 1, end - 2, end, end - 1)
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  const ribbon = new Mesh(geometry, new MeshBasicMaterial({
    color: '#70ffe1', fog: false, side: DoubleSide, depthTest: !overview, depthWrite: !overview,
  }))
  ribbon.userData.overview = overview
  ribbon.visible = !overview
  return ribbon
}
