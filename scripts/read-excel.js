const ExcelJS = require('exceljs');

async function readExcel() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile('C:/Users/rafoy/Documents/Procura-light/price-request-app-v2/output/demande_prix_DDP-20260113-810_1768324903211.xlsx');
  // Note: This is the MANITOU email

  const worksheet = workbook.worksheets[0];
  console.log('=== EXCEL FILE CONTENT ===\n');

  // Print header info
  console.log('Sheet name:', worksheet.name);
  console.log('Row count:', worksheet.rowCount);

  // Print all rows
  console.log('\n--- ITEMS ---');
  worksheet.eachRow((row, rowNumber) => {
    const values = [];
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      values.push(cell.value !== null ? String(cell.value) : '');
    });
    console.log('Row ' + rowNumber + ':', values.slice(0, 6).join(' | '));
  });
}

readExcel().catch(console.error);
