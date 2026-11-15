// M6: the AI second opinion (layer 6). "What do the biggest findings mean together, and does the data itself look sound?"
//
// The checks decide; the AI advises. It connects the biggest findings of M1 to M5 and gives a light screen of the data, and it
// can only show what survives validateAnswer. Everything the AI says is checked against the data it was sent.
//
//   collectFlags(record, { firm, settings, result })   what every module found for one project
//   buildPayload(...)   the reduced, name-free copy that would be sent (and the map to put names back on screen)
//   askGateway(...)     sends it to the AI gateway (ai-gateway/ in this repository), which holds the provider's key
//   validateAnswer(text, payload)   checks the answer before any of it is shown
export { collectFlags } from './collect.js'
export { buildPayload, fitPayload, dataTable } from './payload.js'
export { buildNameMap, deidentify, restore, leaks } from './deidentify.js'
export { askGateway } from './client.js'
export { validateAnswer, CAPS } from './validate.js'
export { exampleAnswer } from './example.js'
