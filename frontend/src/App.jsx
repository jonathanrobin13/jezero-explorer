import ElevationMap from './ElevationMap.jsx'

const mapUrl = `${import.meta.env.BASE_URL}data/map/CTX/jezero-ctx.webp`

export default function App() {
  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-white sm:px-8">
      <figure className="mx-auto max-w-6xl">
        <h1 className="mb-4 text-3xl font-bold">Jezero Explorer</h1>

        <img
          src={mapUrl}
          alt="Orbital view of the western Jezero Crater region, including the delta"
          width={1800}
          height={1196}
          className="h-auto w-full rounded-lg"
        />

        <figcaption className="mt-2 text-sm text-slate-300">
          Jezero Crater · Mars Reconnaissance Orbiter CTX mosaic · USGS Astrogeology
        </figcaption>
      </figure>
	  <ElevationMap />
    </main>
  )
}