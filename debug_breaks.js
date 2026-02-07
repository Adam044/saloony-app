const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('saloony.db');

console.log('--- Checking Breaks Table ---');
db.serialize(() => {
  db.all("SELECT * FROM breaks", (err, rows) => {
    if (err) {
      console.error('Error fetching breaks:', err);
    } else {
      console.log('Total breaks found:', rows.length);
      console.log(JSON.stringify(rows, null, 2));
    }
  });
});

db.close();
