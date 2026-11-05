import { useState } from 'react'
import { keyRatios, fmt, SETTING_DEFS, DEFAULT_SETTINGS, checkSetting, parseInput, formatForInput } from './modules/shared/index.js'

const STATUS = {
  ok: { label: 'meets your settings', className: 'good' },
  watch: { label: 'watch', className: 'amber' },
  concern: { label: 'concern', className: 'warn' },
}

function display(ratio) {
  switch (ratio.unit) {
    case 'times':
      return fmt.times(ratio.value)
    case 'percent':
      return fmt.pct(ratio.value)
    case 'months':
      return `${ratio.value.toFixed(1)} months`
    default:
      return String(ratio.value)
  }
}

// The headline ratios for a project's stage. A ratio that cannot be worked out says why and offers to jump to the group to fill in.
export function KeyRatios({ record, settings, onOpenGroup }) {
  if (!record.data.stage.stage) {
    return (
      <>
        <p className="section-label">Key ratios</p>
        <p className="note">Choose a stage above to see this project&apos;s key ratios.</p>
      </>
    )
  }
  const ratios = keyRatios(record, settings)
  return (
    <>
      <p className="section-label">Key ratios ({ratios.length})</p>
      <ul className="ratios">
        {ratios.map((r) => (
          <li key={r.id} className={`ratio${r.ok ? '' : ' na'}`}>
            <div className="ratio-top">
              <span className="ratio-title">{r.title}</span>
              {r.ok && r.status && <span className={`chip ${STATUS[r.status].className}`}>{STATUS[r.status].label}</span>}
            </div>
            <div className={r.ok ? 'ratio-value' : 'ratio-value muted'}>{r.ok ? display(r) : 'Not available'}</div>
            {r.ok && r.detail?.map((line) => (
              <p className="ratio-detail" key={line}>
                {line}
              </p>
            ))}
            {!r.ok && <p className="ratio-detail">{r.reason}</p>}
            {!r.ok && r.needs.length > 0 && (
              <p className="ratio-detail">
                {r.needs.map((n) => (
                  <button type="button" className="link needs" key={n.group} onClick={() => onOpenGroup(n.group)}>
                    Fill in: {n.label}
                  </button>
                ))}
              </p>
            )}
          </li>
        ))}
      </ul>
    </>
  )
}

function SettingInput({ def, value, onChange }) {
  const [error, setError] = useState(null)
  return (
    <label className="edit-field">
      <span className="edit-label">{def.label}</span>
      <span className="input-wrap">
        <input
          key={`${def.key}|${value}`}
          type="text"
          inputMode="decimal"
          defaultValue={formatForInput(def.type, value)}
          onBlur={(e) => {
            const parsed = parseInput(def.type, e.target.value)
            const checked = parsed.error ? parsed : checkSetting(def.key, parsed.value)
            if (checked.error) setError(checked.error)
            else {
              setError(null)
              e.target.value = formatForInput(def.type, checked.value)
              onChange({ [def.key]: checked.value })
            }
          }}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
        {def.type === 'percent' && <span className="unit">%</span>}
        {def.type === 'number' && def.key === 'minDscr' && <span className="unit">×</span>}
      </span>
      {error && (
        <span className="field-error" role="alert">
          {error}
        </span>
      )}
      <span className="prov">{def.hint}</span>
    </label>
  )
}

// The adjustable thresholds (section 1f). They apply to every project in the review and are saved with it.
export function SettingsPanel({ settings, onChange }) {
  const isDefault = SETTING_DEFS.every((d) => settings[d.key] === DEFAULT_SETTINGS[d.key])
  return (
    <details className="card">
      <summary>
        <span className="title">Settings used by the ratios</span>
        <span className="size">{isDefault ? 'default values' : 'changed from the defaults'}</span>
      </summary>
      <div className="body">
        <div className="editor-body">
          {SETTING_DEFS.map((def) => (
            <SettingInput key={def.key} def={def} value={settings[def.key]} onChange={onChange} />
          ))}
          <button type="button" className="button small" disabled={isDefault} onClick={() => onChange({ ...DEFAULT_SETTINGS })}>
            Reset to the defaults
          </button>
        </div>
      </div>
    </details>
  )
}
