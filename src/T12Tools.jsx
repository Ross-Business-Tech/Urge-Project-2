import { useState } from 'react'
import { buildT12Template, parseT12Template, replaceT12Rows, ImportError, MAX_FILE_BYTES } from './modules/shared/index.js'
import { downloadBytes } from './download.js'

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

// Buttons above the T-12 form: get the template, and load one that has been filled in. A loaded T-12 replaces the rows
// already there (after asking), and anything that could not be read is listed instead of guessed.
export function T12Tools({ record, onEdit }) {
  const [outcome, setOutcome] = useState(null)

  async function load(file) {
    if (!file) return
    if (file.size > MAX_FILE_BYTES) {
      setOutcome({ ok: false, message: 'That file is larger than 25 MB, which is too big for this tool.' })
      return
    }
    try {
      const parsed = parseT12Template(new Uint8Array(await file.arrayBuffer()))
      const existing = record.data.t12.rows.length
      if (existing > 0 && !window.confirm(`This will replace the ${existing} month${existing === 1 ? '' : 's'} already entered for this project. Replace them?`)) return
      onEdit((r) => replaceT12Rows(r, parsed))
      setOutcome({ ok: true, message: `Loaded ${parsed.rows.length} month${parsed.rows.length === 1 ? '' : 's'} from ${file.name}.`, notes: parsed.notes })
    } catch (err) {
      setOutcome({ ok: false, message: err instanceof ImportError ? err.message : 'Something went wrong reading that file. Please use the T-12 template (.xlsx).' })
    }
  }

  return (
    <div className="t12-tools">
      <p className="note">Type the months in below, or fill in the T-12 template and load it. Loading replaces the months already entered.</p>
      <div className="actions">
        <button type="button" className="button small" onClick={() => downloadBytes(buildT12Template(), 't12-template.xlsx', XLSX_TYPE)}>
          Download the T-12 template
        </button>
        <label className="button small file-button">
          <input
            type="file"
            accept=".xlsx,.xlsm"
            onChange={(e) => {
              load(e.target.files?.[0])
              e.target.value = ''
            }}
          />
          Load a filled-in T-12
        </label>
      </div>
      {outcome && (
        <p className={outcome.ok ? 'ok' : 'problem'} role={outcome.ok ? 'status' : 'alert'}>
          {outcome.message}
        </p>
      )}
      {outcome?.notes?.length > 0 && (
        <ul className="notes">
          {outcome.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
