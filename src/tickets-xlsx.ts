import ExcelJS from "exceljs";
import {
  defaultExportColumns,
  selectedExportColumns,
  type ExportColumnKey,
  type CsvTicket,
} from "./ticket-export-columns.js";

export async function ticketsXlsx(
  tickets: CsvTicket[],
  trash = false,
  keys: ExportColumnKey[] = defaultExportColumns,
) {
  const columns = selectedExportColumns(keys);
  const book = new ExcelJS.Workbook();
  book.creator = "Orbit";
  book.created = new Date();
  const sheet = book.addWorksheet(trash ? "Trash" : "Tickets", {
    views: [{ state: "frozen", ySplit: 1, showGridLines: false }],
    pageSetup: {
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    },
  });
  sheet.columns = columns.map(({ header, width }) => ({ header, width }));
  const header = sheet.getRow(1);
  header.height = 34;
  header.eachCell((cell) => {
    cell.font = {
      name: "Calibri",
      size: 11,
      bold: true,
      color: { argb: "FFFFFFFF" },
    };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF24564C" },
    };
    cell.alignment = { vertical: "middle", wrapText: true };
  });
  for (const ticket of tickets) {
    // Plain string values stay text, including strings beginning with '='.
    const row = sheet.addRow(columns.map((column) => column.value(ticket)));
    let lines = 1;
    row.eachCell({ includeEmpty: true }, (cell, column) => {
      const key = columns[column - 1].key;
      const width = (sheet.getColumn(column).width || 20) - 3;
      lines = Math.max(
        lines,
        String(cell.value ?? "")
          .split(/\r?\n/)
          .reduce(
            (sum, line) => sum + Math.max(1, Math.ceil(line.length / width)),
            0,
          ),
      );
      cell.font = {
        name: "Calibri",
        size: 11,
        color: { argb: "FF243D36" },
        bold: key === "id" || key === "priority",
      };
      cell.alignment = {
        vertical: "middle",
        wrapText: true,
        horizontal: key === "id" || key === "priority" ? "center" : "left",
      };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: row.number % 2 === 0 ? "FFF0F5F3" : "FFFFFFFF" },
      };
      cell.border = { bottom: { style: "hair", color: { argb: "FFD9E4DF" } } };
      if (key === "priority") {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFFFF0C2" },
        };
        cell.font = {
          name: "Calibri",
          size: 12,
          bold: true,
          color: { argb: "FF704600" },
        };
      }
    });
    row.height = Math.min(409, Math.max(32, lines * 16 + 12));
  }
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: tickets.length + 1, column: columns.length },
  };
  sheet.pageSetup.printTitlesRow = "1:1";
  return new Uint8Array(await book.xlsx.writeBuffer());
}
