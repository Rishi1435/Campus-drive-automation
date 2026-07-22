const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./database.sqlite');

db.serialize(() => {
  db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='UserPreferences'", (err, row) => {
    if (row) {
      console.log('UserPreferences table exists.');
    } else {
      console.log('UserPreferences table missing.');
    }
  });

  db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='Drives'", (err, row) => {
    if (row) {
      console.log('Drives table exists.');
    } else {
      console.log('Drives table missing.');
    }
  });
});

db.close();
