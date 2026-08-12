const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3001;

// ==================== KONFIGURASI ====================

const BASELINE_YEAR = "2026";
const YEARLY_BASELINE = 6203;

// ==================== MIDDLEWARE ====================

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "x-visitor-id",
      "Authorization",
      "x-secret-key",
    ],
  }),
);

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");

  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, x-visitor-id, x-secret-key, Authorization",
  );

  res.header(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, DELETE, OPTIONS",
  );

  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }

  next();
});

app.use(express.json());

// ==================== DATABASE ====================

const db = new sqlite3.Database("./database.sqlite", (err) => {
  if (err) {
    console.error("❌ Database connection error:", err.message);
  } else {
    console.log("✅ Connected to SQLite database");
  }
});

db.run("PRAGMA journal_mode = WAL");
db.run("PRAGMA synchronous = NORMAL");

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

  // ==================== TRIGGER ====================

  db.run(`
    CREATE TRIGGER IF NOT EXISTS update_daily_summary_after_pageview
    AFTER INSERT ON page_views
    BEGIN

      INSERT OR REPLACE INTO daily_summary (
        date,
        pageviews,
        unique_visitors,
        month,
        year
      )
      SELECT
        NEW.visit_date,
        COALESCE(
          (
            SELECT SUM(count)
            FROM page_views
            WHERE visit_date = NEW.visit_date
          ),
          0
        ),
        COALESCE(
          (
            SELECT COUNT(DISTINCT visitor_id)
            FROM daily_visitor_log
            WHERE visit_date = NEW.visit_date
          ),
          0
        ),
        NEW.month,
        NEW.year;

      INSERT OR REPLACE INTO monthly_summary (
        month,
        total_pageviews,
        total_unique_visitors,
        year
      )
      SELECT
        NEW.month,
        COALESCE(
          (
            SELECT SUM(pageviews)
            FROM daily_summary
            WHERE month = NEW.month
          ),
          0
        ),
        COALESCE(
          (
            SELECT SUM(unique_visitors)
            FROM daily_summary
            WHERE month = NEW.month
          ),
          0
        ),
        NEW.year;

      INSERT OR REPLACE INTO yearly_summary (
        year,
        total_pageviews,
        total_unique_visitors
      )
      SELECT
        NEW.year,
        COALESCE(
          (
            SELECT SUM(total_pageviews)
            FROM monthly_summary
            WHERE year = NEW.year
          ),
          0
        ),
        COALESCE(
          (
            SELECT SUM(total_unique_visitors)
            FROM monthly_summary
            WHERE year = NEW.year
          ),
          0
        );

    END
  `);

  db.run(`
    CREATE TRIGGER IF NOT EXISTS update_daily_summary_after_visitor
    AFTER INSERT ON daily_visitor_log
    BEGIN

      INSERT OR REPLACE INTO daily_summary (
        date,
        pageviews,
        unique_visitors,
        month,
        year
      )
      SELECT
        NEW.visit_date,
        COALESCE(
          (
            SELECT SUM(count)
            FROM page_views
            WHERE visit_date = NEW.visit_date
          ),
          0
        ),
        COALESCE(
          (
            SELECT COUNT(DISTINCT visitor_id)
            FROM daily_visitor_log
            WHERE visit_date = NEW.visit_date
          ),
          0
        ),
        substr(NEW.visit_date, 1, 7),
        substr(NEW.visit_date, 1, 4);

      INSERT OR REPLACE INTO monthly_summary (
        month,
        total_pageviews,
        total_unique_visitors,
        year
      )
      SELECT
        substr(NEW.visit_date, 1, 7),
        COALESCE(
          (
            SELECT SUM(pageviews)
            FROM daily_summary
            WHERE month = substr(NEW.visit_date, 1, 7)
          ),
          0
        ),
        COALESCE(
          (
            SELECT SUM(unique_visitors)
            FROM daily_summary
            WHERE month = substr(NEW.visit_date, 1, 7)
          ),
          0
        ),
        substr(NEW.visit_date, 1, 4);

      INSERT OR REPLACE INTO yearly_summary (
        year,
        total_pageviews,
        total_unique_visitors
      )
      SELECT
        substr(NEW.visit_date, 1, 4),
        COALESCE(
          (
            SELECT SUM(total_pageviews)
            FROM monthly_summary
            WHERE year = substr(NEW.visit_date, 1, 4)
          ),
          0
        ),
        COALESCE(
          (
            SELECT SUM(total_unique_visitors)
            FROM monthly_summary
            WHERE year = substr(NEW.visit_date, 1, 4)
          ),
          0
        );

    END
  `);

  console.log("✅ Database tables and triggers created successfully");
});

// ==================== FUNGSI BANTU ====================

function getCurrentDateTime() {
  const now = new Date();

  // WIB UTC+7
  const wibTime = new Date(now.getTime() + 7 * 60 * 60 * 1000);

  const year = wibTime.getUTCFullYear();

  const month = String(wibTime.getUTCMonth() + 1).padStart(2, "0");

  const day = String(wibTime.getUTCDate()).padStart(2, "0");

  const hour = wibTime.getUTCHours();

  return {
    date: `${year}-${month}-${day}`,
    hour,
    month: `${year}-${month}`,
    year: String(year),
    fullDateTime: now.toISOString(),
  };
}

// ==================== BASELINE TAHUNAN ====================

function getYearlyPageviewsWithBaseline(year, realPageviews) {
  const realValue = Number(realPageviews || 0);

  if (String(year) === BASELINE_YEAR) {
    return YEARLY_BASELINE + realValue;
  }

  return realValue;
}

// ==================== DETEKSI BOT ====================

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

// ==================== IP CLIENT ====================

function getClientIp(req) {
  return (
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.headers["x-real-ip"] ||
    req.connection?.remoteAddress ||
    req.socket?.remoteAddress ||
    "unknown"
  );
}

// ==================== STATISTIK TERKINI ====================

function getCurrentStats(callback) {
  const { date, month, year } = getCurrentDateTime();

  let dailyPageviews = 0;
  let dailyUnique = 0;
  let monthlyPageviews = 0;
  let yearlyPageviews = getYearlyPageviewsWithBaseline(year, 0);

  let completed = 0;

  const checkComplete = () => {
    completed++;

    if (completed === 4) {
      callback({
        daily_pageviews: dailyPageviews,
        daily_unique: dailyUnique,
        monthly_pageviews: monthlyPageviews,
        yearly_pageviews: yearlyPageviews,
        date,
        month,
        year,
      });
    }
  };

  // ==================== DAILY PAGEVIEWS ====================

  db.get(
    `
    SELECT pageviews
    FROM daily_summary
    WHERE date = ?
    `,
    [date],
    (err, row) => {
      if (err) {
        console.error("❌ Daily pageviews error:", err.message);
      }

      dailyPageviews = Number(row?.pageviews || 0);

      checkComplete();
    },
  );

  // ==================== DAILY UNIQUE ====================

  db.get(
    `
    SELECT unique_visitors
    FROM daily_summary
    WHERE date = ?
    `,
    [date],
    (err, row) => {
      if (err) {
        console.error("❌ Daily unique error:", err.message);
      }

      dailyUnique = Number(row?.unique_visitors || 0);

      checkComplete();
    },
  );

  // ==================== MONTHLY ====================

  db.get(
    `
    SELECT total_pageviews AS pageviews
    FROM monthly_summary
    WHERE month = ?
    `,
    [month],
    (err, row) => {
      if (err) {
        console.error("❌ Monthly pageviews error:", err.message);
      }

      monthlyPageviews = Number(row?.pageviews || 0);

      checkComplete();
    },
  );

  // ==================== YEARLY + BASELINE ====================

  db.get(
    `
    SELECT total_pageviews AS pageviews
    FROM yearly_summary
    WHERE year = ?
    `,
    [year],
    (err, row) => {
      if (err) {
        console.error("❌ Yearly pageviews error:", err.message);
      }

      const realYearlyPageviews = Number(row?.pageviews || 0);

      yearlyPageviews = getYearlyPageviewsWithBaseline(
        year,
        realYearlyPageviews,
      );

      checkComplete();
    },
  );
}

// ============================================================
// 1. RECORD VISIT
// ============================================================

app.post("/api/record-visit", (req, res) => {
  const userAgent = req.headers["user-agent"];

  const clientIp = getClientIp(req);

  const { date, hour, month, year } = getCurrentDateTime();

  const visitorId = req.headers["x-visitor-id"];

  console.log(
    `📥 [${new Date().toISOString()}] Visit request - Date: ${date}, Hour: ${hour}`,
  );

  // ==================== IGNORE BOT ====================

  if (isBot(userAgent)) {
    console.log(`🤖 Bot ignored: ${userAgent}`);

    return res.json({
      success: true,
      message: "Bot ignored",
      isBot: true,
    });
  }

  // ==================== VISITOR ID ====================

  if (!visitorId) {
    console.log("❌ No visitor ID provided");

    return res.status(400).json({
      success: false,
      message: "x-visitor-id header is required",
    });
  }

  // ==================== TRANSACTION ====================

  db.serialize(() => {
    db.run("BEGIN TRANSACTION");

    // ==================== PAGE VIEWS ====================

    db.run(
      `
      INSERT INTO page_views (
        visit_date,
        hour,
        count,
        month,
        year
      )
      VALUES (?, ?, 1, ?, ?)

      ON CONFLICT(visit_date, hour)
      DO UPDATE SET count = count + 1
      `,
      [date, hour, month, year],
      (err) => {
        if (err) {
          console.error("❌ Error page_views:", err.message);
        }
      },
    );

    // ==================== DAILY UNIQUE VISITOR ====================

    db.get(
      `
      SELECT *
      FROM daily_visitor_log
      WHERE visitor_id = ?
      AND visit_date = ?
      `,
      [visitorId, date],
      (err, existingRecord) => {
        if (err) {
          console.error(
            "❌ daily_visitor_log SELECT error:",
            err.message,
          );
        }

        if (!err && !existingRecord) {
          db.run(
            `
            INSERT INTO daily_visitor_log (
              visitor_id,
              visit_date
            )
            VALUES (?, ?)
            `,
            [visitorId, date],
            (insertErr) => {
              if (insertErr) {
                console.error(
                  "❌ Error daily_visitor_log:",
                  insertErr.message,
                );
              }
            },
          );
        }

        // ==================== UNIQUE VISITORS ====================

        db.get(
          `
          SELECT *
          FROM unique_visitors
          WHERE visitor_id = ?
          `,
          [visitorId],
          (visitorErr, existingVisitor) => {
            if (visitorErr) {
              console.error(
                "❌ Error unique_visitors:",
                visitorErr.message,
              );
            } else if (existingVisitor) {
              db.run(
                `
                UPDATE unique_visitors
                SET
                  last_visit = ?,
                  visit_count = visit_count + 1,
                  user_agent = ?,
                  ip_address = ?
                WHERE visitor_id = ?
                `,
                [
                  date,
                  userAgent,
                  clientIp,
                  visitorId,
                ],
                (updateErr) => {
                  if (updateErr) {
                    console.error(
                      "❌ Update unique visitor error:",
                      updateErr.message,
                    );
                  }
                },
              );
            } else {
              db.run(
                `
                INSERT INTO unique_visitors (
                  visitor_id,
                  first_visit,
                  last_visit,
                  visit_count,
                  user_agent,
                  ip_address
                )
                VALUES (?, ?, ?, 1, ?, ?)
                `,
                [
                  visitorId,
                  date,
                  date,
                  userAgent,
                  clientIp,
                ],
                (insertErr) => {
                  if (insertErr) {
                    console.error(
                      "❌ Insert unique visitor error:",
                      insertErr.message,
                    );
                  }
                },
              );
            }

            // ==================== COMMIT ====================

            db.run("COMMIT", (commitErr) => {
              if (commitErr) {
                console.error(
                  "❌ Commit error:",
                  commitErr.message,
                );

                db.run("ROLLBACK");

                return res.status(500).json({
                  success: false,
                  error: commitErr.message,
                });
              }

              // ==================== RESPONSE ====================

              getCurrentStats((stats) => {
                res.json({
                  success: true,
                  message: "Visit recorded successfully",
                  isBot: false,
                  data: stats,
                });
              });
            });
          },
        );
      },
    );
  });
});

// ============================================================
// 2. GET CURRENT VISIT STATISTICS
// ============================================================

app.get("/api/visit-stats", (req, res) => {
  const { date, month, year } = getCurrentDateTime();

  Promise.all([
    // DAILY PAGEVIEWS
    new Promise((resolve) =>
      db.get(
        `
        SELECT pageviews
        FROM daily_summary
        WHERE date = ?
        `,
        [date],
        (_, row) => resolve(Number(row?.pageviews || 0)),
      ),
    ),

    // DAILY UNIQUE
    new Promise((resolve) =>
      db.get(
        `
        SELECT unique_visitors
        FROM daily_summary
        WHERE date = ?
        `,
        [date],
        (_, row) =>
          resolve(Number(row?.unique_visitors || 0)),
      ),
    ),

    // MONTHLY PAGEVIEWS
    new Promise((resolve) =>
      db.get(
        `
        SELECT total_pageviews AS pageviews
        FROM monthly_summary
        WHERE month = ?
        `,
        [month],
        (_, row) => resolve(Number(row?.pageviews || 0)),
      ),
    ),

    // MONTHLY UNIQUE
    new Promise((resolve) =>
      db.get(
        `
        SELECT total_unique_visitors AS unique_visitors
        FROM monthly_summary
        WHERE month = ?
        `,
        [month],
        (_, row) =>
          resolve(Number(row?.unique_visitors || 0)),
      ),
    ),

    // YEARLY PAGEVIEWS
    new Promise((resolve) =>
      db.get(
        `
        SELECT total_pageviews AS pageviews
        FROM yearly_summary
        WHERE year = ?
        `,
        [year],
        (_, row) => {
          const realYearlyPageviews = Number(
            row?.pageviews || 0,
          );

          const displayedYearlyPageviews =
            getYearlyPageviewsWithBaseline(
              year,
              realYearlyPageviews,
            );

          resolve(displayedYearlyPageviews);
        },
      ),
    ),

    // YEARLY UNIQUE
    new Promise((resolve) =>
      db.get(
        `
        SELECT total_unique_visitors AS unique_visitors
        FROM yearly_summary
        WHERE year = ?
        `,
        [year],
        (_, row) =>
          resolve(Number(row?.unique_visitors || 0)),
      ),
    ),
  ])
    .then(
      ([
        dailyPageviews,
        dailyUnique,
        monthlyPageviews,
        monthlyUnique,
        yearlyPageviews,
        yearlyUnique,
      ]) => {
        res.json({
          success: true,

          data: {
            daily: {
              pageviews: dailyPageviews,
              unique_visitors: dailyUnique,
            },

            monthly: {
              pageviews: monthlyPageviews,
              unique_visitors: monthlyUnique,
            },

            yearly: {
              pageviews: yearlyPageviews,
              unique_visitors: yearlyUnique,
            },

            current_date: date,
            current_month: month,
            current_year: year,
          },
        });
      },
    )
    .catch((err) => {
      console.error("❌ visit-stats error:", err);

      res.status(500).json({
        success: false,
        error: err.message,
      });
    });
});

// ============================================================
// 3. VISIT HISTORY
// ============================================================

app.get("/api/visit-history", (req, res) => {
  const { period = "daily", limit = 30 } = req.query;

  const parsedLimit = Math.max(
    1,
    Math.min(parseInt(limit, 10) || 30, 365),
  );

  let query = "";

  switch (period) {
    // ==================== DAILY ====================

    case "daily":
      query = `
        SELECT
          date,
          pageviews,
          unique_visitors
        FROM daily_summary
        ORDER BY date DESC
        LIMIT ?
      `;
      break;

    // ==================== MONTHLY ====================

    case "monthly":
      query = `
        SELECT
          month AS period,
          total_pageviews AS pageviews,
          total_unique_visitors AS unique_visitors
        FROM monthly_summary
        ORDER BY month DESC
        LIMIT ?
      `;
      break;

    // ==================== YEARLY ====================

    case "yearly":
      query = `
        SELECT
          year AS period,

          CASE
            WHEN year = '${BASELINE_YEAR}'
            THEN total_pageviews + ${YEARLY_BASELINE}
            ELSE total_pageviews
          END AS pageviews,

          total_unique_visitors AS unique_visitors

        FROM yearly_summary

        ORDER BY year DESC

        LIMIT ?
      `;
      break;

    // ==================== DEFAULT ====================

    default:
      query = `
        SELECT
          date,
          pageviews,
          unique_visitors
        FROM daily_summary
        ORDER BY date DESC
        LIMIT ?
      `;
  }

  db.all(query, [parsedLimit], (err, rows) => {
    if (err) {
      console.error("❌ visit-history error:", err.message);

      return res.status(500).json({
        success: false,
        error: err.message,
      });
    }

    res.json({
      success: true,
      data: rows,
    });
  });
});

// ============================================================
// 4. TOP VISITORS
// ============================================================

app.get("/api/top-visitors", (req, res) => {
  const { limit = 10 } = req.query;

  const parsedLimit = Math.max(
    1,
    Math.min(parseInt(limit, 10) || 10, 100),
  );

  db.all(
    `
    SELECT
      visitor_id,
      visit_count,
      first_visit,
      last_visit
    FROM unique_visitors
    ORDER BY visit_count DESC
    LIMIT ?
    `,
    [parsedLimit],
    (err, rows) => {
      if (err) {
        console.error("❌ top-visitors error:", err.message);

        return res.status(500).json({
          success: false,
          error: err.message,
        });
      }

      res.json({
        success: true,
        data: rows,
      });
    },
  );
});

// ============================================================
// 5. RESET STATISTICS
// ============================================================

app.delete("/api/reset-stats", (req, res) => {
  const secretKey = req.headers["x-secret-key"];

  const validKey =
    process.env.SECRET_KEY || "your-secret-key-here";

  if (secretKey !== validKey) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized",
    });
  }

  db.serialize(() => {
    db.run("BEGIN TRANSACTION");

    db.run("DELETE FROM page_views");
    db.run("DELETE FROM unique_visitors");
    db.run("DELETE FROM daily_summary");
    db.run("DELETE FROM monthly_summary");
    db.run("DELETE FROM yearly_summary");
    db.run("DELETE FROM daily_visitor_log");

    db.run("COMMIT", (err) => {
      if (err) {
        console.error("❌ Reset error:", err.message);

        db.run("ROLLBACK");

        return res.status(500).json({
          success: false,
          error: err.message,
        });
      }

      res.json({
        success: true,
        message: "All statistics reset successfully",

        note:
          BASELINE_YEAR === getCurrentDateTime().year
            ? `Yearly pageviews will display from ${YEARLY_BASELINE}`
            : "Yearly baseline only applies to configured baseline year",
      });
    });
  });
});

// ============================================================
// ROOT ENDPOINT
// ============================================================

app.get("/", (req, res) => {
  res.json({
    name: "Visit Statistics API",
    version: "4.1.0",

    status: "running",

    timezone: "Asia/Jakarta",

    yearly_baseline: {
      year: BASELINE_YEAR,
      pageviews: YEARLY_BASELINE,
    },

    features: [
      "Real-time page views tracking",
      "SQLite triggers for automatic summary updates",
      "Transaction-based recording",
      "Daily statistics",
      "Monthly statistics",
      "Yearly statistics",
      `Year ${BASELINE_YEAR} starts from ${YEARLY_BASELINE} displayed pageviews`,
      "Unique visitor tracking",
      "Bot filtering",
    ],

    endpoints: {
      "POST /api/record-visit":
        "Record a new visit (requires x-visitor-id header)",

      "GET /api/visit-stats":
        "Get current statistics",

      "GET /api/visit-history":
        "Get visit history",

      "GET /api/top-visitors":
        "Get top visitors by visit count",

      "DELETE /api/reset-stats":
        "Reset all data (requires x-secret-key header)",
    },
  });
});

// ============================================================
// START SERVER
// ============================================================

app.listen(PORT, () => {
  console.log(`
====================================================
🚀 Visit Statistics API
====================================================

🌐 Server:
http://localhost:${PORT}

🕐 Timezone:
Asia/Jakarta (WIB)

🔓 CORS:
Enabled

📊 SQLite:
Connected

⚡ WAL Mode:
Enabled

🔄 Automatic Summary:
Enabled

📈 Yearly Baseline:
${BASELINE_YEAR} starts from ${YEARLY_BASELINE}

====================================================
`);
});
