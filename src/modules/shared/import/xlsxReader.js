// A small reader for Excel workbooks (.xlsx and .xlsm). Built by M0.
//
// A workbook is a zip file of XML parts. This reader opens the zip, lists the tabs with their visibility, and reads
// individual cells on request. It never runs macros, never follows links, and only inflates the parts it needs.
// It does not use a general XML parser, so there is nothing to expand or execute. It reads only the few XML shapes
// a workbook uses for sheets, shared strings and the tab list.

import { unzipSync } from 'fflate'

export const MAX_FILE_BYTES = 25 * 1024 * 1024
const MAX_PART_BYTES = 60 * 1024 * 1024

export class ImportError extends Error {}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

function decode(text) {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (match, entity) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ''
    }
    return ENTITIES[entity] ?? match
  })
}

function readAttributes(text) {
  const out = {}
  for (const m of text.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) out[m[1]] = decode(m[2])
  return out
}

const bytesToText = (bytes) => new TextDecoder('utf-8').decode(bytes)

// Text of every <t> element inside a block, skipping phonetic runs.
function textOf(block) {
  const withoutPhonetic = block.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '')
  let out = ''
  for (const m of withoutPhonetic.matchAll(/<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g)) out += decode(m[1] ?? '')
  return out
}

function readSharedStrings(xml) {
  const out = []
  for (const m of xml.matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)) out.push(textOf(m[1] ?? ''))
  return out
}

// Turn a relationship target into the path of the part inside the zip.
function resolveTarget(target) {
  if (target.startsWith('/')) return target.slice(1)
  return 'xl/' + target.replace(/^\.\//, '')
}

function parseSheet(xml, sharedStrings) {
  const cells = new Map()
  for (const m of xml.matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const attrs = readAttributes(m[1])
    const ref = attrs.r
    const body = m[2]
    if (!ref || body === undefined) continue
    const hasFormula = /<f\b/.test(body)
    const vMatch = body.match(/<v\b[^>]*?>([\s\S]*?)<\/v>/)
    const raw = vMatch ? decode(vMatch[1]) : null
    let kind = 'blank'
    let value = null
    switch (attrs.t) {
      case 's':
        kind = 'text'
        value = raw === null ? null : (sharedStrings[Number(raw)] ?? null)
        break
      case 'str':
        kind = 'text'
        value = raw
        break
      case 'inlineStr':
        kind = 'text'
        value = textOf(body)
        break
      case 'b':
        kind = 'boolean'
        value = raw === '1'
        break
      case 'e':
        kind = 'error'
        value = raw
        break
      case 'd':
        kind = 'text'
        value = raw
        break
      default:
        if (raw !== null && raw !== '') {
          const n = Number(raw)
          if (Number.isFinite(n)) {
            kind = 'number'
            value = n
          }
        }
    }
    if (kind === 'blank') continue
    cells.set(ref, { kind, value, formula: hasFormula })
  }
  return cells
}

// Open a workbook from its bytes. Returns an object with the tab list and a way to read each tab.
export function openWorkbook(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new ImportError('Could not read that file.')
  if (bytes.length > MAX_FILE_BYTES) {
    throw new ImportError('That file is larger than 25 MB, which is too big for this tool.')
  }
  const isZip = bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b
  if (!isZip) {
    throw new ImportError('That does not look like an Excel workbook. Please use an .xlsx or .xlsm file.')
  }

  const inflate = (wanted) => {
    try {
      return unzipSync(bytes, { filter: (f) => wanted.includes(f.name) && f.originalSize <= MAX_PART_BYTES })
    } catch {
      throw new ImportError('That file could not be opened. It may be damaged or password protected.')
    }
  }

  const head = inflate(['xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/sharedStrings.xml'])
  if (!head['xl/workbook.xml'] || !head['xl/_rels/workbook.xml.rels']) {
    throw new ImportError('That does not look like an Excel workbook. Please use an .xlsx or .xlsm file.')
  }

  const rels = new Map()
  for (const m of bytesToText(head['xl/_rels/workbook.xml.rels']).matchAll(/<Relationship\b([^>]*?)\/?>/g)) {
    const a = readAttributes(m[1])
    if (a.Id && a.Target) rels.set(a.Id, { target: a.Target, type: a.Type || '' })
  }

  const sheets = []
  for (const m of bytesToText(head['xl/workbook.xml']).matchAll(/<sheet\b([^>]*?)\/?>/g)) {
    const a = readAttributes(m[1])
    const rel = rels.get(a['r:id'])
    if (!a.name || !rel) continue
    sheets.push({
      name: a.name,
      state: a.state === 'hidden' || a.state === 'veryHidden' ? a.state : 'visible',
      part: resolveTarget(rel.target),
      isWorksheet: /\/worksheet$/.test(rel.type),
    })
  }

  const sharedStrings = head['xl/sharedStrings.xml'] ? readSharedStrings(bytesToText(head['xl/sharedStrings.xml'])) : []
  const cache = new Map()

  return {
    sheets,
    hasSheet: (name) => sheets.some((s) => s.name === name && s.isWorksheet),
    // The cells of one tab, as a Map from address (such as "C8") to { kind, value, formula }.
    cells(name) {
      if (cache.has(name)) return cache.get(name)
      const sheet = sheets.find((s) => s.name === name && s.isWorksheet)
      if (!sheet) return null
      const parts = inflate([sheet.part])
      const xml = parts[sheet.part]
      const cells = xml ? parseSheet(bytesToText(xml), sharedStrings) : new Map()
      cache.set(name, cells)
      return cells
    },
  }
}
