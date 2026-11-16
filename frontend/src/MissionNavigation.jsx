import { ObservationTimeControls } from './RadiationLayer.jsx'
import { routeCell, formatDistance } from './map_calculations/missionRoutes.js'
import { distanceMeters } from './map_calculations/uvSiteEstimate.js'

function distanceToRoute(world, route, sample) {
  if (!sample || !route?.length) return null
  return route.reduce((closest, point) => Math.min(closest, distanceMeters(world.coordinates(point.x, point.z), sample)), Infinity)
}

function exposureSummary(model, world, points) {
  if (!model?.exposure || !points?.length) return ''
  const terrain = { grid: model.grid, elevations: model.exposure }
  let sum = 0
  let count = 0
  for (const point of points) {
    const cell = routeCell(terrain, world.coordinates(point.x, point.z))
    if (cell === null) continue
    sum += model.exposure[cell]
    count++
  }
  return count ? `${Math.round(sum / count * 100)}% mean direct exposure · ${Math.round(count / points.length * 100)}% of samples covered` : 'Outside model coverage'
}

export function EnvironmentPanel({ layer, weather, world, player, route, model, modelEnabled, onToggleModel }) {
  const sample = layer?.sample
  const reading = sample && weather?.archive?.snapshots[sample.utc]
  const records = sample && weather?.archive?.aerosol?.byDate[sample.utc.slice(0, 10)]
  const dust = records?.reduce((nearest, record) => (
    !nearest || Math.abs(Date.parse(record.utc) - Date.parse(sample.utc)) < Math.abs(Date.parse(nearest.utc) - Date.parse(sample.utc))
      ? record : nearest
  ), null)
  const referenceDistance = route?.length ? distanceToRoute(world, route, sample)
    : player && sample ? distanceMeters(world.coordinates(player.x, player.z), sample) : null
  const dustDistance = route?.length ? distanceToRoute(world, route, dust)
    : player && dust ? distanceMeters(world.coordinates(player.x, player.z), dust) : null
  const exposure = exposureSummary(model, world, route?.length ? route : player ? [player] : null)

  return (
    <section className="mission-glass mission-environment" aria-label={route ? 'Route environmental context' : 'Environmental readings'}>
      <h3>{route ? 'Route environment' : 'Environment'}</h3>
      <dl className="mission-readings">
        <div><dt>Air temperature</dt><dd>{reading?.temperatureC == null ? 'Unavailable' : `${reading.temperatureC.toFixed(1)} °C`}</dd></div>
        <div><dt>Atmospheric pressure</dt><dd>{reading?.pressurePa == null ? 'Unavailable' : `${reading.pressurePa} Pa`}</dd></div>
        <div><dt>Solar UV radiation</dt><dd>{sample ? `${sample.wattsPerSquareMeter.toFixed(3)} W/m²` : 'Unavailable'}</dd></div>
        <div><dt>Dust / aerosol optical depth</dt><dd>{dust ? `${dust.tau.toFixed(3)} τ` : 'Unavailable'}</dd></div>
      </dl>
      {sample && (
        <p className="mission-reference">
          MEDA rover archive · {sample.utc.slice(0, 16).replace('T', ' ')} UTC
          {referenceDistance !== null && ` · ${formatDistance(referenceDistance)} ${route ? 'from nearest route sample' : 'away'}`}
        </p>
      )}
      {dust && <p className="mission-reference">Mastcam-Z · {dust.utc.slice(0, 16).replace('T', ' ')} UTC{dustDistance !== null && ` · ${formatDistance(dustDistance)} away`}. Clouds also affect optical depth.</p>}
      <details>
        <summary>Observation time &amp; solar model</summary>
        <p className="mission-reference">Archive readings apply at the rover. Temperature, pressure and dust along the traverse are unavailable.</p>
        {sample && <ObservationTimeControls layer={layer} />}
        <label className="mission-layer-toggle"><input type="checkbox" checked={modelEnabled} onChange={event => onToggleModel(event.target.checked)} /> Estimate terrain solar exposure</label>
        {modelEnabled && <p className="mission-reference">Relative direct sunlight · {exposure || model.error || 'Calculating…'}</p>}
        <p className="mission-reference"><a href="https://doi.org/10.17189/1522849">NASA PDS · MEDA archive</a></p>
      </details>
    </section>
  )
}

export function RouteOptions({ routes, selected, onSelect, onConfirm }) {
  if (!routes?.length) return null
  const route = routes[selected]
  return (
    <div className="mission-route-card">
      <div className="mission-route-switcher">
        <button className="mission-button" type="button" aria-label="Previous route" disabled={selected === 0} onClick={() => onSelect(selected - 1)}>←</button>
        <div><strong>{route.label}</strong><small>Route {selected + 1} of {routes.length}</small></div>
        <button className="mission-button" type="button" aria-label="Next route" disabled={selected + 1 === routes.length} onClick={() => onSelect(selected + 1)}>→</button>
      </div>
      <dl className="mission-readings">
        <div><dt>Distance</dt><dd>{formatDistance(route.distanceMeters)}</dd></div>
        <div><dt>Climb</dt><dd>{Math.round(route.ascentMeters)} m</dd></div>
        <div><dt>Steepest step</dt><dd>{Math.round(100 * route.maxGrade)}%</dd></div>
        <div><dt>Estimated walk</dt><dd>{Math.max(1, Math.round(route.timeSeconds / 60))} min</dd></div>
      </dl>
      <ul className="mission-route-tags" aria-label="Route trade-offs">
        {(route.tradeoffs ?? []).map(tag => <li className={tag.favorable ? 'favorable' : 'drawback'} key={tag.key}>{tag.favorable ? '+ ' : '− '}{tag.label}</li>)}
      </ul>
      <button className="mission-button mission-primary" type="button" onClick={onConfirm}>Follow this route</button>
    </div>
  )
}
