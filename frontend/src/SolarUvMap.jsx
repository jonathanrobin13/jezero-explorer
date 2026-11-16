import { useEffect, useRef } from 'react'

const shadowColor = [48, 36, 105]
const sunColor = [255, 209, 89]

export function SolarUvOverlay({ model, bounds, visible }) {
  const canvasRef = useRef(null)
  const { grid, exposure } = model

  useEffect(() => {
    if (!exposure) return
    const colors = new ImageData(grid.width, grid.height)
    for (let cell = 0; cell < exposure.length; cell++) {
      const fraction = exposure[cell]
      if (!Number.isFinite(fraction)) continue
      const offset = 4 * cell
      for (let channel = 0; channel < 3; channel++) {
        colors.data[offset + channel] = shadowColor[channel] + (sunColor[channel] - shadowColor[channel]) * fraction
      }
      colors.data[offset + 3] = 184
    }
    canvasRef.current.getContext('2d').putImageData(colors, 0, 0)
  }, [exposure, grid])

  if (!exposure) return null
  const longitudeSpan = bounds.east - bounds.west
  const latitudeSpan = bounds.north - bounds.south
  return (
    <canvas
      ref={canvasRef}
      width={grid.width}
      height={grid.height}
      role="img"
      aria-label="Modeled direct solar UV exposure. Purple indicates low exposure and gold indicates high exposure."
      className="map-overlay absolute"
      data-visible={visible}
      aria-hidden={!visible}
      style={{
        left: `${100 * (grid.bounds.west - bounds.west) / longitudeSpan}%`,
        top: `${100 * (bounds.north - grid.bounds.north) / latitudeSpan}%`,
        width: `${100 * (grid.bounds.east - grid.bounds.west) / longitudeSpan}%`,
        height: `${100 * (grid.bounds.north - grid.bounds.south) / latitudeSpan}%`,
      }}
    />
  )
}

export function SolarUvLegend({ model }) {
  if (model.error) return <p role="alert" className="my-2 text-sm">{model.error}</p>
  if (!model.exposure) return <p role="status" className="my-2 text-sm">Calculating direct solar UV exposure…</p>

  return (
    <div className="my-2 max-w-xs text-sm">
      <p className="font-semibold">Modeled direct solar UV exposure</p>
      <div
        aria-hidden="true"
        className="my-1 h-2 rounded"
        style={{ background: `linear-gradient(to right, rgb(${shadowColor.join(',')}), rgb(${sunColor.join(',')}))` }}
      />
      <div className="flex justify-between gap-3 text-xs text-slate-300">
        <span>0% · No direct beam</span>
        <span>100% · Facing the Sun</span>
      </div>
      <p className="mt-1 text-xs text-slate-300">Uncolored terrain has insufficient data for the model.</p>
    </div>
  )
}

