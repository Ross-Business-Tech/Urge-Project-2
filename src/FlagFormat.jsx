import { FLAG_FIELD_DOCS, makeFlag, missingDataFlag, MODULE_LAYERS } from './modules/shared/index.js'

// Examples are built with the same code that enforces the rules, so this page cannot drift from what is actually allowed.
const EXAMPLE = makeFlag({
  id: 'M3D-contingency-low',
  module: 'M3D',
  stage_used: 'development',
  severity: 'high',
  title: 'The budget keeps very little money aside for surprises.',
  evidence: 'Contingency 2.1% of hard costs vs. a 5% to 10% benchmark.',
  cell_refs: ['Development Project 1 Budget!G40', 'Development Project 1 Budget!G45'],
  follow_up: 'Why is the construction contingency so low, and who pays for an overrun?',
})

const MISSING = missingDataFlag({
  module: 'M3D',
  stage_used: 'development',
  check: 'contingency-low',
  checkTitle: 'Contingency size',
  missing: ['No development budget entered', 'fill in: Development budget'],
})

function Example({ title, note, flag }) {
  return (
    <section className="card plain">
      <div className="body">
        <p className="file-name">{title}</p>
        <p className="note">{note}</p>
        <dl className="flag-example">
          {Object.entries(flag).map(([key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>{Array.isArray(value) ? (value.length ? value.join(', ') : '(none)') : value === '' ? '(empty)' : String(value)}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  )
}

export default function FlagFormat() {
  return (
    <>
      <p className="note">
        Every risk module hands back flags in exactly this shape. A flag with any mistake is refused when it is made, so the module that combines them
        never has to guess. The layers: {Object.entries(MODULE_LAYERS).map(([m, l]) => `${m} is layer ${l}`).join(', ')}.
      </p>
      <ul className="items">
        {FLAG_FIELD_DOCS.map((d) => (
          <li key={d.field}>
            <span>
              <strong>{d.field}</strong>: {d.meaning}
              <br />
              <span className="help">{d.rule}</span>
            </span>
          </li>
        ))}
      </ul>
      <h2>Examples</h2>
      <Example title="A finding" note="What a module returns when a check finds something." flag={EXAMPLE} />
      <Example title="A check that could not run" note="When data is missing the module still returns a low-severity flag, so nothing is skipped silently." flag={MISSING} />
      <p className="note">
        If a module crashes, or returns something that is not a valid flag, the review shows a medium-severity &quot;checks could not be completed&quot; flag
        for that module instead of losing it. A module can only raise flags under its own name.
      </p>
    </>
  )
}
