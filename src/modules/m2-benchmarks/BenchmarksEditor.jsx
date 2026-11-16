import { useId, useMemo, useRef, useState } from 'react'
import { METRICS, metricOf, newEntry, problemsByEntry, usableEntries, parseEntries, serializeEntries } from '../shared/index.js'
import { useBenchmarks } from '../../useBenchmarks.js'
import { downloadBytes } from '../../download.js'
import { fromText, toText, ADORNMENT } from './fields.js'
import './benchmark-editor.css'

const GROUPS = [
  { title: 'Rents, expenses and costs', ids: ['rent', 'expense', 'costHard', 'costSoft', 'costTotal', 'contingency'] },
  { title: 'Loans and returns', ids: ['interestRate', 'dscr', 'debtToCost', 'equityShare', 'breakEven', 'yieldOnCost', 'debtYield', 'vacancy'] },
]

const NONE = []

const helpFor = (metric) => {
  if (metric.help) return metric.help
  if (metric.kind === 'ratio') return `Flagged most strongly when the figure is ${metric.risky} your range; the other side is noted more gently.`
  return null
}

// One figure box. It keeps what is being typed, so "6." or "1,4" is not rewritten under the cursor.
function NumberBox({ label, unit, value, onChange, optional }) {
  const id = useId()
  const [text, setText] = useState(() => toText(unit, value))
  return (
    <label className="field be-number" htmlFor={id}>
      <span>
        {label}
        {optional && <em> (optional)</em>}
      </span>
      <span className="be-input">
        {unit !== 'percent' && unit !== 'times' && <span className="be-adorn" aria-hidden="true">{ADORNMENT[unit]}</span>}
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            onChange(fromText(unit, e.target.value))
          }}
        />
        {(unit === 'percent' || unit === 'times') && <span className="be-adorn" aria-hidden="true">{ADORNMENT[unit]}</span>}
      </span>
    </label>
  )
}

function EntryCard({ entry, problems, onChange, onRemove }) {
  const metric = metricOf(entry.metric)
  const help = metric && helpFor(metric)
  const set = (patch) => onChange({ ...entry, ...patch })
  return (
    <li className={`be-card${problems?.length ? ' has-problem' : ''}`}>
      <div className="be-head">
        <h3>{metric?.label ?? 'Unknown benchmark'}</h3>
        <button type="button" className="button small" onClick={onRemove} aria-label={`Remove ${metric?.label ?? 'this benchmark'}`}>
          Remove
        </button>
      </div>
      {help && <p className="note">{help}</p>}
      {entry.metric === 'rent' && (
        <div className="be-row">
          <label className="field">
            <span>Unit type</span>
            <input type="text" value={entry.unitType ?? ''} placeholder="for example 2br" autoComplete="off" onChange={(e) => set({ unitType: e.target.value })} />
          </label>
          <label className="field">
            <span>
              Income level <em>(optional)</em>
            </span>
            <input type="text" value={entry.ami ?? ''} placeholder="for example 60, or blank" autoComplete="off" onChange={(e) => set({ ami: e.target.value })} />
          </label>
        </div>
      )}
      {metric && (
        <div className="be-row">
          <NumberBox label="Low" unit={metric.unit} value={entry.low} onChange={(low) => set({ low })} />
          <NumberBox label="High" unit={metric.unit} value={entry.high} onChange={(high) => set({ high })} />
          <NumberBox label="Typical" optional unit={metric.unit} value={entry.typical} onChange={(typical) => set({ typical })} />
        </div>
      )}
      {problems?.length > 0 && (
        <ul className="be-problems" role="status">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
    </li>
  )
}

// The "Benchmarks" screen: the ranges the team trusts, typed in by them. Every comparison in the app is against these.
export default function BenchmarksEditor() {
  const { entries, kept, replace } = useBenchmarks()
  const [adding, setAdding] = useState('rent')
  const [message, setMessage] = useState(null)
  const [version, setVersion] = useState(0) // changes when the whole list is replaced, so the figure boxes show the new values
  const counter = useRef(0)
  const list = entries ?? NONE
  const problems = useMemo(() => problemsByEntry(list), [list])
  const inUse = usableEntries(list).length

  const nextId = () => {
    let id
    do id = `b${Date.now().toString(36)}${(counter.current += 1)}`
    while (list.some((e) => e.id === id))
    return id
  }
  const add = () => {
    setMessage(null)
    replace([...list, newEntry(adding, nextId())])
  }
  const change = (entry) => replace(list.map((e) => (e.id === entry.id ? entry : e)))
  const remove = (id) => {
    setMessage(null)
    replace(list.filter((e) => e.id !== id))
  }
  const clearAll = () => {
    if (list.length === 0 || !window.confirm('Remove all of your benchmarks? Save them to a file first if you want to keep them.')) return
    setMessage(null)
    setVersion((v) => v + 1)
    replace([])
  }
  const saveFile = () => downloadBytes(serializeEntries(list), 'my-benchmarks.json', 'application/json')
  const openFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const read = parseEntries(await file.text())
    if (!read.ok) {
      setMessage({ bad: true, text: read.reason })
      return
    }
    setVersion((v) => v + 1)
    replace(read.entries)
    setMessage({ bad: false, text: `Opened ${read.entries.length} benchmark${read.entries.length === 1 ? '' : 's'} from ${file.name}. They replace the list that was here.` })
  }

  return (
    <section className="benchmark-editor">
      <p className="banner info" role="status">
        {list.length === 0
          ? 'You have not entered any benchmarks yet, so nothing is compared. Add the ranges you trust below, and every screen will compare the project with them.'
          : `${inUse} of ${list.length} benchmark${list.length === 1 ? ' is' : 's are'} in use. Anything you have not entered is not compared.`}
      </p>
      <p className="note">
        Use the ranges you would defend: rents from your comparables, the interest rates you are seeing, the coverage your lender requires. They apply to every project you review, so you can change them whenever the market or the deal type changes.
        {kept ? ' They are kept on this device only.' : ' This browser would not keep them, so save them to a file to avoid losing them.'}
      </p>

      {list.length > 0 && (
        <ul className="be-list" key={version}>
          {list.map((entry) => (
            <EntryCard key={entry.id} entry={entry} problems={problems[entry.id]} onChange={change} onRemove={() => remove(entry.id)} />
          ))}
        </ul>
      )}

      <div className="be-add">
        <label className="field">
          <span>What do you want to compare?</span>
          <select value={adding} onChange={(e) => setAdding(e.target.value)}>
            {GROUPS.map((g) => (
              <optgroup key={g.title} label={g.title}>
                {g.ids.map((id) => (
                  <option key={id} value={id}>
                    {METRICS.find((m) => m.id === id).label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <button type="button" className="button primary" onClick={add}>
          Add benchmark
        </button>
      </div>

      <div className="be-file actions">
        <button type="button" className="button" onClick={saveFile} disabled={list.length === 0}>
          Save to a file
        </button>
        <label className="button">
          Open a saved file
          <input type="file" accept=".json,application/json" className="be-hidden" onChange={openFile} />
        </label>
        <button type="button" className="button" onClick={clearAll} disabled={list.length === 0}>
          Remove all
        </button>
      </div>
      {message && (
        <p className={message.bad ? 'banner warn' : 'ok'} role="status">
          {message.text}
        </p>
      )}
    </section>
  )
}
