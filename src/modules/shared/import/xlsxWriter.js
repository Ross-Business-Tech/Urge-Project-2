// A small writer for Excel workbooks (.xlsx). Built by M0. Used to produce the T-12 template, and by the tests to build
// fake workbooks.
//
// Writes a complete, valid package (content types, relationships, styles) so the file opens in Excel, Numbers and
// LibreOffice, with a few ready-made cell styles: header, date, percent, money and note.
//
// Cells: { A1: 'text' | 123 | true | { error: '#REF!' } | { formula: 'A1+1', value: 3 } | { v: 123, s: 'money' } | { s: 'date' } }
// Sheets: [{ name, state?: 'hidden' | 'veryHidden', cells, widths?: [14, 20, ...], rawXml? }]

import { zipSync, strToU8 } from 'fflate'

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const PKG_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'

export const STYLE_IDS = { header: 1, date: 2, percent: 3, money: 4, note: 5 }

const STYLES_XML =
  `<styleSheet xmlns="${NS}">` +
  '<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/></numFmts>' +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFE8EEFC"/><bgColor indexed="64"/></patternFill></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="6">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf>' +
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="9" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>' +
  '</cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>'

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Characters XML cannot hold are removed, so a cell can never produce a broken file.
const clean = (s) =>
  Array.from(String(s), (ch) => {
    const c = ch.codePointAt(0)
    return (c < 32 && c !== 9 && c !== 10 && c !== 13) || c === 0xfffe || c === 0xffff ? '' : ch
  }).join('')

function cellXml(addr, cell, shared) {
  const spec = cell !== null && typeof cell === 'object' && !('error' in cell) && !('formula' in cell) ? cell : { v: cell }
  const style = spec.s ? ` s="${STYLE_IDS[spec.s]}"` : ''
  const v = spec.v
  if (v === undefined || v === null) return `<c r="${addr}"${style}/>`
  if (typeof v === 'number') return `<c r="${addr}"${style}><v>${v}</v></c>`
  if (typeof v === 'boolean') return `<c r="${addr}"${style} t="b"><v>${v ? 1 : 0}</v></c>`
  if (typeof v === 'string') {
    const text = clean(v)
    return shared ? `<c r="${addr}"${style} t="s"><v>${shared(text)}</v></c>` : `<c r="${addr}"${style} t="inlineStr"><is><t xml:space="preserve">${esc(text)}</t></is></c>`
  }
  if (v.error) return `<c r="${addr}"${style} t="e"><v>${esc(v.error)}</v></c>`
  if (v.formula !== undefined) {
    return typeof v.value === 'string'
      ? `<c r="${addr}"${style} t="str"><f>${esc(v.formula)}</f><v>${esc(v.value)}</v></c>`
      : `<c r="${addr}"${style}><f>${esc(v.formula)}</f><v>${v.value}</v></c>`
  }
  throw new Error(`Cannot write cell ${addr}`)
}

const colNumber = (addr) => [...addr.match(/^[A-Z]+/)[0]].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0)

export function writeXlsx({ sheets, date1904 = false, sharedStrings = false, extraParts = {} }) {
  const sst = []
  const shared = sharedStrings ? (s) => (sst.includes(s) ? sst.indexOf(s) : sst.push(s) - 1) : null
  const parts = { ...extraParts }

  sheets.forEach((sheet, i) => {
    let xml = sheet.rawXml
    if (xml === undefined) {
      const rows = new Map()
      for (const [addr, cell] of Object.entries(sheet.cells ?? {})) {
        const r = Number(addr.match(/\d+/)[0])
        if (!rows.has(r)) rows.set(r, [])
        rows.get(r).push([colNumber(addr), cellXml(addr, cell, shared)])
      }
      const body = [...rows]
        .sort((a, b) => a[0] - b[0])
        .map(([r, cells]) => `<row r="${r}">${cells.sort((a, b) => a[0] - b[0]).map((c) => c[1]).join('')}</row>`)
        .join('')
      const cols = sheet.widths ? `<cols>${sheet.widths.map((w, k) => `<col min="${k + 1}" max="${k + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : ''
      xml = `<worksheet xmlns="${NS}"><sheetViews><sheetView workbookViewId="0"/></sheetViews>${cols}<sheetData>${body}</sheetData></worksheet>`
    }
    parts[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(xml)
  })

  const sheetTags = sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}"${s.state ? ` state="${s.state}"` : ''} r:id="rId${i + 1}"/>`).join('')
  parts['xl/workbook.xml'] = strToU8(
    `<workbook xmlns="${NS}" xmlns:r="${REL_NS}"><workbookPr${date1904 ? ' date1904="1"' : ''}/><bookViews><workbookView/></bookViews><sheets>${sheetTags}</sheets></workbook>`,
  )
  const sstRel = sharedStrings ? `<Relationship Id="rId${sheets.length + 2}" Type="${REL_NS}/sharedStrings" Target="sharedStrings.xml"/>` : ''
  parts['xl/_rels/workbook.xml.rels'] = strToU8(
    `<Relationships xmlns="${PKG_REL_NS}">` +
      sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL_NS}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
      `<Relationship Id="rId${sheets.length + 1}" Type="${REL_NS}/styles" Target="styles.xml"/>${sstRel}</Relationships>`,
  )
  parts['xl/styles.xml'] = strToU8(STYLES_XML)
  if (sharedStrings) parts['xl/sharedStrings.xml'] = strToU8(`<sst xmlns="${NS}" count="${sst.length}" uniqueCount="${sst.length}">${sst.map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join('')}</sst>`)
  parts['_rels/.rels'] = strToU8(`<Relationships xmlns="${PKG_REL_NS}"><Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`)
  const ct = 'application/vnd.openxmlformats-officedocument.spreadsheetml'
  parts['[Content_Types].xml'] = strToU8(
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
      `<Override PartName="/xl/workbook.xml" ContentType="${ct}.sheet.main+xml"/>` +
      sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="${ct}.worksheet+xml"/>`).join('') +
      `<Override PartName="/xl/styles.xml" ContentType="${ct}.styles+xml"/>` +
      (sharedStrings ? `<Override PartName="/xl/sharedStrings.xml" ContentType="${ct}.sharedStrings+xml"/>` : '') +
      '</Types>',
  )
  return zipSync(parts, { level: 6 })
}
