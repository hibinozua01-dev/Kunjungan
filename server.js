const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3001;

// ==================== MIDDLEWARE ====================
// CORS - Izinkan semua origin untuk sementara (debug)
app.use(
  cors({
    origin: "*", // Izinkan semua origin untuk testing
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "x-visitor-id", "Authorization"],
  }),
);

// Tambahan header untuk mengatasi CORS
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, x-visitor-id",
  );
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json());

// Inisialisasi database SQLite
const db = new sqlite3.Database("./database.sqlite");

// ==================== MEMBUAT TABEL ====================
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS page_views (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      visit_date TEXT NOT NULL,
      hour INTEGER NOT NULL,
      count INTEGER DEFAULT 0,
      month TEXT NOT NULL,
      year TEXT NOT NULL,
      UNIQUE(visit_date, hour)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS unique_visitors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      visitor_id TEXT NOT NULL,
      first_visit DATE NOT NULL,
      last_visit DATE NOT NULL,
      visit_count INTEGER DEFAULT 1,
      user_agent TEXT,
      ip_address TEXT,
      UNIQUE(visitor_id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS daily_summary (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT UNIQUE NOT NULL,
      pageviews INTEGER DEFAULT 0,
      unique_visitors INTEGER DEFAULT 0,
      month TEXT NOT NULL,
      year TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS monthly_summary (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      month TEXT UNIQUE NOT NULL,
      total_pageviews INTEGER DEFAULT 0,
      total_unique_visitors INTEGER DEFAULT 0,
      year TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS yearly_summary (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      year TEXT UNIQUE NOT NULL,
      total_pageviews INTEGER DEFAULT 0,
      total_unique_visitors INTEGER DEFAULT 0
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS daily_visitor_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      visitor_id TEXT NOT NULL,
      visit_date TEXT NOT NULL,
      UNIQUE(visitor_id, visit_date)
    )
  `);

  console.log("✅ Database tables created successfully");
});

// ==================== FUNGSI BANTU ====================

// Mendapatkan tanggal, bulan, tahun sekarang dengan TIMEZONE WIB (UTC+7)
function getCurrentDateTime() {
  const now = new Date();
  const wibTime = new Date(now.getTime() + 7 * 60 * 60 * 1000);

  const year = wibTime.getUTCFullYear();
  const month = String(wibTime.getUTCMonth() + 1).padStart(2, "0");
  const day = String(wibTime.getUTCDate()).padStart(2, "0");
  const hour = wibTime.getUTCHours();

  return {
    date: `${year}-${month}-${day}`,
    hour: hour,
    month: `${year}-${month}`,
    year: String(year),
    fullDateTime: now.toISOString(),
  };
}

// Cek apakah user agent adalah bot
function isBot(userAgent) {
  if (!userAgent) return false;
  const botPatterns = [
    "bot",
    "crawler",
    "spider",
    "scraper",
    "googlebot",
    "bingbot",
    "yandexbot",
    "slurp",
    "duckduckbot",
    "baiduspider",
    "facebookexternalhit",
    "twitterbot",
    "linkedinbot",
    "whatsapp",
    "telegrambot",
    "discordbot",
    "slackbot",
    "curl",
    "wget",
    "python-requests",
    "php",
    "java",
    "perl",
    "go-http-client",
    "ruby",
    "node-fetch",
    "axios",
  ];
  const ua = userAgent.toLowerCase();
  return botPatterns.some((pattern) => ua.includes(pattern));
}

// Mendapatkan IP address dari request
function getClientIp(req) {
  return (
    req.headers["x-forwarded-for"] ||
    req.headers["x-real-ip"] ||
    req.connection.remoteAddress ||
    req.socket.remoteAddress ||
    "unknown"
  );
}

// Update semua ringkasan
async function updateAllSummaries() {
  const { date, month, year } = getCurrentDateTime();

  db.run(
    `
    INSERT OR REPLACE INTO daily_summary (date, pageviews, unique_visitors, month, year)
    SELECT 
      ?,
      COALESCE((SELECT SUM(count) FROM page_views WHERE visit_date = ?), 0),
      COALESCE((SELECT COUNT(DISTINCT visitor_id) FROM daily_visitor_log WHERE visit_date = ?), 0),
      ?,
      ?
  `,
    [date, date, date, month, year],
  );

  db.run(
    `
    INSERT OR REPLACE INTO monthly_summary (month, total_pageviews, total_unique_visitors, year)
    SELECT 
      ?,
      COALESCE((SELECT SUM(pageviews) FROM daily_summary WHERE month = ?), 0),
      COALESCE((SELECT SUM(unique_visitors) FROM daily_summary WHERE month = ?), 0),
      ?
  `,
    [month, month, month, year],
  );

  db.run(
    `
    INSERT OR REPLACE INTO yearly_summary (year, total_pageviews, total_unique_visitors)
    SELECT 
      ?,
      COALESCE((SELECT SUM(total_pageviews) FROM monthly_summary WHERE year = ?), 0),
      COALESCE((SELECT SUM(total_unique_visitors) FROM monthly_summary WHERE year = ?), 0)
  `,
    [year, year, year],
  );
}

// ==================== API ENDPOINTS ====================

// 1. Mencatat kunjungan baru
app.post("/api/record-visit", (req, res) => {
  const userAgent = req.headers["user-agent"];
  const clientIp = getClientIp(req);
  const { date, hour, month, year } = getCurrentDateTime();
  const visitorId = req.headers["x-visitor-id"];

  console.log(
    `📥 [${new Date().toISOString()}] Request received - Date: ${date}, VisitorID: ${visitorId?.substring(
      0,
      8,
    )}...`,
  );

  if (isBot(userAgent)) {
    console.log(`🤖 Bot detected: ${userAgent}`);
    return res.json({ success: true, message: "Bot ignored", isBot: true });
  }

  if (!visitorId) {
    console.log("❌ No visitor ID provided");
    return res.status(400).json({
      success: false,
      message: "x-visitor-id header is required. Generate UUID in frontend.",
    });
  }

  db.get(
    `SELECT * FROM daily_visitor_log WHERE visitor_id = ? AND visit_date = ?`,
    [visitorId, date],
    (err, existingRecord) => {
      if (err) {
        console.error("Database error:", err);
        return res.status(500).json({ success: false, error: err.message });
      }

      const alreadyRecordedToday = !!existingRecord;
      console.log(`📊 Already recorded today: ${alreadyRecordedToday}`);

      // SELALU TAMBAH PAGE VIEWS SETIAP REQUEST
      db.run(
        `
        INSERT INTO page_views (visit_date, hour, count, month, year)
        VALUES (?, ?, 1, ?, ?)
        ON CONFLICT(visit_date, hour) DO UPDATE SET count = count + 1
      `,
        [date, hour, month, year],
        (err) => {
          if (err) console.error("Error updating page_views:", err);
          else console.log(`✅ Page view recorded for ${date} hour ${hour}`);
        },
      );

      // CATAT DAILY VISITOR LOG HANYA SEKALI SEHARI
      if (!alreadyRecordedToday) {
        db.run(
          `INSERT INTO daily_visitor_log (visitor_id, visit_date) VALUES (?, ?)`,
          [visitorId, date],
          (err) => {
            if (err) console.error("Error inserting daily visitor log:", err);
            else
              console.log(
                `✅ New daily visitor recorded: ${visitorId.substring(
                  0,
                  8,
                )}...`,
              );
          },
        );
      }

      // UNIQUE VISITOR MANAGEMENT
      db.get(
        `SELECT * FROM unique_visitors WHERE visitor_id = ?`,
        [visitorId],
        (err, existingVisitor) => {
          if (err) {
            console.error("Error checking unique_visitors:", err);
          } else if (existingVisitor) {
            db.run(
              `UPDATE unique_visitors SET last_visit = ?, visit_count = visit_count + 1, user_agent = ?, ip_address = ? WHERE visitor_id = ?`,
              [date, userAgent, clientIp, visitorId],
              (err) => {
                if (err) console.error("Error updating unique_visitors:", err);
                else
                  console.log(
                    `✅ Updated existing visitor, count: ${
                      existingVisitor.visit_count + 1
                    }`,
                  );
              },
            );
          } else {
            db.run(
              `INSERT INTO unique_visitors (visitor_id, first_visit, last_visit, visit_count, user_agent, ip_address) VALUES (?, ?, ?, 1, ?, ?)`,
              [visitorId, date, date, userAgent, clientIp],
              (err) => {
                if (err) console.error("Error inserting unique_visitors:", err);
                else console.log(`✅ New unique visitor created`);
              },
            );
          }
        },
      );

      updateAllSummaries();

      setTimeout(() => {
        getCurrentStats((stats) => {
          console.log(
            `📊 Current stats - Daily pageviews: ${stats.daily_pageviews}, Unique: ${stats.daily_unique}`,
          );
          res.json({
            success: true,
            message: alreadyRecordedToday
              ? "Already recorded today (but page view still counted)"
              : "Visit recorded successfully",
            alreadyRecordedToday: alreadyRecordedToday,
            isBot: false,
            data: stats,
          });
        });
      }, 100);
    },
  );
});

// Fungsi untuk mengambil statistik terkini
function getCurrentStats(callback) {
  const { date, month, year } = getCurrentDateTime();

  db.get(
    `SELECT pageviews FROM daily_summary WHERE date = ?`,
    [date],
    (err, daily) => {
      db.get(
        `SELECT total_pageviews as pageviews FROM monthly_summary WHERE month = ?`,
        [month],
        (err, monthly) => {
          db.get(
            `SELECT total_pageviews as pageviews FROM yearly_summary WHERE year = ?`,
            [year],
            (err, yearly) => {
              db.get(
                `SELECT unique_visitors FROM daily_summary WHERE date = ?`,
                [date],
                (err, uniqueDaily) => {
                  callback({
                    daily_pageviews: daily ? daily.pageviews : 0,
                    daily_unique: uniqueDaily ? uniqueDaily.unique_visitors : 0,
                    monthly_pageviews: monthly ? monthly.pageviews : 0,
                    yearly_pageviews: yearly ? yearly.pageviews : 0,
                    date: date,
                    month: month,
                    year: year,
                  });
                },
              );
            },
          );
        },
      );
    },
  );
}

// 2. Mendapatkan statistik kunjungan
app.get("/api/visit-stats", (req, res) => {
  const { date, month, year } = getCurrentDateTime();

  db.get(
    `SELECT pageviews FROM daily_summary WHERE date = ?`,
    [date],
    (err, dailyPageviews) => {
      if (err)
        return res.status(500).json({ success: false, error: err.message });
      db.get(
        `SELECT unique_visitors FROM daily_summary WHERE date = ?`,
        [date],
        (err, dailyUnique) => {
          if (err)
            return res.status(500).json({ success: false, error: err.message });
          db.get(
            `SELECT total_pageviews as pageviews FROM monthly_summary WHERE month = ?`,
            [month],
            (err, monthlyPageviews) => {
              if (err)
                return res
                  .status(500)
                  .json({ success: false, error: err.message });
              db.get(
                `SELECT total_unique_visitors as unique_visitors FROM monthly_summary WHERE month = ?`,
                [month],
                (err, monthlyUnique) => {
                  if (err)
                    return res
                      .status(500)
                      .json({ success: false, error: err.message });
                  db.get(
                    `SELECT total_pageviews as pageviews FROM yearly_summary WHERE year = ?`,
                    [year],
                    (err, yearlyPageviews) => {
                      if (err)
                        return res
                          .status(500)
                          .json({ success: false, error: err.message });
                      db.get(
                        `SELECT total_unique_visitors as unique_visitors FROM yearly_summary WHERE year = ?`,
                        [year],
                        (err, yearlyUnique) => {
                          if (err)
                            return res
                              .status(500)
                              .json({ success: false, error: err.message });
                          res.json({
                            success: true,
                            data: {
                              daily: {
                                pageviews: dailyPageviews
                                  ? dailyPageviews.pageviews
                                  : 0,
                                unique_visitors: dailyUnique
                                  ? dailyUnique.unique_visitors
                                  : 0,
                              },
                              monthly: {
                                pageviews: monthlyPageviews
                                  ? monthlyPageviews.pageviews
                                  : 0,
                                unique_visitors: monthlyUnique
                                  ? monthlyUnique.unique_visitors
                                  : 0,
                              },
                              yearly: {
                                pageviews: yearlyPageviews
                                  ? yearlyPageviews.pageviews
                                  : 0,
                                unique_visitors: yearlyUnique
                                  ? yearlyUnique.unique_visitors
                                  : 0,
                              },
                              current_date: date,
                              current_month: month,
                              current_year: year,
                            },
                          });
                        },
                      );
                    },
                  );
                },
              );
            },
          );
        },
      );
    },
  );
});

// 3. Mendapatkan history
app.get("/api/visit-history", (req, res) => {
  const { period = "daily", limit = 30 } = req.query;
  let query = "";

  switch (period) {
    case "daily":
      query = `SELECT date, pageviews, unique_visitors FROM daily_summary ORDER BY date DESC LIMIT ?`;
      break;
    case "monthly":
      query = `SELECT month as period, total_pageviews as pageviews, total_unique_visitors as unique_visitors FROM monthly_summary ORDER BY month DESC LIMIT ?`;
      break;
    case "yearly":
      query = `SELECT year as period, total_pageviews as pageviews, total_unique_visitors as unique_visitors FROM yearly_summary ORDER BY year DESC LIMIT ?`;
      break;
    default:
      query = `SELECT date, pageviews, unique_visitors FROM daily_summary ORDER BY date DESC LIMIT ?`;
  }

  db.all(query, [parseInt(limit)], (err, rows) => {
    if (err)
      return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true, data: rows });
  });
});

// 4. Mendapatkan top visitors
app.get("/api/top-visitors", (req, res) => {
  const { limit = 10 } = req.query;
  db.all(
    `SELECT visitor_id, visit_count, first_visit, last_visit FROM unique_visitors ORDER BY visit_count DESC LIMIT ?`,
    [parseInt(limit)],
    (err, rows) => {
      if (err)
        return res.status(500).json({ success: false, error: err.message });
      res.json({ success: true, data: rows });
    },
  );
});

// 5. Reset data
app.delete("/api/reset-stats", (req, res) => {
  const secretKey = req.headers["x-secret-key"];
  const validKey = process.env.SECRET_KEY || "your-secret-key-here";

  if (secretKey !== validKey) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  db.serialize(() => {
    db.run(`DELETE FROM page_views`);
    db.run(`DELETE FROM unique_visitors`);
    db.run(`DELETE FROM daily_summary`);
    db.run(`DELETE FROM monthly_summary`);
    db.run(`DELETE FROM yearly_summary`);
    db.run(`DELETE FROM daily_visitor_log`);
    res.json({ success: true, message: "All statistics reset successfully" });
  });
});

// Root endpoint
app.get("/", (req, res) => {
  res.json({
    name: "Visit Statistics API",
    version: "3.1.0",
    features: [
      "Real-time page views tracking",
      "Unique visitors tracking per person (based on UUID)",
      "Page views increase on EVERY refresh",
      "Anti double-count for daily unique visitors (1 per person per day)",
      "Bot filtering",
      "Timezone: Asia/Jakarta (WIB)",
      "CORS enabled for all origins",
    ],
    endpoints: {
      "POST /api/record-visit":
        "Record a new visit (requires x-visitor-id header)",
      "GET /api/visit-stats": "Get current statistics",
      "GET /api/visit-history": "Get visit history for charts",
      "GET /api/top-visitors": "Get top visitors by visit count",
      "DELETE /api/reset-stats": "Reset all data (requires secret key)",
    },
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`
  🚀 Visit Statistics API running on http://localhost:${PORT}
  🕐 Timezone: Asia/Jakarta (WIB)
  🔓 CORS: Enabled for all origins
  
  📊 Endpoints ready!
  `);
});
