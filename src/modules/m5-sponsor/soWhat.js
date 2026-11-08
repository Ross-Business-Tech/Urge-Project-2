// "So what?": puts the sponsor's rating next to each project's own numbers, in a short sentence a reviewer can act on.
//
// A sound project under a weak sponsor is still a risk (biggest for a project still being built, because the sponsor
// has to fund any overrun). A weak project under a strong sponsor may still be supported. Each sentence leads with the
// verdict and carries the numbers that show how serious it is. It uses the shared project DSCR calculator and the
// lender's minimum from the settings; it never calls another module.

import { dscr, fmt } from '../shared/calculators.js'
import { sanitizeSettings } from '../shared/settings.js'

const isWeak = (health) => health?.ok && ['Weak', 'Failing'].includes(health.label)

// "Failing (5/100)"
const rated = (health) => `${health.label} (${health.score}/100)`

// One project: how it stands on its own, and what that means given the sponsor.
export function projectSoWhat(project, health, settings) {
  const min = sanitizeSettings(settings).minDscr
  const cov = dscr(project)
  const stage = project.data?.stage?.stage ?? null
  const name = project.data?.identity?.name || project.meta?.sourceTab || 'Unnamed project'
  const weak = isWeak(health)
  const base = { name, stage, needsStage: !stage, key: project.meta?.projectId ?? name, coverage: cov.ok ? cov.value : null }

  if (!cov.ok) {
    return { ...base, state: 'unknown', tone: '', text: `Coverage not available: ${cov.reason}${health?.ok ? ` Sponsor: ${rated(health)}.` : ''}` }
  }
  const sound = cov.value >= min
  const own = `${fmt.times(cov.value)} vs ${fmt.times(min)} minimum`
  if (!health?.ok) {
    return { ...base, state: sound ? 'sound' : 'thin', tone: sound ? '' : 'amber', text: `${sound ? 'Sound' : 'Thin'}: ${own}. Sponsor not scored.` }
  }
  if (sound && !weak) return { ...base, state: 'sound', tone: 'good', text: `Sound: ${own}. Sponsor ${rated(health)}.` }
  if (sound && weak) {
    if (!stage) return { ...base, state: 'sound', tone: 'amber', text: `Sound alone (${own}), but the ${health.label} sponsor is a risk. Choose a stage to see why it matters.` }
    const cost = stage === 'development' ? 'must fund any overrun or delay' : 'has little room to absorb a miss'
    return { ...base, state: 'sound', tone: 'amber', text: `Sound alone (${own}), but the ${health.label} sponsor ${cost}.` }
  }
  if (!sound && !weak) return { ...base, state: 'thin', tone: 'amber', text: `Thin: ${own}. Sponsor ${rated(health)} may need to support it.` }
  return { ...base, state: 'thin', tone: 'warn', text: `Highest risk: thin coverage (${own}) and a ${rated(health)} sponsor.` }
}

// One line on the sponsor's track record (M5-b), or null when there is nothing to say.
// A big step up in size is part of the line, so a strong record cannot hide it.
const bigStep = (track) => track?.parts?.find((p) => p.id === 'scale' && p.ok && p.score < 55) ?? null

function trackLine(track) {
  if (!track) return null
  if (track.ok) {
    const step = bigStep(track)
    return `Track record: ${track.label} (${track.score}/100).${step ? ` The new project is ${step.step.toFixed(1)}× the largest the sponsor has completed.` : ''}`
  }
  if (track.noTrackRecord) return 'Track record: none to judge.'
  return 'Track record: not scored (no usable T-12).'
}

// The whole review in one sentence, then one line per project. `track` is the credibility result from M5-b, if any.
export function soWhat(health, projects = [], settings, track = null) {
  const min = sanitizeSettings(settings).minDscr
  const lines = projects.map((p) => projectSoWhat(p, health, settings))
  const weak = isWeak(health)
  const thin = lines.filter((l) => l.state === 'thin')
  const sound = lines.filter((l) => l.state === 'sound')
  const unknown = lines.filter((l) => l.state === 'unknown')
  const lowest = Math.min(...lines.map((l) => l.coverage).filter((v) => v !== null))
  const covText = Number.isFinite(lowest) ? `${fmt.times(lowest)}` : ''

  let headline
  let tone
  if (!health?.ok) {
    headline = 'Sponsor not scored. Judged on project numbers only.'
    tone = 'amber'
  } else if (projects.length === 0) {
    headline = `Sponsor ${rated(health)}. No projects to compare.`
    tone = weak ? 'amber' : ''
  } else if (weak && thin.length > 0) {
    headline = `Highest risk: ${rated(health)} sponsor and thin project coverage (${covText} vs ${fmt.times(min)} minimum).`
    tone = 'warn'
  } else if (weak && sound.length > 0) {
    headline = `Sponsor is the risk: ${rated(health)}. ${projects.length > 1 ? `Projects are sound (lowest ${covText})` : `Project is sound (${covText})`}.`
    tone = 'amber'
  } else if (weak) {
    headline = `Sponsor is the risk: ${rated(health)}. Project figures not available.`
    tone = 'amber'
  } else if (thin.length > 0) {
    headline = `Sponsor ${rated(health)}, but project coverage is thin (${covText} vs ${fmt.times(min)} minimum).`
    tone = 'amber'
  } else if (unknown.length > 0) {
    headline = `Sponsor ${rated(health)}. Some project figures not available.`
    tone = ''
  } else {
    headline = `Sponsor ${rated(health)} and ${projects.length > 1 ? `projects sound (lowest ${covText})` : `project sound (${covText})`}.`
    tone = 'good'
  }
  // A weak or failing track record means the review is not all clear, even if the sponsor and the projects look sound.
  if (track?.ok && (['Weak', 'Failing'].includes(track.label) || bigStep(track)) && (tone === '' || tone === 'good')) tone = 'amber'
  return { headline, tone, trackLine: trackLine(track), projects: lines }
}
