import { useEffect } from 'react'
import { createPortal } from 'react-dom'

export default function ConfirmModal({
  open,
  title = 'Confirmer',
  message,
  confirmLabel = 'Confirmer',
  cancelLabel = 'Annuler',
  variant = 'default', // 'default' | 'danger'
  pending = false,
  onConfirm,
  onClose,
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape' && !pending) onClose?.()
      if (e.key === 'Enter' && !pending) onConfirm?.()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, pending, onClose, onConfirm])

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  if (!open) return null

  return createPortal(
    <div
      className="confirm-modal__backdrop"
      onClick={pending ? undefined : onClose}
      role="presentation"
    >
      <div
        className="confirm-modal__card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="confirm-modal__header">
          <h3 id="confirm-modal-title">{title}</h3>
        </header>
        {message && (
          <div className="confirm-modal__body">
            {typeof message === 'string' ? <p>{message}</p> : message}
          </div>
        )}
        <footer className="confirm-modal__footer">
          <button
            type="button"
            className="confirm-modal__btn confirm-modal__btn--secondary"
            onClick={onClose}
            disabled={pending}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={
              'confirm-modal__btn ' +
              (variant === 'danger'
                ? 'confirm-modal__btn--danger'
                : 'confirm-modal__btn--primary')
            }
            onClick={onConfirm}
            disabled={pending}
            autoFocus
          >
            {pending ? '…' : confirmLabel}
          </button>
        </footer>
      </div>
    </div>,
    document.body
  )
}
