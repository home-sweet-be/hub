import { BrowserRouter, Routes, Route, Navigate, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import logo from './assets/homesweet.png'
import Commandes from './pages/Commandes'
import Logistique from './pages/Logistique'
import Livraisons from './pages/Livraisons'
import Compta from './pages/Compta'
import Factures from './pages/Factures'
import Rapports from './pages/Rapports'
import './App.css'

const MODULES = [
  { to: '/commandes', label: 'Commandes', icon: '🧾' },
  { to: '/logistique', label: 'Logistique', icon: '📦' },
  { to: '/livraisons', label: 'Livraisons', icon: '🛋️' },
  { to: '/compta', label: 'Compta', icon: '💶' },
  { to: '/factures', label: 'Factures', icon: '🧮' },
  { to: '/rapports', label: 'Rapports', icon: '📊' },
]

function Shell() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const location = useLocation()

  // Close drawer on route change
  useEffect(() => {
    setDrawerOpen(false)
  }, [location.pathname])

  // Lock body scroll while drawer is open
  useEffect(() => {
    if (!drawerOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [drawerOpen])

  return (
    <div className="hub-shell">
      <div className="hub-bg" aria-hidden="true" />

      <header className="hub-header glass">
        <button
          type="button"
          className="hub-header__burger"
          aria-label={drawerOpen ? 'Fermer le menu' : 'Ouvrir le menu'}
          aria-expanded={drawerOpen}
          onClick={() => setDrawerOpen((o) => !o)}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            {drawerOpen ? (
              <>
                <path d="M6 6l12 12" />
                <path d="M18 6L6 18" />
              </>
            ) : (
              <>
                <path d="M4 7h16" />
                <path d="M4 12h16" />
                <path d="M4 17h16" />
              </>
            )}
          </svg>
        </button>

        <img
          src={logo}
          alt="HOMESWEET BRUXELLES"
          className="hub-header__logo"
        />

        <div className="hub-header__greeting">
          <span role="img" aria-label="wave">👋</span>
          <span>Bienvenue Alessandro</span>
        </div>
      </header>

      <div className="hub-body">
        {drawerOpen && (
          <div
            className="hub-drawer-backdrop"
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
        )}
        <nav
          className={'hub-sidebar glass' + (drawerOpen ? ' is-open' : '')}
        >
          <ul className="hub-sidebar__list">
            {MODULES.map((m) => (
              <li key={m.to}>
                <NavLink
                  to={m.to}
                  className={({ isActive }) =>
                    'hub-sidebar__link' + (isActive ? ' is-active' : '')
                  }
                >
                  <span className="hub-sidebar__icon" aria-hidden="true">{m.icon}</span>
                  <span>{m.label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <main className="hub-main">
          <div className="hub-main__inner glass glass--panel">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Navigate to="/commandes" replace />} />
          <Route path="commandes" element={<Commandes />} />
          <Route path="logistique" element={<Logistique />} />
          <Route path="receptions" element={<Navigate to="/logistique" replace />} />
          <Route path="fournisseurs" element={<Navigate to="/logistique" replace />} />
          <Route path="livraisons" element={<Livraisons />} />
          <Route path="compta" element={<Compta />} />
          <Route path="factures" element={<Factures />} />
          <Route path="rapports" element={<Rapports />} />
          <Route path="*" element={<Navigate to="/commandes" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
