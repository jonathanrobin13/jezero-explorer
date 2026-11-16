const dateFormat = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'UTC',
})
const dayFormat = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
})

function uvColor(fraction) {
  const t = Math.max(0, Math.min(1, fraction))
  return `rgb(${Math.round(99 + 154 * t)} ${Math.round(102 + 88 * t)} ${Math.round(241 - 166 * t)})`
}

function minutesOfDay({ localSolarTime }) {
  const [hours, minutes] = localSolarTime.split(':').map(Number)
  return hours * 60 + minutes
}

export function RadiationMarker({ layer, bounds, view }) {
  const { sample, max } = layer
  if (!sample) return null

  const x = view.x + view.zoom * (sample.longitude - bounds.west) / (bounds.east - bounds.west)
  const y = view.y + view.zoom * (bounds.north - sample.latitude) / (bounds.north - bounds.south)
  if (x < 0 || x > 1 || y < 0 || y > 1) return null

  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute z-10 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_2px_#0f172a]"
      style={{
        left: `${x * 100}%`,
        top: `${y * 100}%`,
        backgroundColor: uvColor(sample.wattsPerSquareMeter / max),
      }}
    />
  )
}

export function ObservationTimeControls({ layer }) {
  const { sample, samples, setSelection } = layer
  const date = sample.utc.slice(0, 10)
  const dates = [...new Set(samples.map((point) => point.utc.slice(0, 10)))]
  const dailySamples = samples.filter((point) => point.utc.startsWith(date))

  return (
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-sm">
          Earth date (UTC)
          <select
            value={date}
            onChange={(event) => {
              const currentTime = minutesOfDay(sample)
              const day = samples.filter((point) => point.utc.startsWith(event.target.value))
              const nearestTime = day.reduce((nearest, point) => (
                Math.abs(minutesOfDay(point) - currentTime)
                  < Math.abs(minutesOfDay(nearest) - currentTime)
                  ? point
                  : nearest
              ))
              setSelection(nearestTime)
            }}
            className="console-input"
          >
            {dates.map((day) => <option key={day} value={day}>{dayFormat.format(new Date(day))}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          Local solar time (Mars)
          <select
            value={sample.utc}
            onChange={(event) => setSelection(dailySamples.find((point) => point.utc === event.target.value))}
            className="console-input"
          >
            {dailySamples.map((point) => (
              <option key={point.utc} value={point.utc}>{point.localSolarTime.slice(0, 5)} · Sol {point.sol}</option>
            ))}
          </select>
        </label>
      </div>
  )
}

export function RadiationControls({ layer, onLocate, showTimeControls = true }) {
  const { data, sample, max, error } = layer
  if (error) return <p role="alert" className="mt-3">{error}</p>
  if (!sample) return <p role="status" className="mt-3">Loading solar UV observations…</p>

  return (
    <section className="console-panel space-y-3 p-4" aria-label="Solar UV radiation observations">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-white">Solar UV radiation</h2>
          <p className="text-sm text-slate-300">
            Perseverance MEDA · 250–400 nm · Nov 11–18, 2022 archive
          </p>
        </div>
        <button type="button" onClick={() => onLocate(sample)} className="console-button">
          Show observation on map
        </button>
      </div>
      {showTimeControls && <ObservationTimeControls layer={layer} />}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2" aria-live="polite">
        <p className="flex items-center gap-2 text-lg font-semibold tabular-nums">
          <span aria-hidden="true" className="size-3 rounded-full" style={{ backgroundColor: uvColor(sample.wattsPerSquareMeter / max) }} />
          {sample.wattsPerSquareMeter.toFixed(3)} W/m²
        </p>
        <p className="text-sm text-slate-300">
          {dateFormat.format(new Date(sample.utc))} UTC (approx.) · {sample.latitude.toFixed(4)}° N, {sample.longitude.toFixed(4)}° E
        </p>
      </div>

      <div className="max-w-56 text-xs text-slate-200" aria-label={`Solar UV color scale, 0 to ${max} watts per square meter`}>
        <div className="h-2 rounded-full" style={{ background: `linear-gradient(to right, ${uvColor(0)}, ${uvColor(1)})` }} />
        <div className="mt-1 flex justify-between"><span>0</span><span>{max} W/m²</span></div>
      </div>
      <p className="text-sm text-slate-300">
        These readings show how UV varied over time at one rover site. The upward-looking detector
        measures UV within its field of view. Sun angle, dust and sensor orientation can affect the reading.
        Ionizing radiation dose along the Marswalk is unknown.
      </p>
      <a href={data.source.url} target="_blank" rel="noreferrer" className="text-sm text-cyan-300 underline">
        NASA Planetary Data System · MEDA archive
      </a>
    </section>
  )
}
