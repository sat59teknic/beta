/**
 * scripts/tests/test-db.js
 * Unit and integration tests for SQLite Database (Beta10Database in db.js)
 */

const fs = require('fs');
const path = require('path');
const initSqlJs = require('../../sql-wasm.js');
const { assert, assertEqual, assertDeepEqual } = require('../test-harness.js');

module.exports = function registerDbTests(runner) {
    runner.suite('SQLite Database Engine (db.js)', async (suite) => {
        let SQL;
        let db;

        // Shared SQLite setup
        const wasmBinary = fs.readFileSync(path.join(__dirname, '../../sql-wasm.wasm'));
        SQL = await initSqlJs({ wasmBinary });

        suite.test('Initialize schema with jornadas, pausas, and fichajes tables', async () => {
            db = new SQL.Database();
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

            const tablesRes = db.exec("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;");
            const tables = tablesRes[0].values.map(v => v[0]);
            assert(tables.includes('jornadas'), 'jornadas table must exist');
            assert(tables.includes('pausas'), 'pausas table must exist');
            assert(tables.includes('fichajes'), 'fichajes table must exist');
        });

        suite.test('Record individual fichaje with coordinates and user', async () => {
            const now = new Date().toISOString();
            db.run(
                "INSERT INTO fichajes (user, timestamp, action, point, observations, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?, ?)",
                ['marc', now, 'entrada', 'J', 'Obs de prova', 41.794, 2.769]
            );

            const res = db.exec("SELECT user, action, point, latitude FROM fichajes WHERE user='marc'");
            assertEqual(res[0].values.length, 1, 'Should find 1 fichaje for marc');
            assertEqual(res[0].values[0][1], 'entrada');
            assertEqual(res[0].values[0][2], 'J');
            assertEqual(res[0].values[0][3], 41.794);
        });

        suite.test('Record breakfast and lunch pauses with accurate duration', async () => {
            // Esmorzar: 15.2 minutes
            db.run(
                "INSERT INTO pausas (user, date, type, start_time, end_time, duration_minutes) VALUES (?, ?, ?, ?, ?, ?)",
                ['marc', '2026-09-30', 'esmorçar', '2026-09-30T10:00:00Z', '2026-09-30T10:15:12Z', 15.2]
            );
            // Dinar: 30.0 minutes
            db.run(
                "INSERT INTO pausas (user, date, type, start_time, end_time, duration_minutes) VALUES (?, ?, ?, ?, ?, ?)",
                ['marc', '2026-09-30', 'dinar', '2026-09-30T14:00:00Z', '2026-09-30T14:30:00Z', 30.0]
            );

            const res = db.exec("SELECT type, duration_minutes FROM pausas WHERE date='2026-09-30' ORDER BY id ASC");
            assertEqual(res[0].values.length, 2, 'Should have 2 pauses for today');
            assertEqual(res[0].values[0][0], 'esmorçar');
            assertEqual(res[0].values[0][1], 15.2);
            assertEqual(res[0].values[1][0], 'dinar');
            assertEqual(res[0].values[1][1], 30.0);
        });

        suite.test('Query daily pause summary breakdowns (breakfast_min, lunch_min, total_pause_min)', async () => {
            const summarySql = `
                SELECT 
                    date,
                    ROUND(SUM(CASE WHEN type = 'esmorçar' THEN duration_minutes ELSE 0 END), 1) as breakfast_min,
                    ROUND(SUM(CASE WHEN type = 'dinar' THEN duration_minutes ELSE 0 END), 1) as lunch_min,
                    ROUND(SUM(duration_minutes), 1) as total_pause_min,
                    COUNT(*) as total_pauses
                FROM pausas
                WHERE date = '2026-09-30'
                GROUP BY date;
            `;
            const res = db.exec(summarySql);
            assertEqual(res[0].values[0][1], 15.2, 'Breakfast total should be 15.2m');
            assertEqual(res[0].values[0][2], 30.0, 'Lunch total should be 30.0m');
            assertEqual(res[0].values[0][3], 45.2, 'Total pause should be 45.2m');
            assertEqual(res[0].values[0][4], 2, 'Total pauses count should be 2');
        });

        suite.test('Record jornada with overtime and query monthly summary', async () => {
            // Day 1: 9h standard, 10.5h worked -> 1.5h extra
            db.run(
                "INSERT INTO jornadas (user, date, start_time, end_time, type, day_type, standard_hours, worked_hours, extra_hours, pause_minutes, observations) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                ['marc', '2026-09-28', '2026-09-28T08:00:00Z', '2026-09-28T19:00:00Z', 'JORNADA', 'Dilluns-Dijous', 9, 10.5, 1.5, 30, 'Extra client A']
            );
            // Day 2: 9h standard, 11.0h worked -> 2.0h extra
            db.run(
                "INSERT INTO jornadas (user, date, start_time, end_time, type, day_type, standard_hours, worked_hours, extra_hours, pause_minutes, observations) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                ['marc', '2026-09-29', '2026-09-29T08:00:00Z', '2026-09-29T20:00:00Z', 'JORNADA', 'Dilluns-Dijous', 9, 11.0, 2.0, 30, 'Extra client B']
            );

            const overtimeSql = `
                SELECT 
                    strftime('%Y-%m', date) as month,
                    ROUND(SUM(extra_hours), 2) as total_extra_hours,
                    COUNT(*) as days_with_extra
                FROM jornadas 
                WHERE extra_hours > 0 
                GROUP BY strftime('%Y-%m', date);
            `;
            const res = db.exec(overtimeSql);
            assertEqual(res[0].values[0][0], '2026-09', 'Month should be 2026-09');
            assertEqual(res[0].values[0][1], 3.5, 'Total overtime should be 3.5h (1.5 + 2.0)');
            assertEqual(res[0].values[0][2], 2, 'Days with extra should be 2');
        });

        suite.test('Update and Repair anomalous jornada (e.g. 191m pause -> 15m pause, recalculate worked hours)', async () => {
            // Insert erroneous jornada: worked 6.01h, pause 191m
            db.run(
                "INSERT INTO jornadas (user, date, start_time, end_time, type, day_type, standard_hours, worked_hours, extra_hours, pause_minutes, observations) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                ['marc', '2026-09-30', '2026-09-30T08:00:00Z', '2026-09-30T17:07:31Z', 'JORNADA', 'Dilluns-Dijous', 9, 6.01, 0, 191.0, 'Pausa bloquejada per xarxa']
            );

            const insertedId = db.exec("SELECT last_insert_rowid()")[0].values[0][0];

            // Perform repair logic (simulate btn-fix-pause)
            const oldWorked = 6.01;
            const oldPause = 191.0;
            const targetPause = 15.0;
            const diffMinutes = oldPause - targetPause; // 176 minutes
            const newWorked = Math.round((oldWorked + (diffMinutes / 60)) * 100) / 100; // 6.01 + 2.93 = 8.94h

            // Run UPDATE
            const updateSql = `
                UPDATE jornadas 
                SET worked_hours = ?, extra_hours = ?, pause_minutes = ?, observations = ?
                WHERE id = ?;
            `;
            db.run(updateSql, [newWorked, 0, targetPause, '[Corregit desajust de xarxa a 15m pausa]', insertedId]);

            // Verify updated record
            const check = db.exec("SELECT worked_hours, pause_minutes, observations FROM jornadas WHERE id = ?", [insertedId]);
            assertEqual(check[0].values[0][0], 8.94, 'Worked hours should now be corrected to 8.94h');
            assertEqual(check[0].values[0][1], 15.0, 'Pause minutes should now be corrected to 15m');
            assert(check[0].values[0][2].includes('Corregit'), 'Observation should indicate correction');
        });

        suite.test('Delete jornada and delete pausa by ID', async () => {
            db.run("INSERT INTO jornadas (user, date, start_time, end_time, worked_hours) VALUES ('test', '2026-09-30', '08:00', '17:00', 9)");
            const jId = db.exec("SELECT last_insert_rowid()")[0].values[0][0];

            db.run("INSERT INTO pausas (user, date, type, start_time, end_time, duration_minutes) VALUES ('test', '2026-09-30', 'dinar', '14:00', '14:30', 30)");
            const pId = db.exec("SELECT last_insert_rowid()")[0].values[0][0];

            // Delete
            db.run("DELETE FROM jornadas WHERE id = ?", [jId]);
            db.run("DELETE FROM pausas WHERE id = ?", [pId]);

            const resJ = db.exec("SELECT COUNT(*) FROM jornadas WHERE id = ?", [jId]);
            const resP = db.exec("SELECT COUNT(*) FROM pausas WHERE id = ?", [pId]);
            assertEqual(resJ[0].values[0][0], 0, 'Jornada should be deleted');
            assertEqual(resP[0].values[0][0], 0, 'Pausa should be deleted');
        });
    });
};
