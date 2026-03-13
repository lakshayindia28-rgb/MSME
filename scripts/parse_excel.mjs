import XLSX from 'xlsx';
import fs from 'fs';

const wb = XLSX.readFile('FINANCIAL FINAL.xlsx', { cellFormula: true, cellStyles: true });
console.log('Sheet names:', JSON.stringify(wb.SheetNames));

const allData = {};

for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name];
  const ref = ws['!ref'];
  if (!ref) { console.log(`\n=== SHEET: ${name} | EMPTY ===`); continue; }
  console.log(`\n=== SHEET: ${name} | Range: ${ref} ===`);
  const decoded = XLSX.utils.decode_range(ref);
  let cellCount = 0, formulaCount = 0;
  const cells = {};
  for (let R = decoded.s.r; R <= decoded.e.r; R++) {
    for (let C = decoded.s.c; C <= decoded.e.c; C++) {
      const addr = XLSX.utils.encode_cell({r:R,c:C});
      const cell = ws[addr];
      if (cell) {
        cellCount++;
        cells[addr] = {
          value: cell.v,
          type: cell.t,
          formula: cell.f || null,
          formatted: cell.w || null
        };
        if (cell.f) formulaCount++;
      }
    }
  }
  console.log(`Cells: ${cellCount} | Formulas: ${formulaCount}`);
  allData[name] = { ref, cells, cellCount, formulaCount };
}

fs.writeFileSync('scripts/excel_parsed.json', JSON.stringify(allData, null, 2));
console.log('\nWrote parsed data to scripts/excel_parsed.json');
