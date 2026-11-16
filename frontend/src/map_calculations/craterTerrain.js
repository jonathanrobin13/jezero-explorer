export async function loadCraterElevations(grid, url, signal) {
  const response = await fetch(new URL(grid.file, url), { signal })
  if (!response.ok) throw new Error('Could not load the CTX crater terrain.')
  const binary = new DataView(await response.arrayBuffer())
  if (binary.byteLength !== grid.width * grid.height * 4) {
    throw new Error('The DEM dimensions do not match its samples.')
  }
  return Float32Array.from({ length: grid.width * grid.height }, (_, index) => (
    binary.getFloat32(index * 4, true)
  ))
}
