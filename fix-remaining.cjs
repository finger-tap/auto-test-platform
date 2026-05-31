const Database = require('better-sqlite3');
const db = new Database('/Users/dinghao/工作/auto-test-platform/data/app.db');

// Fix all double-encoded rows where log_data starts with "
const rows = db.prepare("SELECT id, log_data FROM api_execution_steps WHERE substr(log_data, 1, 1) = '\"'").all();
let fixed = 0;
let failed = 0;

for (const row of rows) {
  try {
    // The stored value is: "{\"key\":\"value\"}"
    // We need to parse the outer string to get the inner JSON, then re-encode properly
    const innerStr = row.log_data.slice(1, -1); // Remove surrounding quotes
    const unescaped = innerStr.replace(/\\"/g, '"'); // Unescape quotes
    const parsed = JSON.parse(unescaped);
    const correct = JSON.stringify(parsed);
    db.prepare('UPDATE api_execution_steps SET log_data = ? WHERE id = ?').run(correct, row.id);
    console.log(`Fixed row ${row.id}`);
    fixed++;
  } catch(e) {
    console.log(`Row ${row.id} failed: ${e.message}`);
    failed++;
  }
}

console.log(`\nTotal fixed: ${fixed}, failed: ${failed}`);
db.close();