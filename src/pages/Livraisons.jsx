import { Fragment } from 'react'
import { NavLink, Outlet } from 'react-router-dom'

const STEPS = [
  { to: 'waitinglist', label: "File d'attente", color: '#34c759' },
  { to: 'planifier', label: 'Planifier', color: '#0a84ff' },
  { to: 'semaine', label: 'Livraisons', color: '#ff9500' },
]

export default function Livraisons() {
  return (
    <div className="logistique">
      <div className="logistique__steps" role="tablist">
        {STEPS.map((s, i) => (
          <Fragment key={s.to}>
            <NavLink
              to={s.to}
              role="tab"
              className={({ isActive }) =>
                'logistique__step' + (isActive ? ' is-active' : '')
              }
              style={({ isActive }) =>
                isActive
                  ? {
                      background: s.color,
                      borderColor: s.color,
                      boxShadow: `0 6px 18px -6px ${s.color}80`,
                    }
                  : undefined
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className="logistique__step-num"
                    style={{
                      background: isActive ? 'rgba(255,255,255,0.25)' : s.color,
                      color: '#fff',
                    }}
                  >
                    {i + 1}
                  </span>
                  <span className="logistique__step-label">{s.label}</span>
                </>
              )}
            </NavLink>
            {i < STEPS.length - 1 && (
              <span className="logistique__connector" aria-hidden="true">
                <svg viewBox="0 0 24 8" fill="none">
                  <path
                    d="M0 4 L20 4"
                    stroke="rgba(28,28,30,0.2)"
                    strokeWidth="1.5"
                  />
                  <path
                    d="M16 1 L21 4 L16 7"
                    stroke="rgba(28,28,30,0.25)"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill="none"
                  />
                </svg>
              </span>
            )}
          </Fragment>
        ))}
      </div>

      <div className="logistique__panel">
        <Outlet />
      </div>
    </div>
  )
}
