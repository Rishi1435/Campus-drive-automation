const ExcelJS = require('exceljs');
const fs = require('fs');

const FILE_NAME = 'campus_drives.xlsx';

async function saveToExcel(data) {
  const workbook = new ExcelJS.Workbook();
  let worksheet;

  if (fs.existsSync(FILE_NAME)) {
    await workbook.xlsx.readFile(FILE_NAME);
    worksheet = workbook.getWorksheet(1);
  } else {
    worksheet = workbook.addWorksheet('Campus Drives');
  }

  // Set/re-apply columns so data maps correctly even after reading an existing file
  worksheet.columns = [
    { header: 'Company', key: 'company', width: 20 },
    { header: 'Role', key: 'role', width: 20 },
    { header: 'CTC', key: 'ctc', width: 15 },
    { header: 'Eligibility', key: 'eligibility', width: 30 },
    { header: 'Deadline', key: 'deadline', width: 20 },
    { header: 'Apply Link', key: 'applyLink', width: 30 },
    { header: 'Timestamp', key: 'timestamp', width: 25 },
  ];

  // Add the timestamp before saving
  data.timestamp = new Date().toLocaleString();

  worksheet.addRow(data);

  await workbook.xlsx.writeFile(FILE_NAME);
}

module.exports = { saveToExcel };
