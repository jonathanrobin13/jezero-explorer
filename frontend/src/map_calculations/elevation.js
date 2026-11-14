export async function loadElevationGrid() {
  const url = new URL(
    `${import.meta.env.BASE_URL}data/map/CTX/jezero-elevation.json`,
    document.baseURI,
  )

  const metadataResponse = await fetch(url)
  if (!metadataResponse.ok) throw new Error('Could not load elevation metadata')
  const grid = await metadataResponse.json()

  const dataResponse = await fetch(new URL(grid.file, url))
  if (!dataResponse.ok) throw new Error('Could not load elevation samples')
  const samples = new DataView(await dataResponse.arrayBuffer())

  if (samples.byteLength !== grid.width * grid.height * 4) {
    throw new Error('Elevation file size does not match the grid dimensions')
  }

  return function elevationAt(latitude, longitude) {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null

    const column = Math.floor((longitude - grid.west) / grid.degreesPerColumn)
    const row = Math.floor((grid.north - latitude) / grid.degreesPerRow)

    if (column < 0 || column >= grid.width || row < 0 || row >= grid.height) {
      return null
    }

    const offset = (row * grid.width + column) * 4
    const meters = samples.getFloat32(offset, true)
    return Number.isFinite(meters) ? meters : null
  }
}