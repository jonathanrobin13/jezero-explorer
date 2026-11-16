const MARS_RADIUS_METERS = 3_396_190
const RADIANS_PER_DEGREE = Math.PI / 180
export const UV_SEARCH_RADIUS_METERS = 5_000
const MAX_NEIGHBORS = 3

export function distanceMeters(point, site) {
  const latitude = point.latitude * RADIANS_PER_DEGREE
  const siteLatitude = site.latitude * RADIANS_PER_DEGREE
  const longitudeDifference = (site.longitude - point.longitude) * RADIANS_PER_DEGREE
  const haversine = Math.sin((siteLatitude - latitude) / 2) ** 2
    + Math.cos(latitude) * Math.cos(siteLatitude) * Math.sin(longitudeDifference / 2) ** 2
  return 2 * MARS_RADIUS_METERS * Math.asin(Math.sqrt(Math.min(1, haversine)))
}

export function uvAtPoint(point, sites) {
  const ordered = sites
    .map((site) => ({ ...site, distance: distanceMeters(point, site) }))
    .sort((a, b) => a.distance - b.distance)
  const nearest = ordered[0]
  if (nearest?.distance <= 1) {
    return { kind: 'observed', wattsPerSquareMeter: nearest.meanWm2, sites: [nearest] }
  }

  const nearby = ordered
    .slice(0, MAX_NEIGHBORS)
    .filter(({ distance }) => distance <= UV_SEARCH_RADIUS_METERS)
  if (nearby.length < 2) return { kind: 'insufficient', sites: nearby, nearest }

  let weightedTotal = 0
  let totalWeight = 0
  for (const { meanWm2, distance } of nearby) {
    const weight = 1 / distance
    weightedTotal += meanWm2 * weight
    totalWeight += weight
  }
  return { kind: 'estimated', wattsPerSquareMeter: weightedTotal / totalWeight, sites: nearby }
}
