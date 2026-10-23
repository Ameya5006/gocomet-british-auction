import { useEffect, useRef } from 'react'
import { Link, NavLink, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { Listing } from './pages/Listing'
import { CreateRFQ } from './pages/CreateRFQ'
import { Detail } from './pages/Detail'

function Layout() {
  const { pathname } = useLocation()
  const main = useRef<HTMLElement>(null)
  useEffect(() => {
    main.current?.focus()
    window.scrollTo(0, 0)
  }, [pathname])
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="app-header">
        <div className="header-inner">
          <Link to="/" className="brand" aria-label="GoComet home">
            <span className="brand-mark" aria-hidden="true">
              G
            </span>
            GoComet<span className="brand-divider">/</span>
            <span className="brand-product">Procurement</span>
          </Link>
          <nav aria-label="Main navigation">
            <NavLink to="/" end>
              Auctions
            </NavLink>
            <NavLink to="/rfqs/new">Create RFQ</NavLink>
          </nav>
        </div>
      </header>
      <main id="main" ref={main} tabIndex={-1} className="workspace">
        <Outlet />
      </main>
    </>
  )
}
export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Listing />} />
        <Route path="rfqs/new" element={<CreateRFQ />} />
        <Route path="rfqs/:id" element={<Detail />} />
        <Route
          path="*"
          element={
            <div className="panel empty">
              <h1>Page not found</h1>
              <Link to="/">Return to auctions</Link>
            </div>
          }
        />
      </Route>
    </Routes>
  )
}
