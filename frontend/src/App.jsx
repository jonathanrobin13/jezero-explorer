import { lazy, Suspense, useEffect, useState } from 'react'
import References from './References.jsx'
import './Explorer.css'

const ElevationMap = lazy(() => import('./ElevationMap.jsx'))
const heroImage = import.meta.env.BASE_URL + 'data/map/CTX/jezero-crater.webp'
const pages = ['map', 'references', 'mission']

function currentPage() {
  const hash = window.location.hash.slice(1)
  return pages.includes(hash) ? hash : 'home'
}

function Intro() {
  return (
    <main className="expedition">
      <div className="expedition-visual" aria-hidden="true">
        <img className="expedition-terrain" src={heroImage} alt="" />
        <div className="expedition-orbit"><img src={heroImage} alt="" fetchPriority="high" /></div>
        <div className="expedition-grid" />
      </div>
      <header className="expedition-nav frosted">
        <a href="#home" className="expedition-brand"><span className="crater-emblem" /> Jezero Explorer</a>
        <nav aria-label="Site">
          <a href="#references">References</a>
          <a href="#mission">Simulation <span aria-hidden="true">↗</span></a>
        </nav>
      </header>
      <div className="expedition-content">
        <p className="expedition-eyebrow"><span /> Mars / Jezero Crater</p>
        <h1>JEZERO<br /><span>EXPLORER</span></h1>
        <p className="expedition-copy">Explore the traces of an ancient river. Plan a Marswalk across real Martian terrain.</p>
        <a href="#map" className="expedition-cta frosted">Open Mars Map <span aria-hidden="true">↗</span></a>
      </div>
      <footer className="expedition-footer">
        <span>NASA Space Apps Challenge project</span>
        <span>Orbital terrain · MRO CTX / USGS</span>
      </footer>
    </main>
  )
}

export default function App() {
  const [page, setPage] = useState(currentPage)

  useEffect(() => {
    function updatePage() {
      setPage(currentPage())
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', updatePage)
    return () => window.removeEventListener('hashchange', updatePage)
  }, [])

  if (page === 'home') return <Intro />
  if (page === 'references') return <References />
  return (
    <main className={page === 'mission' ? 'mx-auto max-w-[100rem] space-y-4 p-4 sm:p-8' : 'map-page'}>
      {page === 'mission' && <nav aria-label="Site" className="flex flex-wrap gap-2"><a className="console-button" href="#home">← Jezero Explorer</a><a className="console-button" href="#map">Open Mars Map</a></nav>}
      <Suspense fallback={<p role="status" className="p-6">Loading {page === 'map' ? 'orbital survey' : 'simulation'}…</p>}>
        <ElevationMap key={page} mapView={page} />
      </Suspense>
    </main>
  )
}
