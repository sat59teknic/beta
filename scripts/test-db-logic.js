const fs = require('fs');
const path = require('path');
const initSqlJs = require('../sql-wasm.js');

// Mock localStorage and IndexedDB if needed or test Database class logic
async function runTest() {
    console.log('--- TEST: SQLite Database Logic ---');
    const wasmBinary = fs.readFileSync(path.join(__dirname, '../sql-wasm.wasm'));
    const SQL = await initSqlJs({ wasmBinary });
    const db = new SQL.Database();

    // Replicate schema from db.js
    const schema = `
        CREATE TABLE IF NOT EXISTS jornadas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user TEXT,
            date TEXT NOT NULL,
            start_time TEXT NOT NULL,
            end_time TEXT NOT NULL,
            type TEXT DEFAULT 'JORNADA',
            day_type TEXT,
            standard_hours REAL DEFAULT 9,
            worked_hours REAL NOT NULL,
            extra_hours REAL DEFAULT 0,
            pause_minutes REAL DEFAULT 0,
            observations TEXT,
            created_at TEXT DEFAULT (datetime('now', 'localtime'))
        );

        CREATE TABLE IF NOT EXISTS pausas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user TEXT,
            date TEXT NOT NULL,
            type TEXT NOT NULL,
            start_time TEXT NOT NULL,
            end_time TEXT NOT NULL,
            duration_minutes REAL NOT NULL,
            created_at TEXT DEFAULT (datetime('now', 'localtime'))
        );

        CREATE TABLE IF NOT EXISTS fichajes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user TEXT,
            timestamp TEXT NOT NULL,
            action TEXT NOT NULL,
            point TEXT NOT NULL,
            observations TEXT,
            latitude REAL,
            longitude REAL,
            created_at TEXT DEFAULT (datetime('now', 'localtime'))
        );
    `;
    db.run(schema);

    // Test 1: Insert fichaje
    db.run(
        "INSERT INTO fichajes (user, timestamp, action, point, observations, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?, ?)",
        ['testuser', new Date().toISOString(), 'entrada', 'J', 'Inici prova', 41.38, 2.17]
    );

    // Test 2: Insert pausas (breakfast and lunch)
    db.run(
        "INSERT INTO pausas (user, date, type, start_time, end_time, duration_minutes) VALUES (?, ?, ?, ?, ?, ?)",
        ['testuser', '2026-09-29', 'esmorçar', '2026-09-29T10:00:00Z', '2026-09-29T10:15:00Z', 15]
    );
    db.run(
        "INSERT INTO pausas (user, date, type, start_time, end_time, duration_minutes) VALUES (?, ?, ?, ?, ?, ?)",
        ['testuser', '2026-09-29', 'dinar', '2026-09-29T14:00:00Z', '2026-09-29T14:30:00Z', 30]
    );

    // Test 3: Insert jornadas with overtime
    db.run(
        "INSERT INTO jornadas (user, date, start_time, end_time, type, day_type, standard_hours, worked_hours, extra_hours, pause_minutes, observations) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ['testuser', '2026-09-28', '2026-09-28T08:00:00Z', '2026-09-28T19:00:00Z', 'JORNADA', 'Dilluns-Dijous', 9, 10.5, 1.5, 45, 'Feina allargada client ABC']
    );
    db.run(
        "INSERT INTO jornadas (user, date, start_time, end_time, type, day_type, standard_hours, worked_hours, extra_hours, pause_minutes, observations) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ['testuser', '2026-09-29', '2026-09-29T08:00:00Z', '2026-09-29T20:00:00Z', 'JORNADA', 'Dilluns-Dijous', 9, 11.0, 2.0, 45, 'Instal·lació urgent client XYZ']
    );

    // Query 1: Monthly overtime summary
    const monthlySql = `
        SELECT 
            strftime('%Y-%m', date) as month,
            ROUND(SUM(extra_hours), 2) as total_extra_hours,
            COUNT(*) as days_with_extra
        FROM jornadas 
        WHERE extra_hours > 0 
        GROUP BY strftime('%Y-%m', date) 
        ORDER BY month DESC;
    `;
    const monthlyRes = db.exec(monthlySql);
    console.log('Monthly overtime result:', JSON.stringify(monthlyRes));
    if (monthlyRes[0].values[0][1] !== 3.5) {
        throw new Error('Expected 3.5 total extra hours, got ' + monthlyRes[0].values[0][1]);
    }
    console.log('✓ Monthly overtime query verified: 3.5h total extra across 2 days');

    // Query 2: Daily pauses summary
    const pausesSql = `
        SELECT 
            date,
            ROUND(SUM(CASE WHEN type = 'esmorçar' THEN duration_minutes ELSE 0 END), 1) as breakfast_min,
            ROUND(SUM(CASE WHEN type = 'dinar' THEN duration_minutes ELSE 0 END), 1) as lunch_min,
            ROUND(SUM(duration_minutes), 1) as total_pause_min,
            COUNT(*) as total_pauses
        FROM pausas
        GROUP BY date
        ORDER BY date DESC;
    `;
    const pausesRes = db.exec(pausesSql);
    console.log('Pauses summary result:', JSON.stringify(pausesRes));
    const dayPauses = pausesRes[0].values[0];
    if (dayPauses[1] !== 15 || dayPauses[2] !== 30 || dayPauses[3] !== 45) {
        throw new Error('Pauses duration mismatch');
    }
    console.log('✓ Daily pauses query verified: 15min breakfast + 30min lunch = 45min total');

    // Export test
    const exportedBytes = db.export();
    console.log('✓ Database exported binary size:', exportedBytes.length, 'bytes');

    console.log('✅ ALL DATABASE TESTS PASSED SUCCESSFULLY!');
}

runTest().catch(err => {
    console.error('❌ Test failed:', err);
    process.exit(1);
});
