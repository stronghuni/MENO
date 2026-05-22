import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle
} from 'docx'

/**
 * Minimal Markdown → DOCX converter tuned for MENO's meeting-note format.
 * Handles the subset our prompts emit: ATX headings (#, ##, ###), bullet
 * lists (-), GFM tables (| … |), bold (**…**), and plain paragraphs. Not
 * a general Markdown engine — anything else falls through as plain text.
 */

interface InlineRun {
  text: string
  bold: boolean
}

// Split a line into bold / non-bold runs on **…** markers.
function parseInline(text: string): InlineRun[] {
  const runs: InlineRun[] = []
  const re = /\*\*(.+?)\*\*/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) runs.push({ text: text.slice(last, m.index), bold: false })
    runs.push({ text: m[1], bold: true })
    last = m.index + m[0].length
  }
  if (last < text.length) runs.push({ text: text.slice(last), bold: false })
  if (runs.length === 0) runs.push({ text, bold: false })
  return runs
}

function toRuns(text: string): TextRun[] {
  return parseInline(text).map((r) => new TextRun({ text: r.text, bold: r.bold }))
}

function isTableRow(line: string): boolean {
  return /^\s*\|.*\|\s*$/.test(line)
}
function isTableDivider(line: string): boolean {
  return /^\s*\|?[\s:-]*-[\s:|-]*\|?\s*$/.test(line) && line.includes('-')
}
function splitCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim())
}

function buildTable(rows: string[][]): Table {
  const border = { style: BorderStyle.SINGLE, size: 4, color: 'D0D0D0' }
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
    rows: rows.map(
      (cells, ri) =>
        new TableRow({
          children: cells.map(
            (cell) =>
              new TableCell({
                children: [
                  new Paragraph({
                    children: parseInline(cell).map(
                      (r) => new TextRun({ text: r.text, bold: r.bold || ri === 0 })
                    )
                  })
                ]
              })
          )
        })
    )
  })
}

export async function markdownToDocxBuffer(markdown: string, title: string): Promise<Buffer> {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const children: (Paragraph | Table)[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    if (trimmed === '') {
      i++
      continue
    }

    // Table block
    if (isTableRow(line)) {
      const block: string[] = []
      while (i < lines.length && isTableRow(lines[i])) {
        block.push(lines[i])
        i++
      }
      const rows = block
        .filter((l) => !isTableDivider(l))
        .map((l) => splitCells(l))
      if (rows.length > 0) children.push(buildTable(rows))
      children.push(new Paragraph({ text: '' }))
      continue
    }

    // Headings
    const h = /^(#{1,3})\s+(.*)$/.exec(trimmed)
    if (h) {
      const level =
        h[1].length === 1
          ? HeadingLevel.HEADING_1
          : h[1].length === 2
            ? HeadingLevel.HEADING_2
            : HeadingLevel.HEADING_3
      children.push(new Paragraph({ heading: level, children: toRuns(h[2]) }))
      i++
      continue
    }

    // Bullets
    const b = /^[-*]\s+(.*)$/.exec(trimmed)
    if (b) {
      children.push(new Paragraph({ bullet: { level: 0 }, children: toRuns(b[1]) }))
      i++
      continue
    }

    // Plain paragraph
    children.push(new Paragraph({ children: toRuns(trimmed) }))
    i++
  }

  const doc = new Document({
    title,
    sections: [{ children: children.length > 0 ? children : [new Paragraph({ text: '' })] }]
  })
  return Packer.toBuffer(doc)
}
