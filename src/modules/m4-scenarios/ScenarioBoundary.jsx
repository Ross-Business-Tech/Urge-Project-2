import { Component } from 'react'

// If the scenario screen ever crashes, say so here and leave the rest of the page working. Without this, a problem in
// this one panel would blank the whole review screen.
export class ScenarioBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error) {
    console.error('The scenario screen crashed:', error)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div role="alert" className="banner warn">
        <p>
          <strong>The scenarios could not be shown for this project.</strong>
        </p>
        <p>The rest of the review is not affected, and nothing was lost.</p>
        <button type="button" className="button small" onClick={() => this.setState({ error: null })}>
          Try again
        </button>
      </div>
    )
  }
}
