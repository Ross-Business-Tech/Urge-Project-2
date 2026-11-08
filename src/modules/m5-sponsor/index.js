// M5: sponsor and portfolio (layer 5, cross-project). "Does this sponsor have the cash and earnings to deliver?"
//
// M5-a (this folder, so far): the firm health score, from the firm record M0 provides.
//   firmHealth(firm, projects, settings) -> { ok, score, label, parts, used, total, notes }
// M5-b (track record and credibility score) is not built yet: it waits for past-project data.

export const MODULE_ID = 'M5'

export { firmHealth, liquidityCover, globalDscr, feeDependence, leverage, WEIGHTS, LABELS, labelFor, interpolate } from './firmHealth.js'
