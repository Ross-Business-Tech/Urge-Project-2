// "So what?": puts the sponsor's rating next to each project's own numbers, in a sentence a reviewer can act on.
//
// A sound project under a weak sponsor is still a risk (and the risk is biggest for a project still being built, because
// the sponsor has to fund any overrun). A weak project under a strong sponsor may still be supported. The sentence says
// which of those cases applies. It uses the shared project DSCR calculator and the lender's minimum from the settings;
// it never calls another module.

import { dscr, fmt } from '../shared/calculators.js'
import { sanitizeSettings } from '../shared/settings.js'

const isWeak = (health) => health?.ok && ['Weak', 'Failing'].includes(health.label)

// One project: how it stands on its own, and what that means given the sponsor.
export function projectSoWhat(project, health, settings) {
  const min = sanitizeSettings(settings).minDscr
  const cov = dscr(project)
  const stage = project.data?.stage?.stage ?? null
  const name = project.data?.identity?.name || project.meta?.sourceTab || 'Unnamed project'
  const sponsor = health?.ok ? health.label : null
  const weak = isWeak(health)

  const base = { name, stage, key: project.meta?.projectId ?? name }
  if (!cov.ok) {
    return {
      ...base,
      state: 'unknown',
      tone: '',
      text: sponsor
        ? `The project's own coverage is not available (${cov.reason}), so only the sponsor can be judged: ${sponsor}.`
        : `The project's own coverage is not available (${cov.reason}), and the sponsor could not be scored.`,
    }
  }
  const sound = cov.value >= min
  const own = `${fmt.times(cov.value)} against the lender's minimum of ${fmt.times(min)}`
  if (!sponsor) {
    return { ...base, state: sound ? 'sound' : 'thin', tone: sound ? '' : 'amber', text: `The sponsor could not be scored, so this project is judged on its own numbers only: coverage ${own}.` }
  }
  if (sound && !weak) {
    return { ...base, state: 'sound', tone: 'good', text: `Sound on its own numbers (coverage ${own}), and the sponsor rates ${sponsor}.` }
  }
  if (sound && weak) {
    const why =
      stage === 'development'
        ? 'This matters most for a project still being built, because the sponsor has to fund any overrun or delay.'
        : 'If the project slips, this sponsor has little room to absorb a miss.'
    return { ...base, state: 'sound', tone: 'amber', text: `Sound on its own numbers (coverage ${own}), but the sponsor is the risk: it rates ${sponsor}. ${why}` }
  }
  if (!sound && !weak) {
    return { ...base, state: 'thin', tone: 'amber', text: `The sponsor rates ${sponsor}, but the project's own coverage is thin (${own}). The sponsor may have to support it.` }
  }
  return { ...base, state: 'thin', tone: 'warn', text: `A concern on both sides: the sponsor rates ${sponsor} and the project's own coverage is thin (${own}). This is the highest-risk combination.` }
}

// The whole review in one sentence, then one line per project.
export function soWhat(health, projects = [], settings) {
  const lines = projects.map((p) => projectSoWhat(p, health, settings))
  const weak = isWeak(health)
  const thin = lines.filter((l) => l.state === 'thin').length
  const sound = lines.filter((l) => l.state === 'sound').length
  const unknown = lines.filter((l) => l.state === 'unknown').length
  const many = projects.length > 1

  let headline
  let tone
  if (!health?.ok) {
    headline = 'The sponsor could not be scored, so the review rests on the project numbers alone.'
    tone = 'amber'
  } else if (projects.length === 0) {
    headline = weak ? `The sponsor rates ${health.label}. No projects are loaded to compare.` : `The sponsor rates ${health.label}. No projects are loaded to compare.`
    tone = weak ? 'amber' : ''
  } else if (weak && thin > 0) {
    headline = 'Both the sponsor and at least one project are a concern. This is the highest-risk combination.'
    tone = 'warn'
  } else if (weak && sound > 0) {
    headline = many ? 'The projects look sound on their own numbers, but the sponsor is the risk.' : 'The project is sound on its own numbers, but the sponsor is the risk.'
    tone = 'amber'
  } else if (weak) {
    headline = 'The sponsor is a concern, and the project figures are not available to balance it.'
    tone = 'amber'
  } else if (thin > 0) {
    headline = `The sponsor looks able to deliver, but ${many ? 'a project’s' : 'the project’s'} own coverage is thin, so the sponsor may have to support it.`
    tone = 'amber'
  } else if (unknown > 0) {
    headline = 'The sponsor looks sound. Some project figures are not available, so those projects are not judged.'
    tone = ''
  } else {
    headline = many ? 'The sponsor and the projects all look sound.' : 'The sponsor and the project both look sound.'
    tone = 'good'
  }
  return { headline, tone, projects: lines }
}
