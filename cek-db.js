const sqlite3 = require("sqlite3").verbose();
const db = new sqlite3.Database("./database.sqlite");

console.log("📊 CHECKING DATABASE...\n");

// Cek daily summary
db.all(
  "SELECT date, pageviews, unique_visitors FROM daily_summary ORDER BY date DESC",
  (err, rows) => {
    if (err) {
      console.error("Error:", err);
    } else {
      console.log("DAILY SUMMARY:");
      rows.forEach((row) => {
        console.log(
          "  " +
            row.date +
            ": " +
            row.pageviews +
            " views, " +
            row.unique_visitors +
            " unique",
        );
      });
    }

    // Cek total page views
    db.all("SELECT COUNT(*) as total FROM page_views", (err, count) => {
      console.log("\nTotal page_views records: " + count[0].total);

      // Cek page views per jam hari ini
      db.all(
        "SELECT hour, count FROM page_views WHERE visit_date = date('now') ORDER BY hour",
        (err, rows) => {
          if (rows && rows.length > 0) {
            console.log("\nPage views per jam hari ini:");
            rows.forEach((row) => {
              console.log("  Jam " + row.hour + ": " + row.count + " views");
            });
          }
          db.close();
        },
      );
    });
  },
);
