import { Fragment, useState } from 'react'
import LivraisonsPlanifier from './LivraisonsPlanifier'
import LivraisonsReservations from './LivraisonsReservations'

const STEPS = [
  { id: 'file-attente', label: "File d'attente", color: '#34c759' },
  { id: 'planifier', label: 'Planifier', color: '#0a84ff' },
]

export default function Livraisons() {
  const [activeTab, setActiveTab] = useState('file-attente')

  return (
    <div className="logistique">
      <div className="logistique__steps" role="tablist">
        {STEPS.map((s, i) => {
          const isActive = s.id === activeTab
          return (
            <Fragment key={s.id}>
              <button
                type="button"
                role="tab"
                aria-selected={isActive}
                className={
                  'logistique__step' + (isActive ? ' is-active' : '')
                }
                style={
                  isActive
                    ? {
                        background: s.color,
                        borderColor: s.color,
                        boxShadow: `0 6px 18px -6px ${s.color}80`,
                      }
                    : undefined
                }
                onClick={() => setActiveTab(s.id)}
              >
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
              </button>
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
          )
        })}
      </div>

      <div className="logistique__panel">
        {activeTab === 'file-attente' && <LivraisonsReservations />}
        {activeTab === 'planifier' && <LivraisonsPlanifier />}
      </div>
    </div>
  )
}
