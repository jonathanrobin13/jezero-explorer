import { useEffect, useState } from 'react'

const references = [
  ['CTX/jezero-ctx.json', 'Orbital imagery', 'Western Jezero · 6 m source pixels. Used as the survey basemap.'],
  ['CTX/jezero-crater.json', 'Elevation and shaded relief', '20 m source DEM. The west survey uses its 20 m grid. The regional intro relief uses a 100 m derivative.'],
  ['HiRISE/jezero-western-delta.json', 'Western delta detail', 'Approximately 1 m source pixels in the overlapping western delta footprint.'],
  ['MEDA/jezero-uv.json', 'UV radiation', 'Perseverance detector readings in W/m² at one archived rover site, November 11–18, 2022 UTC.'],
  ['MEDA/jezero-weather.json', 'Temperature and pressure', 'Archived point readings in °C and Pa, paired to the selected UV snapshot. Pressure is missing for some snapshots.'],
  ['MEDA/jezero-weather.json', 'Dust', 'Atmospheric column optical depth at 880 nm above Perseverance. Dust and clouds can both contribute. The map selects the closest available observation in time on the same UTC date.', 'aerosol'],
]

function SourceRecord({ source }) {
  const products = source.products ?? []
  const identifiers = source.productIds ?? [source.productId ?? source.product].filter(Boolean)
  return (
    <div className="source-record">
      <p>{[source.mission, source.instrument].filter(Boolean).join(' · ')}</p>
      <p>{[source.publisher, source.credit, source.license].filter(Boolean).join(' · ')}</p>
      {source.resolution && <p>{source.resolution}</p>}
      {source.coverage && <p>{source.coverage}</p>}
      {source.coverageUtc && <p>{source.coverageUtc.join(' to ')} UTC</p>}
      {identifiers.length > 0 && <p className="font-mono text-xs break-all">{identifiers.join(' · ')}</p>}
      {source.url && <a href={source.url} target="_blank" rel="noreferrer">View original source ↗</a>}
      {products.length > 0 && (
        <details><summary>Product identifiers ({products.length})</summary>
          <ul>{products.map(({ id, version, url }) => <li key={id}><a href={url} target="_blank" rel="noreferrer">{id}</a> · v{version}</li>)}</ul>
        </details>
      )}
    </div>
  )
}

export default function References() {
  const [data, setData] = useState({})
  const [unavailable, setUnavailable] = useState([])
  useEffect(() => {
    const controller = new AbortController()
    const paths = [...new Set([...references.map(([path]) => path), 'geology/jezero-water-minerals.json'])]
    for (const path of paths) {
      fetch(import.meta.env.BASE_URL + 'data/map/' + path, { signal: controller.signal })
        .then((response) => {
          if (!response.ok) throw new Error(path)
          return response.json()
        })
        .then((value) => {
          if (!controller.signal.aborted) setData((entries) => ({ ...entries, [path]: value }))
        })
        .catch(() => {
          if (!controller.signal.aborted) setUnavailable((paths) => [...paths, path])
        })
    }
    return () => controller.abort()
  }, [])

  return (
    <main className="reference-page">
      <nav className="reference-nav frosted" aria-label="Site">
        <a href="#home">← Jezero Explorer</a><a href="#map">Open Mars Map ↗</a>
      </nav>
      <header><p className="expedition-eyebrow">Jezero Explorer</p><h1>References</h1>
        <p>Data, coverage, and how the Marswalk estimates are made.</p></header>
      <div className="reference-grid">
        {references.map(([path, title, description, subkey]) => {
          const source = (subkey ? data[path]?.[subkey] : data[path])?.source
          return <section key={title} className="reference-card frosted"><h2>{title}</h2><p>{description}</p>
            {source ? <SourceRecord source={source} /> : <p>{unavailable.includes(path) ? 'Product metadata unavailable.' : 'Loading product metadata…'}</p>}
          </section>
        })}
        <section className="reference-card frosted">
          <h2>Western delta and ancient water</h2>
          <p>Perseverance imaged layers and tilted beds in the delta scarp. Scientists interpret the deposits as evidence of a river entering a lake. The map pins are representative locations for regional evidence.</p>
          <a href="https://science.nasa.gov/resource/mars-delta-scarp-from-more-than-a-mile-away/" target="_blank" rel="noreferrer">NASA · Delta scarp observation ↗</a>
          <details><summary>Mineral and landform sources</summary>
            {data['geology/jezero-water-minerals.json']?.sources.map((source) => <SourceRecord key={source.id} source={source} />) ??
              <p>{unavailable.includes('geology/jezero-water-minerals.json') ? 'Product metadata unavailable.' : 'Loading product metadata…'}</p>}
          </details>
        </section>
        <section className="reference-card frosted">
          <h2>Modeled UV and Marswalk routes</h2>
          <p>Direct UV exposure uses the Sun angle and shadows on the regional CTX terrain. It describes geometric exposure, excluding diffuse UV, dust attenuation, and ionizing radiation.</p>
          <a href="https://www.giss.nasa.gov/tools/mars24/help/algorithm.html" target="_blank" rel="noreferrer">NASA GISS · Mars24 solar geometry ↗</a>
          <p>Routes compare distance, grade, ascent, and estimated walking time on valid 20 m CTX cells. Time assumes 0.8 m/s on flat ground and excludes stops. The model can miss hazards smaller than the grid spacing.</p>
          <p>Route dust context reports the approximate shortest horizontal distance from a rover observation to the route. It provides no estimate of exposure along the path.</p>
        </section>
      </div>
    </main>
  )
}
