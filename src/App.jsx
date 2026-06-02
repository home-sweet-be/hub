import { BrowserRouter, Routes, Route, Navigate, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useCallback, useEffect, useRef, useState } from 'react'
import logo from './assets/homesweet.png'
import { ReloadContext } from './lib/reload'
import Commandes from './pages/Commandes'
import Logistique from './pages/Logistique'
import Livraisons from './pages/Livraisons'
import LivraisonsPlanifier from './pages/LivraisonsPlanifier'
import LivraisonsReservations from './pages/LivraisonsReservations'
import LivraisonsSemaine from './pages/LivraisonsSemaine'
import Compta from './pages/Compta'
import Notifications from './pages/Notifications'
import Rapports from './pages/Rapports'
import PlanificationLivraison from './pages/PlanificationLivraison'
import './App.css'

const MODULES = [
  { to: '/commandes', label: 'Commandes', icon: '🧾' },
  { to: '/logistique', label: 'Logistique', icon: '📦' },
  { to: '/livraisons', label: 'Livraisons', icon: '🛋️' },
  { to: '/compta', label: 'Compta', icon: '💶' },
  { to: '/rapports', label: 'Rapports', icon: '📊' },
]

function Shell() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const location = useLocation()
  const [reloadKey, setReloadKey] = useState(0)
  const [reloading, setReloading] = useState(false)
  const reloadTimerRef = useRef(null)

  const triggerReload = useCallback(() => {
    setReloadKey((k) => k + 1)
    setReloading(true)
    if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current)
    reloadTimerRef.current = setTimeout(() => setReloading(false), 900)
  }, [])

  useEffect(() => {
    return () => {
      if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current)
    }
  }, [])

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

  // When iframed (e.g. embedded on a Shopify page), post the actual content
  // height to the parent so the iframe can grow to fit and we avoid the
  // double-scrollbar issue. We measure .hub-shell rather than documentElement
  // to avoid the feedback loop where the iframe's own viewport inflates the
  // measured height.
  //
  // We also tag <html> with .is-iframed so the CSS can drop min-height:100vh
  // on .hub-shell — otherwise the shell stays stuck at the previous (taller)
  // iframe viewport when navigating from a long page to a shorter one.
  useEffect(() => {
    if (window === window.parent) return
    document.documentElement.classList.add('is-iframed')
    let lastH = 0
    const post = () => {
      const el = document.querySelector('.hub-shell')
      if (!el) return
      const h = Math.ceil(el.getBoundingClientRect().height)
      if (Math.abs(h - lastH) < 2) return
      lastH = h
      try {
        window.parent.postMessage(
          { type: 'homesweet:hub-height', height: h },
          '*'
        )
      } catch {
        // ignore
      }
    }
    post()
    const target = document.querySelector('.hub-shell')
    const ro = new ResizeObserver(post)
    if (target) ro.observe(target)
    window.addEventListener('load', post)
    return () => {
      ro.disconnect()
      window.removeEventListener('load', post)
      document.documentElement.classList.remove('is-iframed')
    }
  }, [])

  return (
    <ReloadContext.Provider value={{ reloadKey, reloading, triggerReload }}>
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

        <NavLink
          to="/notifications"
          className={({ isActive }) =>
            'hub-header__emails' + (isActive ? ' is-active' : '')
          }
          aria-label="Notifications"
          title="Notifications"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        </NavLink>

        <button
          type="button"
          className={'hub-header__reload' + (reloading ? ' is-spinning' : '')}
          onClick={triggerReload}
          disabled={reloading}
          aria-label="Rafraîchir les données"
          title="Rafraîchir les données"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12a9 9 0 0 1 15.49-6.27L21 8" />
            <path d="M21 3v5h-5" />
            <path d="M21 12a9 9 0 0 1-15.49 6.27L3 16" />
            <path d="M3 21v-5h5" />
          </svg>
        </button>
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
    </ReloadContext.Provider>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="planification-livraison" element={<PlanificationLivraison />} />
        <Route element={<Shell />}>
          <Route index element={<Navigate to="/commandes" replace />} />
          <Route path="commandes" element={<Commandes />} />
          <Route path="logistique" element={<Logistique />} />
          <Route path="receptions" element={<Navigate to="/logistique" replace />} />
          <Route path="fournisseurs" element={<Navigate to="/logistique" replace />} />
          <Route path="livraisons" element={<Livraisons />}>
            <Route index element={<Navigate to="waitinglist" replace />} />
            <Route path="waitinglist" element={<LivraisonsReservations />} />
            <Route path="planifier" element={<LivraisonsPlanifier />} />
            <Route path="semaine" element={<LivraisonsSemaine />} />
          </Route>
          <Route path="compta" element={<Compta />} />
          <Route path="notifications" element={<Notifications />} />
          <Route path="emails" element={<Navigate to="/notifications" replace />} />
          <Route path="factures" element={<Navigate to="/commandes" replace />} />
          <Route path="rapports" element={<Rapports />} />
          <Route path="*" element={<Navigate to="/commandes" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
