/**
 * Minimal deterministic PDF writer (PDF 1.4, Helvetica, text only). The same document snapshot always renders
 * to the same bytes, so a fiscal document's PDF can be reproduced from its immutable snapshot at any time.
 */
function escapePdfText(s: string): string {
  // Standard fonts use WinAnsi; replace characters outside printable ASCII to stay deterministic and valid.
  return s
    .replace(/[^\x20-\x7e]/g, '?')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

export function renderTextPdf(lines: readonly string[], title: string): Buffer {
  const pageHeight = 842;
  const top = 800;
  const lineHeight = 13;
  const perPage = Math.floor((top - 40) / lineHeight);
  const pages: string[][] = [];
  for (let i = 0; i < Math.max(lines.length, 1); i += perPage)
    pages.push(lines.slice(i, i + perPage) as string[]);
  const objects: string[] = [];
  // 1: catalog, 2: pages, 3: font, then per page: page object + content stream
  const pageObjIds = pages.map((_, i) => 4 + i * 2);
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageObjIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  pages.forEach((pageLines, i) => {
    const pageId = 4 + i * 2;
    const contentId = pageId + 1;
    const body = [
      'BT',
      '/F1 10 Tf',
      `${lineHeight} TL`,
      `40 ${top} Td`,
      ...pageLines.map((l) => `(${escapePdfText(l)}) '`),
      'ET',
    ].join('\n');
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 ${pageHeight}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${Buffer.byteLength(body, 'latin1')} >>\nstream\n${body}\nendstream`;
  });
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = Buffer.byteLength(out, 'latin1');
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) out += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R /Info << /Title (${escapePdfText(title)}) >> >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
