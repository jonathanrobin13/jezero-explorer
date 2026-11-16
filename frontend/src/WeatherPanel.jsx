import { ObservationTimeControls } from './RadiationLayer.jsx'
import { distanceMeters } from './map_calculations/uvSiteEstimate.js'

function elevationAt(point, terrain) {
  if (!terrain) return null
  const { grid, elevations } = terrain
  const { north, west } = grid.bounds ?? grid
  const row = Math.floor((north - point.latitude) / grid.degreesPerRow)
  const column = Math.floor((point.longitude - west) / grid.degreesPerColumn)
  if (row < 0 || row >= grid.height || column < 0 || column >= grid.width) return null

  const meters = elevations[row * grid.width + column]
  return Number.isFinite(meters) ? Math.round(meters) : null
}

export default function WeatherPanel({ point, layer, weather, westernTerrain, craterTerrain, terrainLoading }) {
  const { sample, error } = layer
  const reading = sample && weather.archive?.snapshots[sample.utc]
  const aerosol = sample && weather.archive?.aerosol
  const opacityReadings = aerosol?.byDate[sample.utc.slice(0, 10)] ?? []
  const westernElevation = point && elevationAt(point, westernTerrain)
  const elevation = westernElevation ?? (point && elevationAt(point, craterTerrain))
  const spacing = westernElevation === null ? 100 : 20

  return (
    <section aria-label="Jezero weather" className="console-panel space-y-3 p-4">
      <div>
        <h2 className="font-semibold">Jezero weather archive</h2>
        <p className="mt-1 font-mono text-xs text-telemetry">November 11–18, 2022 UTC</p>
      </div>
      {!point ? <p className="text-sm">Select a map point to see its elevation and compare it with rover observations.</p> : (
        <>
          <div className="space-y-1 text-sm" aria-live="polite">
            <p>Selected point · {point.latitude.toFixed(5)}° N, {point.longitude.toFixed(5)}° E</p>
            <p>
              CTX elevation · {elevation === null
                ? (terrainLoading ? 'Loading…' : 'Unavailable')
                : `${elevation.toLocaleString()} m (${spacing} m grid)`}
            </p>
          </div>
          {error && <p role="alert">{error}</p>}
          {!sample && !error && <p role="status">Loading archive dates…</p>}
          {sample && (
            <>
              <ObservationTimeControls layer={layer} />
              <div className="space-y-1 text-sm" aria-live="polite">
                <h3 className="font-semibold">Perseverance observations</h3>
                <p>
                  {sample.latitude.toFixed(5)}° N, {sample.longitude.toFixed(5)}° E
                  {' · '}{(distanceMeters(point, sample) / 1000).toFixed(2)} km from selection
                </p>
                <p>Sol {sample.sol} · {sample.utc.slice(0, 10)} {sample.utc.slice(11, 19)} UTC (approx.)</p>
                {weather.error && <p role="alert">Temperature and pressure archive unavailable.</p>}
                {!weather.archive && !weather.error && <p role="status">Loading weather…</p>}
                {weather.archive && (
                  <>
                    <div className="py-2">
                      <p>Air temperature</p>
                      <p className="font-mono text-2xl font-semibold tabular-nums text-cyan-200">
                        {reading?.temperatureC == null ? 'Unavailable' : `${reading.temperatureC.toFixed(1)} °C`}
                      </p>
                    </div>
                    <p>Atmospheric pressure · {reading?.pressurePa == null ? 'Unavailable' : `${reading.pressurePa} Pa`}</p>
                  </>
                )}
                <p>Rover solar UV · {sample.wattsPerSquareMeter.toFixed(3)} W/m²</p>
                {aerosol && (
                  <div className="border-t border-slate-700 pt-2 mt-2">
                    <p className="font-medium">Dust context · aerosol optical depth at 880 nm</p>
                    {opacityReadings.length ? opacityReadings.map((opacity) => (
                      <p key={opacity.sclk}>
                        {opacity.tau.toFixed(3)} ± {opacity.uncertainty.toFixed(3)}
                        {' · '}{opacity.utc.slice(11, 16)} UTC (approx.)
                        {' · '}{opacity.localSolarTime} Mars solar time
                        {' · '}{(distanceMeters(point, opacity) / 1000).toFixed(2)} km from selection
                      </p>
                    )) : <p>Unavailable for this UTC date.</p>}
                    <p className="text-slate-300">Mastcam-Z measures how much the atmosphere dims sunlight. Dust and clouds both contribute.</p>
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-cyan-300 underline">
                <a href={layer.data.source.url} target="_blank" rel="noreferrer">NASA PDS · MEDA</a>
                {aerosol && <a href={aerosol.source.url} target="_blank" rel="noreferrer">Lemmon · Mastcam-Z</a>}
              </div>
            </>
          )}
        </>
      )}
    </section>
  )
}
