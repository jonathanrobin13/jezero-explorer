import { calculateDirectUvExposure, marsSunDirection } from './solarUv.js'

self.onmessage = ({ data: { grid, samples, utc } }) => {
  try {
    const { bounds } = grid
    const latitude = (bounds.north + bounds.south) / 2
    const longitude = (bounds.east + bounds.west) / 2
    const sun = marsSunDirection(utc, latitude, longitude)
    const exposure = calculateDirectUvExposure(grid, samples, sun)
    self.postMessage({ exposure }, [exposure.buffer])
  } catch (error) {
    self.postMessage({ error: error.message })
  }
}
