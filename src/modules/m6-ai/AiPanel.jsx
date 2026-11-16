import { useEffect, useMemo, useRef, useState } from 'react'
import { projectReadiness } from '../shared/index.js'
import { AI_CONFIG } from '../../aiConfig.js'
import { collectFlags } from './collect.js'
import { buildPayload, fitPayload } from './payload.js'
import { restore } from './deidentify.js'
import { askGateway } from './client.js'
import { validateAnswer } from './validate.js'
import { buildEvidence } from './evidence.js'
import './ai.css'

// M6: the AI second opinion. The fixed checks decide; the AI only connects the biggest findings and screens the data lightly.
// Nothing is sent until the reviewer presses the button. Names and addresses are replaced before anything leaves the device,
// and the AI's answer is checked against the data before any of it is shown.

const OPINION = {
  agrees: ['Agrees with the checks', 'good'],
  agrees_with_caveats: ['Agrees, with caveats', 'amber'],
  disagrees: ['Disagrees with a check', 'warn'],
  cannot_tell: ['Cannot tell', ''],
}
const SEVERITY_CHIP = { high: 'warn', medium: 'amber', low: '' }
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

function Unverified({ item }) {
  if (!item.unverified?.length) return null
  return <p className="ai-unverified">Contains a figure not found in the review data: {item.unverified.join(', ')}. Check it before relying on it.</p>
}

// The AI's answer, as plain prose. It carries no sources at all. The findings and cells it relied on are numbered and kept
// together in the Evidence box that follows, each connected to the ideas it supports and the figures it explains (see
// evidence.js). Two cards: the answer, then its evidence.
export function AnswerView({ outcome, flags, map, data = [] }) {
  const { answer, dropped, askedAt, truncated } = outcome
  const rs = (t) => restore(t, map)
  const evidence = useMemo(() => buildEvidence(answer, flags, data), [answer, flags, data])
  const [copied, setCopied] = useState(false)
  const [label, tone] = OPINION[answer.second_opinion]
  const removed = dropped.filter((d) => !/only the first/.test(d.reason)).length
  const questionText = answer.questions.map((q, i) => `${i + 1}. ${rs(q.question)}`).join('\n')
  // A finding's title is a sentence that ends in a full stop; drop it so it can sit in front of other words.
  const titleOf = (id) => flags.find((f) => f.id === id)?.title?.replace(/[.\s]+$/, '')

  async function copy() {
    try {
      await navigator.clipboard.writeText(questionText)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <>
      <div className="card plain">
        <div className="body ai-answer">
          <p className="ai-label">
            <strong>AI second opinion</strong>
            <span> · {askedAt}</span>
          </p>
          <p className="note">Advice only. The checks above decide, and nothing here changes them.</p>
          <p>
            <span className={`chip ${tone}`}>{label}</span> <span className="note">Confidence: {answer.confidence}{answer.confidence_reason ? `. ${rs(answer.confidence_reason)}` : ''}</span>
          </p>
          <p className="ai-summary">{rs(answer.summary)}</p>
          <Unverified item={answer} />

          {answer.connections.length > 0 && (
            <section>
              <p className="section-label">How the biggest findings connect</p>
              <ul className="ai-list">
                {answer.connections.map((c) => (
                  <li key={c.headline}>
                    <p className="ai-head">{rs(c.headline)}</p>
                    <p>
                      {rs(c.explanation)}
                    </p>
                    {c.check_first && titleOf(c.check_first) && (
                      <p className="note">
                        Start with: {titleOf(c.check_first)}
                      </p>
                    )}
                    <Unverified item={c} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          {answer.look_first.length > 0 && (
            <section>
              <p className="section-label">Look at these first</p>
              <ol className="ai-list">
                {answer.look_first.map((l) => (
                  <li key={l.flag_id}>
                    {titleOf(l.flag_id) && <strong>{titleOf(l.flag_id)}. </strong>}
                    {rs(l.reason)}
                    <Unverified item={l} />
                  </li>
                ))}
              </ol>
            </section>
          )}

          {answer.questions.length > 0 && (
            <section>
              <p className="section-label">Questions to put to the sponsor</p>
              <ol className="ai-list">
                {answer.questions.map((q) => (
                  <li key={q.question}>
                    {rs(q.question)}
                    {q.reason && <span className="note"> {rs(q.reason)}</span>}
                    <Unverified item={q} />
                  </li>
                ))}
              </ol>
              <button type="button" className="button small" onClick={copy}>
                {copied ? 'Copied' : 'Copy questions as a list'}
              </button>
            </section>
          )}

          <section>
            <p className="section-label">Light data screen</p>
            {answer.integrity_screen.length === 0 ? (
              <p className="note">Nothing clear found beyond what the checks already flag.</p>
            ) : (
              <ul className="ai-list">
                {answer.integrity_screen.map((i) => (
                  <li key={i.title}>
                    <p className="ai-head">
                      {rs(i.title)} <span className="note">({i.confidence} confidence)</span>
                    </p>
                    <p>
                      {rs(i.why)}
                    </p>
                    <Unverified item={i} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          {answer.cannot_tell.length > 0 && (
            <section>
              <p className="section-label">What it could not tell</p>
              <ul className="ai-list">
                {answer.cannot_tell.map((c) => (
                  <li key={c.what}>
                    {rs(c.what)}
                    {c.would_settle_it && <span className="note"> Would settle it: {rs(c.would_settle_it)}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {removed > 0 && <p className="note">{plural(removed, 'statement')} from the AI {removed === 1 ? 'was' : 'were'} removed because {removed === 1 ? 'it' : 'they'} did not point at a real finding or cell.</p>}
          {truncated && <p className="note">The AI’s answer was cut off for length, so it may be incomplete.</p>}
        </div>
      </div>

      {evidence.entries.length > 0 && (
        <div className="card plain ai-evidence" aria-label="Evidence">
          <div className="body">
            <p className="section-label">Evidence behind this opinion</p>
            <p className="note">These are the checks’ own findings, and the spreadsheet cells, that the AI relied on, in the order it used them. Under each: the ideas it supports, and which figures in the answer it explains. They come from the rules and your workbook, not from the AI.</p>
            <ol className="ai-evidence-list">
              {evidence.entries.map((e) => (
                <li key={e.n} id={`ai-evidence-${e.n}`}>
                  <span className="ai-ref-num">{e.n}</span>
                  <div>
                    {e.kind === 'finding' ? (
                      <>
                        <p>
                          <span className={`chip ${SEVERITY_CHIP[e.flag.severity] ?? ''}`}>{e.flag.severity}</span> {e.flag.title}
                        </p>
                        <p className="note ai-ev-text">{e.flag.evidence}</p>
                      </>
                    ) : (
                      <>
                        <p>
                          Spreadsheet cell <span className="chip cell">{e.cell}</span>
                        </p>
                        {e.label && (
                          <p className="note ai-ev-text">
                            {e.label}: <strong>{e.value}</strong>
                          </p>
                        )}
                      </>
                    )}
                    {e.supports.length > 0 && (
                      <p className="ai-ev-link">
                        <span className="ai-ev-key">Supports</span> {e.supports.map((t) => rs(t)).join(' · ')}
                      </p>
                    )}
                    {e.figures.length > 0 && (
                      <p className="ai-ev-link">
                        <span className="ai-ev-key">Explains</span> {e.figures.join(', ')}
                      </p>
                    )}
                    {e.kind === 'finding' && <p className="note ai-ev-id">{e.flag.id}</p>}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </>
  )
}

export default function AiPanel({ record, firm, settings, result }) {
  const ready = projectReadiness(record).ready
  const gathered = useMemo(() => {
    try {
      const { flags, notes } = collectFlags(record, { firm, settings, result })
      return { ok: true, flags, ...buildPayload({ record, firm, settings, result, flags, notes }) }
    } catch {
      return { ok: false, flags: [], payload: null, map: [] }
    }
  }, [record, firm, settings, result])

  const [code, setCode] = useState('')
  const [phase, setPhase] = useState('idle')
  const [error, setError] = useState('')
  const [outcome, setOutcome] = useState(null)
  const controller = useRef(null)
  useEffect(() => () => controller.current?.abort(), [])
  // An answer belongs to the review it was asked about. If the stage, date or any value is edited afterwards, it no longer applies.
  const shown = outcome?.forRecord === record ? outcome : null
  const stale = Boolean(outcome) && !shown

  const fitted = useMemo(() => (gathered.ok ? fitPayload(gathered.payload) : null), [gathered])
  const sendText = useMemo(() => (fitted ? JSON.stringify(fitted.payload, null, 2) : ''), [fitted])
  const counts = ['high', 'medium', 'low'].map((s) => [s, gathered.flags.filter((f) => f.severity === s).length])
  const canAsk = AI_CONFIG.enabled && ready && gathered.ok && code.trim() !== '' && phase !== 'working' && !fitted?.tooLarge

  async function ask() {
    setError('')
    setOutcome(null)
    setPhase('working')
    controller.current = new AbortController()
    const res = await askGateway({ url: AI_CONFIG.gatewayUrl, code: code.trim(), payload: fitted.payload, signal: controller.current.signal })
    if (!res.ok) {
      setPhase('idle')
      if (res.error !== 'cancelled') setError(res.message)
      return
    }
    const checked = validateAnswer(res.text, fitted.payload)
    if (!checked.ok) {
      setPhase('idle')
      setError(checked.reason)
      return
    }
    setOutcome({ forRecord: record, answer: checked.answer, dropped: checked.dropped, askedAt: new Date().toLocaleString(), truncated: res.stopReason === 'max_tokens' })
    setPhase('done')
  }

  if (!AI_CONFIG.enabled) return <p className="banner warn">The AI review is switched off in this version of the app.</p>

  return (
    <section className="ai-panel">
      <div className="card plain">
        <div className="body">
          <p className="section-label">What the checks found</p>
          {gathered.flags.length === 0 ? (
            <p className="note">The checks raised no findings for this project.</p>
          ) : (
            <>
              <p className="note">
                {counts.map(([s, n]) => `${n} ${s}`).join(' · ')}. These come from the rules. The AI opinion below only adds to them.
              </p>
              <ul className="ai-list">
                {gathered.flags.slice(0, 5).map((f) => (
                  <li key={f.id}>
                    <span className={`chip ${SEVERITY_CHIP[f.severity] ?? ''}`}>{f.severity}</span> {f.title}
                  </li>
                ))}
              </ul>
              {gathered.flags.length > 5 && <p className="note">+{plural(gathered.flags.length - 5, 'more finding')} on the other screens.</p>}
            </>
          )}
        </div>
      </div>

      <div className="card plain">
        <div className="body">
          <p className="section-label">AI second opinion</p>
          <p>It connects the biggest findings into one story and screens the data lightly for problems the checks may have missed. It is advice, never a decision, and every statement is checked against the data before you see it.</p>

          <div className="banner warn ai-notice">
            <p>
              <strong>What happens when you press the button.</strong> A reduced copy of this review is sent through the AI service to an outside AI provider: the checks’ findings, key numbers, sponsor scores and a table of entered values. Names and addresses are replaced with labels such as [Project A] first. Nothing is sent until you press the button, and this app stores nothing.
            </p>
          </div>

          <details className="ai-sent">
            <summary>See exactly what would be sent ({fitted ? `${(sendText.length / 1024).toFixed(1)} KB` : 'not available'})</summary>
            {fitted?.trimmed.length > 0 && <p className="note">To keep it small, {fitted.trimmed.join(' and ')}.</p>}
            <pre>{sendText}</pre>
          </details>

          {!ready && <p className="banner warn">Choose a stage and an “as of” date for this project first (above).</p>}

          <label className="field">
            <span>Access code (from whoever runs the AI service)</span>
            <input type="password" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" spellCheck="false" />
            <span className="help">Kept only on this screen while it is open. It is not saved.</span>
          </label>

          <div className="actions">
            <button type="button" className="button primary" disabled={!canAsk} onClick={ask}>
              {phase === 'working' ? 'Asking the AI…' : 'Get AI second opinion'}
            </button>
            {phase === 'working' && (
              <button type="button" className="button" onClick={() => controller.current?.abort()}>
                Cancel
              </button>
            )}
          </div>

          <div aria-live="polite">
            {phase === 'working' && <p className="note">Asking the AI. If the service has been idle it may be waking up, which can take about a minute.</p>}
            {error && <p className="banner warn">{error}</p>}
          </div>
        </div>
      </div>

      {stale && <p className="banner warn">The review was changed after the last answer, so that answer was cleared. Ask again to get a new one.</p>}
      {shown && <AnswerView outcome={shown} flags={gathered.flags} map={gathered.map} data={fitted?.payload.data ?? []} />}
    </section>
  )
}
