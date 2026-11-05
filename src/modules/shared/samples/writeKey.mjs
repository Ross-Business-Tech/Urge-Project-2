// Writes ANSWER-KEY.md next to this file. Run: node src/modules/shared/samples/writeKey.mjs
import { writeFileSync } from 'node:fs'
import { renderAnswerKey } from './answerKey.js'

writeFileSync(new URL('./ANSWER-KEY.md', import.meta.url), renderAnswerKey())
console.log('Wrote ANSWER-KEY.md')
