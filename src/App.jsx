import { BrowserRouter, Routes, Route, Navigate, NavLink, Outlet } from 'react-router-dom'
import logo from './assets/homesweet.png'
import Commandes from './pages/Commandes'
import Receptions from './pages/Receptions'
import Fournisseurs from './pages/Fournisseurs'
import Livraisons from './pages/Livraisons'
import Compta from './pages/Compta'
import Factures from './pages/Factures'
import Rapports from './pages/Rapports'
import './App.css'

const MODULES = [
  { to: '/commandes', label: 'Commandes', icon: '🧾' },
  { to: '/receptions', label: 'Réceptions', icon: '📦' },
  { to: '/fournisseurs', label: 'Fournisseurs', icon: '🚚' },
  { to: '/livraisons', label: 'Livraisons', icon: '🛋️' },
  { to: '/compta', label: 'Compta', icon: '💶' },
  { to: '/factures', label: 'Factures', icon: '🧮' },
  { to: '/rapports', label: 'Rapports', icon: '📊' },
]

function Shell() {
  return (
    <div className="hub-shell">
      <div className="hub-bg" aria-hidden="true" />

      <header className="hub-header glass">
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
        <nav className="hub-sidebar glass">
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
          <Route path="receptions" element={<Receptions />} />
          <Route path="fournisseurs" element={<Fournisseurs />} />
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
