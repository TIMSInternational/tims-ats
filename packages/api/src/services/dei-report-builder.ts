import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';

// ---------------------------------------------------------------------------
// DEI report document builders — pure rendering, no db/tRPC imports. Consumed
// by dei.service.ts's generateReport, which assembles the AGGREGATE-ONLY
// section data (see dei.service.ts's header comment) and hands it here to be
// rendered into an actual xlsx or pdf byte buffer.
// ---------------------------------------------------------------------------

export interface ReportSection {
  key: string;
  title: string;
  columns: string[];
  rows: string[][];
  suppressed: boolean;
}

const SUPPRESSED_NOTE = 'Suppressed: at least one group is below the minimum aggregate threshold (k-anonymity).';

export async function buildXlsxReport(generatedAt: Date, sections: ReportSection[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'TIMS ATS';
  workbook.created = generatedAt;

  const summary = workbook.addWorksheet('Summary');
  summary.columns = [{ width: 42 }, { width: 36 }];
  summary.addRow(['DEI Report']);
  summary.getRow(1).font = { bold: true, size: 16 };
  summary.addRow([`Generated at: ${generatedAt.toISOString()}`]);
  summary.addRow([]);
  const summaryHeaderRow = summary.addRow(['Section', 'Status']);
  summaryHeaderRow.font = { bold: true };
  for (const section of sections) {
    summary.addRow([section.title, section.suppressed ? 'Suppressed (k-anonymity)' : `${section.rows.length} rows`]);
  }
  if (sections.length === 0) {
    summary.addRow(['No sections available for this report.']);
  }

  const usedNames = new Set<string>();
  for (const section of sections) {
    const sheetName = uniqueSheetName(section.title, usedNames);
    const sheet = workbook.addWorksheet(sheetName);
    sheet.addRow([section.title]).font = { bold: true, size: 14 };
    sheet.addRow([]);

    if (section.suppressed) {
      sheet.addRow([SUPPRESSED_NOTE]);
    } else if (section.rows.length === 0) {
      sheet.addRow(['No data available.']);
    } else {
      const headerRow = sheet.addRow(section.columns);
      headerRow.font = { bold: true };
      for (const row of section.rows) sheet.addRow(row);
      sheet.columns.forEach((col) => {
        col.width = 26;
      });
    }
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

export function buildPdfReport(generatedAt: Date, sections: ReportSection[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(20).fillColor('#000').text('DEI Report');
    doc.moveDown(0.25);
    doc.fontSize(10).fillColor('#555').text(`Generated at: ${generatedAt.toISOString()}`);
    doc.fillColor('#000');
    doc.moveDown(1);

    if (sections.length === 0) {
      doc.fontSize(11).text('No sections available for this report.');
    }

    for (const section of sections) {
      doc.fontSize(14).text(section.title);
      doc.moveDown(0.25);

      if (section.suppressed) {
        doc.fontSize(10).fillColor('#a00').text(SUPPRESSED_NOTE);
        doc.fillColor('#000');
      } else if (section.rows.length === 0) {
        doc.fontSize(10).text('No data available.');
      } else {
        doc.fontSize(10).font('Helvetica-Bold').text(section.columns.join('   |   '));
        doc.font('Helvetica');
        doc.moveDown(0.15);
        for (const row of section.rows) {
          doc.text(row.join('   |   '));
        }
      }
      doc.moveDown(1);
    }

    doc.end();
  });
}

// Excel worksheet names are capped at 31 chars and must be unique within a workbook.
function uniqueSheetName(title: string, used: Set<string>): string {
  const base = title.slice(0, 31);
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    const suffixStr = ` (${suffix})`;
    candidate = base.slice(0, 31 - suffixStr.length) + suffixStr;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}
