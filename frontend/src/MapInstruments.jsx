import { ObservationTimeControls } from './RadiationLayer.jsx'

const readingLabels = {
  uv: 'Measured solar UV',
  dust: 'Aerosol optical depth',
  temperature: 'Air temperature',
  pressure: 'Atmospheric pressure',
}

function distanceToPath(observation, planner) {
  const grid = planner.terrain?.grid
  const cells = planner.route?.cells
  if (!grid || !cells?.length || !Number.isFinite(observation.latitude) ||
    !Number.isFinite(observation.longitude)) return null

  // Local tangent plane centered on the rover, for the short western survey paths.
  const metersPerDegree = Math.PI * 3_396_190 / 180
  const eastScale = metersPerDegree * Math.cos(observation.latitude * Math.PI / 180)
  let closest = Infinity
  let previous = null
  for (const cell of cells) {
    const x = (grid.west + (cell % grid.width + 0.5) * grid.degreesPerColumn - observation.longitude) * eastScale
    const y = (grid.north - (Math.floor(cell / grid.width) + 0.5) * grid.degreesPerRow - observation.latitude) * metersPerDegree
    if (previous) {
      const dx = x - previous.x
      const dy = y - previous.y
      const t = Math.min(1, Math.max(0, -(previous.x * dx + previous.y * dy) / (dx * dx + dy * dy || 1)))
      closest = Math.min(closest, Math.hypot(previous.x + t * dx, previous.y + t * dy))
    } else {
      closest = Math.hypot(x, y)
    }
    previous = { x, y }
  }
  return closest
}

function timestamp(observation) {
  return observation.utc.slice(0, 10) + ' · ' + observation.utc.slice(11, 16) + ' UTC (approx.)'
}

function coordinates(observation) {
  return observation.latitude.toFixed(4) + '° N, ' + observation.longitude.toFixed(4) + '° E'
}

function dustValue(dust) {
  return dust ? dust.tau.toFixed(3) + ' ± ' + dust.uncertainty.toFixed(3) : 'Unavailable'
}

export function DustContext({ planner, dust, loading }) {
  const index = planner.routes.findIndex((route) => route.id === planner.routeId)
  const distance = dust && distanceToPath(dust, planner)
  return (
    <div className="dust-readout" aria-live="polite">
      {index < 0 ? <p>Select a start and destination to see dust context.</p> : (
        <>
          <p className="instrument-label">Route {index + 1} of {planner.routes.length}</p>
          <strong className="instrument-value">{loading ? 'Loading…' : dustValue(dust)}</strong>
          <p>Aerosol optical depth · 880 nm</p>
          {dust && <><p>Perseverance · {coordinates(dust)}</p><p>{timestamp(dust)}</p></>}
          {distance != null && <p className="text-cyan-100">{distance < 1000 ? Math.round(distance) + ' m' : (distance / 1000).toFixed(2) + ' km'} from path (approx.)</p>}
          <p className="dust-limit">Route-wide dust unavailable</p>
        </>
      )}
    </div>
  )
}

export function LayerReadout({ mode, range, radiation, weather, dust, modelEnabled, setModelEnabled, model }) {
  if (mode === 'elevation') {
    if (!range) return <p className="text-xs">Loading elevation…</p>
    return (
      <div className="elevation-key">
        <p className="instrument-label">Elevation · m</p>
        <div className="elevation-gradient" aria-hidden="true" />
        <div className="flex justify-between font-mono text-xs">{range.map((value) => <span key={value}>{Math.round(value).toLocaleString()}</span>)}</div>
      </div>
    )
  }

  const { sample } = radiation
  const reading = sample && weather.archive?.snapshots[sample.utc]
  let value = 'Unavailable'
  if (mode === 'uv' && sample) value = sample.wattsPerSquareMeter.toFixed(3) + ' W/m²'
  if (mode === 'dust') value = dustValue(dust)
  if (mode === 'temperature' && reading?.temperatureC != null) value = reading.temperatureC.toFixed(1) + ' °C'
  if (mode === 'pressure' && reading?.pressurePa != null) value = reading.pressurePa + ' Pa'
  const observation = mode === 'dust' ? dust : sample
  const loading = !sample ? !radiation.error : mode !== 'uv' && !weather.archive && !weather.error

  return (
    <details className="observation-details">
      <summary><span>{readingLabels[mode]}</span><strong>{loading ? 'Loading…' : value}</strong></summary>
      {observation && <p className="instrument-label mt-1">Perseverance · {coordinates(observation)}<br />{timestamp(observation)}</p>}
      {mode === 'uv' && (
        <div className="mt-2 space-y-1.5 text-xs">
          <label className="flex items-center gap-2"><input type="checkbox" checked={modelEnabled} disabled={!sample} onChange={(event) => setModelEnabled(event.target.checked)} /> Modeled direct UV exposure</label>
          {modelEnabled && <p>{model.error ?? (!model.exposure ? 'Calculating exposure…' : 'Purple 0% · gold 100% · clear areas lack coverage')}</p>}
        </div>
      )}
      {sample && <ObservationTimeControls layer={radiation} />}
    </details>
  )
}
