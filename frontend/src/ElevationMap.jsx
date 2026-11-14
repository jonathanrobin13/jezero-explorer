import { useEffect, useRef, useState } from 'react'

const ctxUrl = new URL(
  `${import.meta.env.BASE_URL}data/map/CTX/`,
  document.baseURI,
)

async function fetchFile(url, signal) {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`Could not load ${url}`)
  return response
}

function HeatLayer({ bounds }) {
  const canvasRef = useRef(null)
  const [layer, setLayer] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    const controller = new AbortController()
    const { signal } = controller

    async function load() {
      const url = new URL('jezero-elevation.json', ctxUrl)
      const grid = await (await fetchFile(url, signal)).json()
      const response = await fetchFile(new URL(grid.file, url), signal)
      const samples = new DataView(await response.arrayBuffer())
      const count = grid.width * grid.height

      if (samples.byteLength !== count * 4) {
        throw new Error('Elevation file size does not match the grid.')
      }

      let low = Infinity
      let high = -Infinity

      for (let cell = 0; cell < count; cell++) {
        const meters = samples.getFloat32(cell * 4, true)
        if (!Number.isFinite(meters)) continue
        low = Math.min(low, meters)
        high = Math.max(high, meters)
      }

      if (!Number.isFinite(low)) throw new Error('No elevation data in this area.')

      const colors = new ImageData(grid.width, grid.height)
      for (let cell = 0; cell < count; cell++) {
        const offset = cell * 4
        const meters = samples.getFloat32(offset, true)
        if (!Number.isFinite(meters)) continue

        const t = (meters - low) / (high - low || 1)
        colors.data[offset] = 32 + 221 * t
        colors.data[offset + 1] = 76 + 138 * t
        colors.data[offset + 2] = 145 - 68 * t
        colors.data[offset + 3] = 160
      }

      if (!signal.aborted) setLayer({ grid, colors, low, high })
    }

    load().catch((error) => {
      if (!signal.aborted) setError(error.message)
    })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (layer) {
      canvasRef.current.getContext('2d').putImageData(layer.colors, 0, 0)
    }
  }, [layer])

  if (error) return <p role="alert">{error}</p>
  if (!layer) return <p role="status">Loading elevation…</p>

  const { grid, low, high } = layer
  const longitudeSpan = bounds.east - bounds.west
  const latitudeSpan = bounds.north - bounds.south

  return (
    <>
      <canvas
        ref={canvasRef}
        width={grid.width}
        height={grid.height}
        role="img"
        aria-label="Elevation overlay. Blue is lower and gold is higher."
        className="pointer-events-none absolute"
        style={{
          left: `${100 * (grid.west - bounds.west) / longitudeSpan}%`,
          top: `${100 * (bounds.north - grid.north) / latitudeSpan}%`,
          width: `${100 * grid.width * grid.degreesPerColumn / longitudeSpan}%`,
          height: `${100 * grid.height * grid.degreesPerRow / latitudeSpan}%`,
        }}
      />
      <div className="absolute bottom-3 left-3 rounded bg-slate-950/90 p-2 text-sm text-white">
        <div>Elevation (m)</div>
        <div
          className="my-1 h-2 w-36 rounded"
          style={{ background: 'linear-gradient(to right, #204c91, #fdd64d)' }}
        />
        <div className="flex justify-between">
          <span>{Math.round(low).toLocaleString()}</span>
          <span>{Math.round(high).toLocaleString()}</span>
        </div>
      </div>
    </>
  )
}

export default function ElevationMap() {
  const [map, setMap] = useState(null)
  const [error, setError] = useState(null)
  const [showElevation, setShowElevation] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    const { signal } = controller

    fetchFile(new URL('jezero-ctx.json', ctxUrl), signal)
      .then((response) => response.json())
      .then((metadata) => {
        if (!signal.aborted) setMap(metadata)
      })
      .catch((error) => {
        if (!signal.aborted) setError(error.message)
      })

    return () => controller.abort()
  }, [])

  if (error) return <p role="alert">{error}</p>
  if (!map) return <p role="status">Loading CTX map…</p>

  return (
    <section className="mx-auto max-w-6xl">
      <label className="mb-3 flex items-center gap-2">
        <input
          type="checkbox"
          checked={showElevation}
          onChange={(event) => setShowElevation(event.target.checked)}
        />
        Show elevation
      </label>

      <div className="relative overflow-hidden rounded-lg">
        <img
          src={new URL(map.image, ctxUrl).href}
          alt="CTX orbital image of western Jezero Crater"
          width={map.width}
          height={map.height}
          className="block h-auto w-full"
        />
        {showElevation && <HeatLayer bounds={map.bounds} />}
      </div>
    </section>
  )
}