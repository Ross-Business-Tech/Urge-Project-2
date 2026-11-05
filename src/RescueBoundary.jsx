import { Component } from 'react'
import { downloadReview, rescueStore } from './download.js'

// If anything on the review screen crashes, show this instead of a blank page, and offer to save the last good state.
export class RescueBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error) {
    console.error('The review screen crashed:', error)
  }

  render() {
    if (!this.state.error) return this.props.children
    const canSave = Boolean(rescueStore.current)
    return (
      <div role="alert" className="banner warn">
        <p>
          <strong>Something went wrong showing this review.</strong>
        </p>
        <p>{canSave ? 'Your work is not lost. Save it to a file first, then start over.' : 'There is nothing to save yet. Start over to try again.'}</p>
        <div className="actions">
          {canSave && (
            <button type="button" className="button primary" onClick={() => downloadReview(rescueStore.current)}>
              Save what I have
            </button>
          )}
          <button type="button" className="button" onClick={this.props.onReset}>
            Start over
          </button>
        </div>
      </div>
    )
  }
}
