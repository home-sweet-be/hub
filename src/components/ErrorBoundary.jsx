import { Component } from 'react'

// Catches render/effect errors from the routed page so a single broken page
// (e.g. a failed map init) shows a message instead of unmounting the whole hub
// and leaving a grey screen. `resetKey` (the route path) clears the error on
// navigation so other tabs keep working.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('[hub] page crashed:', error, info)
  }

  componentDidUpdate(prevProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null })
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="hub-error">
          <h2 className="hub-error__title">Une erreur est survenue sur cette page</h2>
          <p className="hub-error__msg">
            {String(this.state.error?.message || this.state.error)}
          </p>
          <button
            type="button"
            className="hub-error__btn"
            onClick={() => this.setState({ error: null })}
          >
            Réessayer
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
