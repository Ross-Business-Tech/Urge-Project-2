// A small reader for Excel workbooks (.xlsx and .xlsm). Built by M0.
//
// A workbook is a zip file of XML parts. This reader opens the zip, lists the tabs with their visibility, and reads
// individual cells on request. It never runs macros, never follows links, never evaluates a formula, and only inflates
// the parts it needs.
//
// Hostile or damaged files are treated as normal input:
//  - It does not use a general XML parser (nothing to expand or execute) and reads each part in ONE pass over its tags,
//    so a crafted file cannot make it slow by the square of its size.
//  - The size a zip file DECLARES for a part is not trusted. The zip is fed in small slices and counted as it inflates,
//    so a forged header cannot make the page inflate gigabytes.
//  - There are limits on file size, size of each part, total size inflated, and number of cells.

import { Unzip, UnzipInflate } from 'fflate'

export const MAX_FILE_BYTES = 25 * 1024 * 1024
export const MAX_PART_BYTES = 60 * 1024 * 1024
export const MAX_TOTAL_BYTES = 200 * 1024 * 1024
export const MAX_CELLS = 2_000_000
const SLICE_BYTES = 16 * 1024 // small enough that one slice can never inflate to much more than ~16 MB

export class ImportError extends Error {}

const NOT_A_WORKBOOK = 'That does not look like an Excel workbook. Please use an .xlsx or .xlsm file.'
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

function decode(text) {
  if (!text.includes('&')) return text
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

// Walk the tags of an XML part in a single pass. Yields { tag, text }: the text inside the angle brackets and the text
// that follows it up to the next tag. Comments, CDATA and processing instructions are skipped.
function* tags(xml) {
  let pos = 0
  for (;;) {
    const lt = xml.indexOf('<', pos)
    if (lt === -1) return
    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt + 4)
      if (end === -1) return
      pos = end + 3
      continue
    }
    if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt + 9)
      if (end === -1) return
      pos = end + 3
      continue
    }
    const gt = xml.indexOf('>', lt)
    if (gt === -1) return
    const next = xml.indexOf('<', gt + 1)
    yield { tag: xml.slice(lt + 1, gt), text: next === -1 ? xml.slice(gt + 1) : xml.slice(gt + 1, next) }
    pos = gt + 1
  }
}

const isTag = (tag, name) => tag === name || tag.startsWith(`${name} `) || tag === `${name}/`

// The shared strings: each <si> holds text in <t> elements (rich text has several; phonetic runs are skipped).
function readSharedStrings(xml) {
  const out = []
  let current = null
  let skipping = 0
  for (const { tag, text } of tags(xml)) {
    if (isTag(tag, 'si')) {
      if (tag.endsWith('/')) out.push('')
      else current = ''
    } else if (tag === '/si') {
      if (current !== null) out.push(current)
      current = null
      skipping = 0
    } else if (current !== null && isTag(tag, 'rPh')) skipping++
    else if (tag === '/rPh') skipping = Math.max(0, skipping - 1)
    else if (current !== null && isTag(tag, 't') && !tag.endsWith('/') && !skipping) current += decode(text)
  }
  return out
}

// The cells of one sheet, as a Map from address ("C8") to { kind, value, formula }. Blank cells are left out.
function parseSheet(xml, sharedStrings) {
  const cells = new Map()
  let cur = null
  const finish = () => {
    if (!cur) return
    const { attrs, formula, v, inline } = cur
    cur = null
    if (!attrs.r) return
    let kind = 'blank'
    let value = null
    switch (attrs.t) {
      case 's':
        kind = 'text'
        value = v === null ? null : (sharedStrings[Number(v)] ?? null)
        break
      case 'str':
      case 'd':
        kind = 'text'
        value = v
        break
      case 'inlineStr':
        kind = 'text'
        value = inline
        break
      case 'b':
        kind = 'boolean'
        value = v === '1'
        break
      case 'e':
        kind = 'error'
        value = v
        break
      default:
        if (v !== null && v !== '') {
          const n = Number(v)
          if (Number.isFinite(n)) {
            kind = 'number'
            value = n
          }
        }
    }
    if (kind === 'blank') return
    cells.set(attrs.r, { kind, value, formula })
    if (cells.size > MAX_CELLS) throw new ImportError('One of the sheets has too many cells for this tool to read.')
  }

  for (const { tag, text } of tags(xml)) {
    if (isTag(tag, 'c')) {
      finish() // a cell that was never closed ends where the next one starts
      cur = tag.endsWith('/') ? null : { attrs: readAttributes(tag.slice(2)), formula: false, v: null, inline: '' }
    } else if (!cur) continue
    else if (tag === '/c') finish()
    else if (isTag(tag, 'v')) cur.v = decode(text)
    else if (isTag(tag, 'f')) cur.formula = true
    else if (isTag(tag, 't') && !tag.endsWith('/')) cur.inline += decode(text)
  }
  finish()
  return cells
}

// Turn a relationship target into the path of the part inside the zip.
function resolveTarget(target) {
  if (target.startsWith('/')) return target.slice(1)
  return 'xl/' + target.replace(/^\.\//, '')
}

function concat(chunks, size) {
  const out = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

// Inflate ONE named part, counting what actually comes out. Returns its bytes, or null if the zip has no such part.
function readPart(bytes, name, budget) {
  const chunks = []
  let size = 0
  let found = false
  let failure = null
  const unzip = new Unzip()
  unzip.register(UnzipInflate)
  unzip.onfile = (file) => {
    if (file.name !== name) return
    found = true
    file.ondata = (err, chunk) => {
      if (failure) return
      if (err) {
        failure = 'damaged'
        return
      }
      size += chunk.length
      if (size > MAX_PART_BYTES || size > budget.remaining) {
        failure = 'big'
        file.terminate()
        return
      }
      chunks.push(chunk)
    }
    file.start()
  }
  try {
    for (let i = 0; i < bytes.length && !failure; i += SLICE_BYTES) {
      unzip.push(bytes.subarray(i, Math.min(i + SLICE_BYTES, bytes.length)), i + SLICE_BYTES >= bytes.length)
    }
  } catch {
    failure = failure ?? 'damaged'
  }
  if (failure === 'big') throw new ImportError('That file expands to more data than this tool will read.')
  if (failure) throw new ImportError('That file could not be opened. It may be damaged or password protected.')
  budget.remaining -= size
  return found ? concat(chunks, size) : null
}

// Open a workbook from its bytes. Returns an object with the tab list and a way to read each tab.
export function openWorkbook(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new ImportError('Could not read that file.')
  if (bytes.length > MAX_FILE_BYTES) throw new ImportError('That file is larger than 25 MB, which is too big for this tool.')
  const isOleContainer = bytes.length > 8 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0
  if (isOleContainer) {
    throw new ImportError('That looks like a password-protected or old-format (.xls) Excel file. Remove the password or save it as .xlsx or .xlsm, then try again.')
  }
  const isZip = bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b
  if (!isZip) throw new ImportError(NOT_A_WORKBOOK)

  const budget = { remaining: MAX_TOTAL_BYTES }
  const workbookXml = readPart(bytes, 'xl/workbook.xml', budget)
  const relsXml = readPart(bytes, 'xl/_rels/workbook.xml.rels', budget)
  if (!workbookXml || !relsXml) throw new ImportError(NOT_A_WORKBOOK)
  const workbookText = bytesToText(workbookXml)

  const rels = new Map()
  for (const { tag } of tags(bytesToText(relsXml))) {
    if (!isTag(tag, 'Relationship')) continue
    const a = readAttributes(tag.slice(12))
    if (a.Id && a.Target) rels.set(a.Id, { target: a.Target, type: a.Type || '' })
  }

  const sheets = []
  let date1904 = false
  for (const { tag } of tags(workbookText)) {
    if (isTag(tag, 'workbookPr')) {
      const a = readAttributes(tag.slice(10))
      date1904 = a.date1904 === '1' || a.date1904 === 'true'
    } else if (isTag(tag, 'sheet')) {
      const a = readAttributes(tag.slice(6))
      const rel = rels.get(a['r:id'])
      if (!a.name || !rel) continue
      sheets.push({
        name: a.name,
        state: a.state === 'hidden' || a.state === 'veryHidden' ? a.state : 'visible',
        part: resolveTarget(rel.target),
        isWorksheet: /\/worksheet$/.test(rel.type),
      })
    }
  }

  const sharedXml = readPart(bytes, 'xl/sharedStrings.xml', budget)
  const sharedStrings = sharedXml ? readSharedStrings(bytesToText(sharedXml)) : []
  const cache = new Map()

  return {
    sheets,
    date1904, // which of Excel's two date systems the file uses
    hasSheet: (name) => sheets.some((s) => s.name === name && s.isWorksheet),
    cells(name) {
      if (cache.has(name)) return cache.get(name)
      const sheet = sheets.find((s) => s.name === name && s.isWorksheet)
      if (!sheet) return null
      const xml = readPart(bytes, sheet.part, budget)
      const cells = xml ? parseSheet(bytesToText(xml), sharedStrings) : new Map()
      cache.set(name, cells)
      return cells
    },
  }
}
