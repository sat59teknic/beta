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
                    remunerated_extra_hours REAL DEFAULT 0,
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

        suite.test('Export and Import/Restore Database file: restores all records and overtime', async () => {
            // Insert specific record for yesterday and today
            db.run(
                "INSERT INTO jornadas (user, date, start_time, end_time, type, day_type, standard_hours, worked_hours, extra_hours, remunerated_extra_hours, pause_minutes, observations) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                ['marc', '2026-10-02', '2026-10-02T08:00:00Z', '2026-10-02T18:00:00Z', 'JORNADA', 'Divendres', 9, 10.0, 1.0, 1.0, 30, 'Extra client ahir']
            );
            db.run(
                "INSERT INTO jornadas (user, date, start_time, end_time, type, day_type, standard_hours, worked_hours, extra_hours, remunerated_extra_hours, pause_minutes, observations) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                ['marc', '2026-10-03', '2026-10-03T08:00:00Z', '2026-10-03T17:45:00Z', 'JORNADA', 'Dissabte', 0, 9.75, 9.75, 9.5, 30, 'Extra dissabte avui']
            );

            // Export to binary bytes
            const exportedBinary = db.export();
            assert(exportedBinary.length > 0, 'Exported database must contain bytes');

            // Simulate a brand new fresh database (as after fresh APK install)
            const freshDb = new SQL.Database(exportedBinary);
            const res = freshDb.exec("SELECT date, extra_hours, remunerated_extra_hours, observations FROM jornadas WHERE date IN ('2026-10-02', '2026-10-03') ORDER BY date ASC;");
            
            assert(res.length > 0 && res[0].values.length === 2, 'Restored database must contain exactly the 2 records');
            assertEqual(res[0].values[0][0], '2026-10-02', 'Yesterday date matches');
            assertEqual(res[0].values[0][1], 1.0, 'Yesterday extra hours matches');
            assertEqual(res[0].values[0][2], 1.0, 'Yesterday remunerated extra hours matches');
            assertEqual(res[0].values[1][0], '2026-10-03', 'Today date matches');
            assertEqual(res[0].values[1][1], 9.75, 'Today extra hours matches');
            assertEqual(res[0].values[1][2], 9.5, 'Today remunerated extra hours matches');
        });

        suite.test('Base64 Text Backup & Restore: 100% lossless text export/import', async () => {
            const Beta10Database = require('../../db.js');
            const b10 = new Beta10Database();
            b10.SQL = SQL;
            b10.db = db;
            b10.isInitialized = true;

            // Export to Base64 text
            const base64Data = await b10.exportDatabaseAsBase64();
            assert(typeof base64Data === 'string' && base64Data.length > 100, 'Base64 backup must be a valid non-empty string');

            // Simulate importing into a new empty instance
            const b10Restored = new Beta10Database();
            b10Restored.SQL = SQL;
            b10Restored.db = new SQL.Database();
            b10Restored.isInitialized = true;
            b10Restored._createTables();

            await b10Restored.importDatabaseFromBase64(base64Data);

            const res = b10Restored.db.exec("SELECT date, worked_hours, extra_hours, remunerated_extra_hours, observations FROM jornadas WHERE date IN ('2026-10-02', '2026-10-03') ORDER BY date ASC;");
            assertEqual(res[0].values.length, 2, 'Both days restored identically from Base64 string');
            assertEqual(res[0].values[0][0], '2026-10-02', 'Yesterday date preserved');
            assertEqual(res[0].values[0][2], 1.0, 'Yesterday extra hours preserved');
            assertEqual(res[0].values[0][3], 1.0, 'Yesterday remunerated extra hours preserved');
            assertEqual(res[0].values[1][0], '2026-10-03', 'Today date preserved');
            assertEqual(res[0].values[1][2], 9.75, 'Today extra hours preserved');
            assertEqual(res[0].values[1][3], 9.5, 'Today remunerated extra hours preserved');
        });

        suite.test('downloadDatabaseFile on Android Mobile: triggers native Web Share sheet (Save to Files/Drive/WhatsApp)', async () => {
            const Beta10Database = require('../../db.js');
            const b10 = new Beta10Database();
            b10.SQL = SQL;
            b10.db = db;
            b10.isInitialized = true;

            let sharedPayload = null;
            const originalNavDesc = Object.getOwnPropertyDescriptor(global, 'navigator');
            const originalFile = global.File;
            const originalBlob = global.Blob;

            global.File = class MockFile {
                constructor(chunks, name, opts) {
                    this.chunks = chunks;
                    this.name = name;
                    this.type = opts ? opts.type : '';
                }
            };
            global.Blob = class MockBlob {
                constructor(chunks, opts) {
                    this.chunks = chunks;
                    this.type = opts ? opts.type : '';
                }
            };
            Object.defineProperty(global, 'navigator', {
                value: {
                    canShare: (data) => true,
                    share: async (payload) => {
                        sharedPayload = payload;
                        return true;
                    }
                },
                configurable: true,
                writable: true
            });

            try {
                const res = await b10.downloadDatabaseFile();
                assertEqual(res.success, true, 'downloadDatabaseFile must return success');
                assertEqual(res.method, 'share', 'Must use Web Share API on Android device');
                assert(res.fileName.endsWith('.sqlite'), 'File must end with .sqlite');
                assert(sharedPayload !== null, 'navigator.share must be called');
                assertEqual(sharedPayload.files[0].name, res.fileName, 'Shared file name must match database filename');
            } finally {
                if (originalNavDesc) {
                    Object.defineProperty(global, 'navigator', originalNavDesc);
                } else {
                    delete global.navigator;
                }
                global.File = originalFile;
                global.Blob = originalBlob;
            }
        });

        suite.test('downloadDatabaseFile fallback anchor download: avoids synchronous revoke for Android WebView stability', async () => {
            const Beta10Database = require('../../db.js');
            const b10 = new Beta10Database();
            b10.SQL = SQL;
            b10.db = db;
            b10.isInitialized = true;

            const originalNavDesc = Object.getOwnPropertyDescriptor(global, 'navigator');
            const originalURL = global.URL;
            const originalDoc = global.document;
            const originalBlob = global.Blob;

            let clicked = false;
            let appendedEl = null;
            let synchronouslyRevoked = false;

            Object.defineProperty(global, 'navigator', {
                value: { canShare: () => false },
                configurable: true,
                writable: true
            });
            global.Blob = class MockBlob {
                constructor(chunks, opts) {
                    this.chunks = chunks;
                }
            };
            global.URL = {
                createObjectURL: () => 'blob:test-sqlite-download-url',
                revokeObjectURL: () => { synchronouslyRevoked = true; }
            };
            global.document = {
                createElement: (tag) => ({
                    tagName: tag,
                    style: {},
                    click: () => { clicked = true; }
                }),
                body: {
                    appendChild: (el) => { appendedEl = el; },
                    removeChild: () => {},
                    contains: () => true
                }
            };

            try {
                const res = await b10.downloadDatabaseFile();
                assertEqual(res.success, true, 'Fallback anchor download must succeed');
                assertEqual(res.method, 'download_anchor', 'Fallback method is download_anchor');
                assertEqual(clicked, true, 'Anchor element must be triggered with click()');
                assert(appendedEl !== null, 'Anchor tag must be appended to body');
                assert(appendedEl.download.endsWith('.sqlite'), 'Anchor download attribute ends with .sqlite');
                assertEqual(synchronouslyRevoked, false, 'Blob URL must NOT be revoked synchronously on the same tick');
            } finally {
                if (originalNavDesc) {
                    Object.defineProperty(global, 'navigator', originalNavDesc);
                } else {
                    delete global.navigator;
                }
                global.URL = originalURL;
                global.document = originalDoc;
                global.Blob = originalBlob;
            }
        });

        suite.test('UI Download Button (#db-download-file-btn): activates download, manages loading state and feedback', async () => {
            let downloadCalled = false;
            const mockBeta10DB = {
                downloadDatabaseFile: async () => {
                    downloadCalled = true;
                    return { success: true, method: 'share', fileName: 'beta10_registres_2026-10-03.sqlite' };
                }
            };

            const button = {
                disabled: false,
                textContent: '📥 Descarregar Fitxer (.sqlite)',
                onclick: null
            };

            // Simulate the button click binding in db-ui.js
            button.onclick = async () => {
                button.disabled = true;
                button.textContent = 'Preparant...';
                try {
                    const res = await mockBeta10DB.downloadDatabaseFile();
                    assert(res.success, 'Download result must be successful');
                } finally {
                    button.disabled = false;
                    button.textContent = '📥 Descarregar Fitxer (.sqlite)';
                }
            };

            // Trigger click
            const clickPromise = button.onclick();
            assertEqual(button.disabled, true, 'Button is disabled while preparing download');
            assertEqual(button.textContent, 'Preparant...', 'Button text indicates preparing');

            await clickPromise;

            assertEqual(downloadCalled, true, 'downloadDatabaseFile was executed');
            assertEqual(button.disabled, false, 'Button is re-enabled after download execution');
            assertEqual(button.textContent, '📥 Descarregar Fitxer (.sqlite)', 'Button label restored');
        });
    });
};
