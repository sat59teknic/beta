/**
 * scripts/tests/test-audit-db-stats.js
 * Tests de la auditoria sobre db.js (Beta10Database REAL con sql.js + wasm) y sus estadisticas.
 *
 * Los antiguos tests "[BUG]" reproducian defectos confirmados de la auditoria; ya estan corregidos
 * en el codigo de produccion y el prefijo se ha retirado (sin modificar los tests).
 *
 * Cero red real: sin fetch; IndexedDB se simula en memoria.
 */

const fs = require('fs');
const path = require('path');
const initSqlJs = require('../../sql-wasm.js');
const Beta10Database = require('../../db.js');
const { assert, assertEqual, assertDeepEqual, assertThrowsAsync } = require('../test-harness.js');

module.exports = function registerAuditDbStatsTests(runner) {
    runner.suite('Auditoria DB: migraciones, persistencia, import/export y estadisticas (db.js)', async (suite) => {
        const wasmBinary = fs.readFileSync(path.join(__dirname, '../../sql-wasm.wasm'));
        const SQL = await initSqlJs({ wasmBinary });

        // ------------------------------------------------------------------ helpers
        async function quiet(fn) {
            const saved = { log: console.log, warn: console.warn, error: console.error };
            console.log = console.warn = console.error = () => {};
            try { return await fn(); } finally { Object.assign(console, saved); }
        }

        function newDb() {
            const b = new Beta10Database();
            b.SQL = SQL;
            b.db = new SQL.Database();
            b.isInitialized = true;
            b._createTables();
            return b;
        }

        function installFakeIndexedDB(opts = {}) {
            const store = opts.store || {};
            global.indexedDB = {
                open() {
                    const req = {};
                    setImmediate(() => {
                        req.result = {
                            objectStoreNames: { contains: () => true },
                            createObjectStore() {},
                            transaction() {
                                return {
                                    objectStore() {
                                        return {
                                            put(bytes, key) {
                                                const r = { error: new Error('QuotaExceededError (simulado)') };
                                                setImmediate(() => {
                                                    if (opts.failPut) { if (r.onerror) r.onerror(); }
                                                    else { store[key] = bytes; if (r.onsuccess) r.onsuccess(); }
                                                });
                                                return r;
                                            },
                                            get(key) {
                                                const r = {};
                                                setImmediate(() => { r.result = store[key]; if (r.onsuccess) r.onsuccess(); });
                                                return r;
                                            }
                                        };
                                    }
                                };
                            }
                        };
                        if (req.onsuccess) req.onsuccess();
                    });
                    return req;
                }
            };
            return { store, restore: () => { delete global.indexedDB; } };
        }

        async function withInitSqlJsGlobal(fn) {
            global.initSqlJs = (cfg) => initSqlJs({ ...cfg, wasmBinary });
            try { return await fn(); } finally { delete global.initSqlJs; }
        }

        const rowsOf = (b, sql, params = []) => {
            const stmt = b.db.prepare(sql);
            stmt.bind(params);
            const out = [];
            while (stmt.step()) out.push(stmt.getAsObject());
            stmt.free();
            return out;
        };

        const OLD_SCHEMA = `
            CREATE TABLE jornadas (
                id INTEGER PRIMARY KEY AUTOINCREMENT, user TEXT, date TEXT NOT NULL, start_time TEXT NOT NULL,
                end_time TEXT NOT NULL, type TEXT DEFAULT 'JORNADA', day_type TEXT, standard_hours REAL DEFAULT 9,
                worked_hours REAL NOT NULL, extra_hours REAL DEFAULT 0, pause_minutes REAL DEFAULT 0, observations TEXT,
                created_at TEXT DEFAULT (datetime('now', 'localtime'))
            );`;

        function oldSchemaBytes() {
            const d = new SQL.Database();
            d.run(OLD_SCHEMA);
            const ins = "INSERT INTO jornadas (user, date, start_time, end_time, worked_hours, extra_hours) VALUES ('m', ?, '2026-09-28T08:00:00Z', '2026-09-28T19:00:00Z', ?, ?)";
            d.run(ins, ['2026-09-28', 9.75, 0.75]);
            d.run(ins, ['2026-09-29', 9.2, 0.2]);
            const bytes = d.export();
            d.close();
            return bytes;
        }

        // ================================================================== A1
        suite.test('A1 migracion: jornadas historicas sin columna remunerada deben recalcularse (0.75h -> 0.5, 0.2h -> 0)', async () => {
            const b = new Beta10Database();
            b.SQL = SQL;
            b.db = new SQL.Database(oldSchemaBytes());
            b.isInitialized = true;
            b._createTables(); // aplica la migracion ADD COLUMN

            const days = await b.getOvertimeDaysForMonth('2026-09');
            const byDate = Object.fromEntries(days.map(d => [d.date, d.remunerated_extra_hours]));
            assertEqual(byDate['2026-09-28'], 0.5, '0.75h extra historicas deben quedar como 0.5h remuneradas');
            assertEqual(byDate['2026-09-29'], 0, '0.2h extra historicas deben quedar como 0h remuneradas');
        });

        suite.test('A1 resumen mensual tras migrar un backup antiguo suma 0.5h remuneradas (no 0)', async () => {
            const b = new Beta10Database();
            b.SQL = SQL;
            b.db = new SQL.Database(oldSchemaBytes());
            b.isInitialized = true;
            b._createTables();

            const summary = await b.getMonthlyOvertimeSummary();
            assertEqual(summary.length, 1, 'un unico mes');
            assertEqual(summary[0].total_worked_extra_hours, 0.95, 'horas reales intactas');
            assertEqual(summary[0].total_remunerated_extra_hours, 0.5, 'remuneradas deben recalcularse a 0.5h');
        });

        suite.test('A1 restaurar un backup antiguo (Base64) tambien debe recalcular las remuneradas', async () => {
            const old = Buffer.from(oldSchemaBytes()).toString('base64');
            const b = newDb();
            await quiet(() => b.importDatabaseFromBase64(old));
            const summary = await b.getMonthlyOvertimeSummary();
            assertEqual(summary[0].total_remunerated_extra_hours, 0.5, 'tras restaurar backup antiguo');
        });

        suite.test('A1 control: la migracion anade la columna y conserva los datos existentes', async () => {
            const b = new Beta10Database();
            b.SQL = SQL;
            b.db = new SQL.Database(oldSchemaBytes());
            b._createTables();
            const cols = rowsOf(b, "PRAGMA table_info(jornadas)").map(c => c.name);
            assert(cols.includes('remunerated_extra_hours'), 'columna anadida');
            assertEqual(rowsOf(b, 'SELECT COUNT(*) AS c FROM jornadas')[0].c, 2, 'filas conservadas');
            b._createTables(); // idempotente
            assertEqual(rowsOf(b, 'SELECT COUNT(*) AS c FROM jornadas')[0].c, 2, 'segunda migracion no duplica ni rompe');
        });

        // ================================================================== A2
        suite.test('A2 persist() no debe tragarse un fallo de IndexedDB (debe lanzar o devolver false)', async () => {
            const b = newDb();
            const idb = installFakeIndexedDB({ failPut: true });
            try {
                let threw = false;
                let result;
                try { result = await quiet(() => b.persist()); } catch (e) { threw = true; }
                assert(threw || result === false, 'persist() fallo silenciosamente: devolvio ' + JSON.stringify(result) + ' sin lanzar');
            } finally { idb.restore(); }
        });

        suite.test('A2 recordJornada debe rechazar si la persistencia en IndexedDB falla (si no, el dato se pierde al reiniciar)', async () => {
            const b = newDb();
            const idb = installFakeIndexedDB({ failPut: true });
            try {
                let threw = false;
                try {
                    await quiet(() => b.recordJornada({
                        startTime: new Date(2026, 9, 5, 8), endTime: new Date(2026, 9, 5, 18),
                        workedHours: 9.5, extraHours: 0.5
                    }));
                } catch (e) { threw = true; }
                assert(threw, 'recordJornada resolvio con exito aunque no se pudo persistir');
            } finally { idb.restore(); }
        });

        suite.test('A2 control: persist() guarda los bytes en IndexedDB cuando todo va bien', async () => {
            const b = newDb();
            const idb = installFakeIndexedDB();
            try {
                await quiet(() => b.persist());
                assert(idb.store[b.IDB_KEY] && idb.store[b.IDB_KEY].length > 0, 'bytes guardados');
            } finally { idb.restore(); }
        });

        suite.test('init() round-trip: lo guardado por una instancia lo recupera otra (IndexedDB simulada)', async () => {
            const idb = installFakeIndexedDB();
            try {
                await withInitSqlJsGlobal(async () => {
                    const a = new Beta10Database();
                    await quiet(() => a.init());
                    await quiet(() => a.recordJornada({
                        startTime: new Date(2026, 9, 5, 8), endTime: new Date(2026, 9, 5, 18),
                        workedHours: 9.5, extraHours: 0.5, observations: 'persistida'
                    }));
                    const b = new Beta10Database();
                    await quiet(() => b.init());
                    const rows = await b.getRecentJornadas(5);
                    assertEqual(rows.length, 1, 'la jornada sobrevive al reinicio');
                    assertEqual(rows[0].observations, 'persistida');
                });
            } finally { idb.restore(); }
        });

        // ================================================================== A3
        suite.test('A3 init() fallido no debe dejar initPromise rechazada para siempre (reintento tras arreglar el fallo)', async () => {
            const b = new Beta10Database();
            await quiet(async () => {
                let firstFailed = false;
                try { await b.init(); } catch (e) { firstFailed = true; }
                assert(firstFailed, 'precondicion: sin initSqlJs el primer init debe fallar');
            });
            // El entorno se "recupera" (p. ej. termina de cargar sql-wasm.js)
            await withInitSqlJsGlobal(async () => {
                let ok = false;
                try { ok = await quiet(() => b.init()); } catch (e) { ok = false; }
                assert(ok === true, 'init() sigue devolviendo la promesa rechazada en cache; la app queda sin BD hasta recargar');
            });
        });

        suite.test('A3 control: init() concurrentes comparten una unica inicializacion', async () => {
            const idb = installFakeIndexedDB();
            try {
                await withInitSqlJsGlobal(async () => {
                    const b = new Beta10Database();
                    const [r1, r2] = await quiet(() => Promise.all([b.init(), b.init()]));
                    assertEqual(r1, true);
                    assertEqual(r2, true);
                    const dbRef = b.db;
                    await quiet(() => b.init());
                    assert(b.db === dbRef, 'no se recrea la BD en llamadas posteriores');
                });
            } finally { idb.restore(); }
        });

        // ================================================================== A4
        suite.test('A4 importDatabaseFile debe validar el esquema completo, no solo que exista una tabla "jornadas"', async () => {
            const b = newDb();
            await quiet(() => b.recordJornada({
                startTime: new Date(2026, 9, 5, 8), endTime: new Date(2026, 9, 5, 18), workedHours: 9.5, extraHours: 0.5
            }));
            const fake = new SQL.Database();
            fake.run('CREATE TABLE jornadas (x TEXT);');
            fake.run("INSERT INTO jornadas VALUES ('no es una BD de Beta10')");
            const bytes = fake.export();
            fake.close();

            let threw = false;
            await quiet(async () => { try { await b.importDatabaseFile(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)); } catch (e) { threw = true; } });
            assert(threw, 'se acepto como valida una BD cuya tabla jornadas no tiene las columnas de Beta10');
        });

        suite.test('A4 un import rechazado (sin tabla jornadas) debe cerrar la instancia temporal y no perder la BD actual', async () => {
            const b = newDb();
            await quiet(() => b.recordJornada({
                startTime: new Date(2026, 9, 5, 8), endTime: new Date(2026, 9, 5, 18), workedHours: 9.5, extraHours: 0.5
            }));
            const original = b.db;

            const opened = [];
            b.SQL = {
                Database: class extends SQL.Database {
                    constructor(d) { super(d); opened.push(this); }
                    close() { this._closedByCode = true; return super.close(); }
                }
            };

            const other = new SQL.Database();
            other.run('CREATE TABLE otra_cosa (a INT);');
            const bytes = other.export();
            other.close();

            await assertThrowsAsync(() => quiet(() => b.importDatabaseFile(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))), 'debe rechazar');
            assert(b.db === original, 'la BD actual debe seguir siendo la misma');
            assertEqual(rowsOf(b, 'SELECT COUNT(*) AS c FROM jornadas')[0].c, 1, 'datos actuales intactos');
            assertEqual(opened.length, 1, 'se abrio una instancia temporal');
            assertEqual(opened[0]._closedByCode === true, true, 'la instancia temporal rechazada se quedo abierta (fuga de memoria wasm)');
        });

        suite.test('A4 un import de bytes basura (no SQLite) debe cerrar la instancia temporal', async () => {
            const b = newDb();
            const opened = [];
            b.SQL = {
                Database: class extends SQL.Database {
                    constructor(d) { super(d); opened.push(this); }
                    close() { this._closedByCode = true; return super.close(); }
                }
            };
            const garbage = new Uint8Array(4096).map((_, i) => (i * 31 + 7) % 251);
            await assertThrowsAsync(() => quiet(() => b.importDatabaseFile(garbage.buffer)), 'bytes basura deben rechazarse');
            assertEqual(opened.length, 1);
            assertEqual(opened[0]._closedByCode === true, true, 'instancia temporal sin cerrar tras import fallido');
        });

        suite.test('A4 control: import valido sustituye la BD y conserva los datos', async () => {
            const src = newDb();
            await quiet(() => src.recordJornada({
                date: '2026-10-02', startTime: new Date(2026, 9, 2, 8), endTime: new Date(2026, 9, 2, 18),
                workedHours: 10, extraHours: 1, observations: 'origen'
            }));
            const dst = newDb();
            const bytes = src.db.export();
            await quiet(() => dst.importDatabaseFile(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
            const rows = await dst.getRecentJornadas(5);
            assertEqual(rows.length, 1);
            assertEqual(rows[0].observations, 'origen');
        });

        async function makeBackupBase64() {
            const src = newDb();
            await quiet(async () => {
                for (let d = 1; d <= 20; d++) {
                    await src.recordJornada({
                        date: `2026-09-${String(d).padStart(2, '0')}`,
                        startTime: new Date(2026, 8, d, 8), endTime: new Date(2026, 8, d, 19),
                        workedHours: 10, extraHours: 1, observations: 'dia ' + d + ' ' + 'x'.repeat(200)
                    });
                }
            });
            return { b64: await src.exportDatabaseAsBase64(), count: 20 };
        }

        async function withoutBuffer(fn) {
            const saved = global.Buffer;
            global.Buffer = undefined; // fuerza la rama atob/btoa (navegador / WebView)
            try { return await fn(); } finally { global.Buffer = saved; }
        }

        suite.test('A4 round-trip Base64 con saltos de linea (como pega WhatsApp/correo) - rama Buffer', async () => {
            const { b64, count } = await makeBackupBase64();
            const wrapped = b64.match(/.{1,76}/g).join('\r\n') + '\n';
            const dst = newDb();
            await quiet(() => dst.importDatabaseFromBase64(wrapped));
            assertEqual(rowsOf(dst, 'SELECT COUNT(*) AS c FROM jornadas')[0].c, count);
        });

        suite.test('A4 round-trip Base64 con saltos de linea y espacios - rama atob (sin Buffer)', async () => {
            const { b64, count } = await makeBackupBase64();
            const wrapped = '  ' + b64.match(/.{1,60}/g).join('\n ') + '\n';
            const dst = newDb();
            await withoutBuffer(() => quiet(() => dst.importDatabaseFromBase64(wrapped)));
            assertEqual(rowsOf(dst, 'SELECT COUNT(*) AS c FROM jornadas')[0].c, count);
        });

        suite.test('A4 export Base64 sin Buffer (rama btoa por trozos) coincide con la rama Buffer', async () => {
            const b = newDb();
            await quiet(() => b.recordJornada({
                date: '2026-09-01', startTime: new Date(2026, 8, 1, 8), endTime: new Date(2026, 8, 1, 18), workedHours: 9, extraHours: 0
            }));
            const withBuf = await b.exportDatabaseAsBase64();
            const withoutBuf = await withoutBuffer(() => b.exportDatabaseAsBase64());
            assertEqual(withoutBuf, withBuf, 'ambas ramas deben generar el mismo texto');
        });

        suite.test('A4 acepta prefijo data:...;base64, y rechaza entrada vacia o no-string', async () => {
            const { b64, count } = await makeBackupBase64();
            const dst = newDb();
            await quiet(() => dst.importDatabaseFromBase64('data:application/x-sqlite3;base64,' + b64));
            assertEqual(rowsOf(dst, 'SELECT COUNT(*) AS c FROM jornadas')[0].c, count);
            await assertThrowsAsync(() => dst.importDatabaseFromBase64(''), 'vacio');
            await assertThrowsAsync(() => dst.importDatabaseFromBase64(null), 'null');
            await assertThrowsAsync(() => dst.importDatabaseFromBase64(12345), 'numero');
        });

        suite.test('A4 (hallazgo FALSO) Base64 truncado se rechaza y no deja una BD parcial como activa', async () => {
            const { b64 } = await makeBackupBase64();
            const truncated = b64.slice(0, Math.floor(b64.length * 0.6));
            const dst = newDb();
            await quiet(() => dst.recordJornada({
                date: '2026-10-01', startTime: new Date(2026, 9, 1, 8), endTime: new Date(2026, 9, 1, 17), workedHours: 9, extraHours: 0, observations: 'datos locales'
            }));
            const original = dst.db;

            let threw = false;
            await quiet(async () => { try { await dst.importDatabaseFromBase64(truncated); } catch (e) { threw = true; } });
            assert(threw, 'un texto de copia truncado se importo sin error (BD parcial activa)');
            assert(dst.db === original, 'la BD local debe conservarse tras un import fallido');
        });

        // ================================================================== NaN / entradas invalidas
        suite.test('recordJornada con workedHours NaN/undefined/texto se rechaza o guarda un numero finito (nunca NULL/NaN)', async () => {
            for (const bad of [NaN, undefined, 'abc']) {
                const b = newDb();
                let threw = false;
                await quiet(async () => {
                    try {
                        await b.recordJornada({ date: '2026-10-05', startTime: new Date(2026, 9, 5, 8), endTime: new Date(2026, 9, 5, 17), workedHours: bad, extraHours: 0 });
                    } catch (e) { threw = true; }
                });
                if (threw) continue; // rechazar es un comportamiento aceptable
                const rows = rowsOf(b, 'SELECT worked_hours FROM jornadas');
                assert(rows.length === 1 && Number.isFinite(rows[0].worked_hours),
                    `workedHours=${String(bad)} se guardo como ${JSON.stringify(rows[0] && rows[0].worked_hours)}`);
            }
        });

        suite.test('recordJornada con extraHours NaN no debe dejar extra/remunerada en NULL', async () => {
            const b = newDb();
            let threw = false;
            await quiet(async () => {
                try {
                    await b.recordJornada({ date: '2026-10-05', startTime: new Date(2026, 9, 5, 8), endTime: new Date(2026, 9, 5, 17), workedHours: 9, extraHours: NaN });
                } catch (e) { threw = true; }
            });
            if (threw) return;
            const r = rowsOf(b, 'SELECT extra_hours, remunerated_extra_hours FROM jornadas')[0];
            assert(Number.isFinite(r.extra_hours), 'extra_hours = ' + JSON.stringify(r.extra_hours));
            assert(Number.isFinite(r.remunerated_extra_hours), 'remunerated_extra_hours = ' + JSON.stringify(r.remunerated_extra_hours));
        });

        suite.test('recordJornada con startTime invalido rechaza (no inserta basura)', async () => {
            const b = newDb();
            await assertThrowsAsync(() => quiet(() => b.recordJornada({ startTime: 'no-es-fecha', workedHours: 8 })), 'RangeError esperado');
            assertEqual(rowsOf(b, 'SELECT COUNT(*) AS c FROM jornadas')[0].c, 0);
        });

        // ================================================================== bordes de remunerada
        const EDGES = [
            [0, 0], [0.29, 0], [0.49, 0], [0.5, 0.5], [0.75, 0.5], [0.99, 0.5], [1.0, 1.0], [1.49, 1.0], [1.5, 1.5], [2.0, 2.0]
        ];

        suite.test('Bordes remunerada en recordJornada: 0.49->0, 0.5->0.5, 0.99->0.5, 1.0->1.0 (bloques de 30 min)', async () => {
            for (const [extra, expected] of EDGES) {
                const b = newDb();
                await quiet(() => b.recordJornada({
                    date: '2026-10-05', startTime: new Date(2026, 9, 5, 8), endTime: new Date(2026, 9, 5, 18), workedHours: 9 + extra, extraHours: extra
                }));
                const r = rowsOf(b, 'SELECT remunerated_extra_hours AS r FROM jornadas')[0].r;
                assertEqual(r, expected, `extra=${extra}`);
            }
        });

        suite.test('Bordes remunerada en updateJornada (sin remunerada explicita) usan los mismos bloques', async () => {
            for (const [extra, expected] of EDGES) {
                const b = newDb();
                await quiet(() => b.recordJornada({
                    date: '2026-10-05', startTime: new Date(2026, 9, 5, 8), endTime: new Date(2026, 9, 5, 18), workedHours: 9, extraHours: 0
                }));
                const id = rowsOf(b, 'SELECT id FROM jornadas')[0].id;
                await quiet(() => b.updateJornada(id, { worked_hours: 9 + extra, extra_hours: extra, pause_minutes: 15, observations: 'x' }));
                assertEqual(rowsOf(b, 'SELECT remunerated_extra_hours AS r FROM jornadas')[0].r, expected, `update extra=${extra}`);
            }
        });

        suite.test('Bordes remunerada en el resumen mensual cuando la columna es NULL (fallback SQL)', async () => {
            const b = newDb();
            const cases = [[0.49, 0], [0.5, 0.5], [0.99, 0.5], [1.0, 1.0], [1.49, 1.0], [1.5, 1.5]];
            cases.forEach(([extra], i) => {
                const month = String(i + 1).padStart(2, '0');
                b.db.run(
                    "INSERT INTO jornadas (date, start_time, end_time, worked_hours, extra_hours, remunerated_extra_hours) VALUES (?, 's', 'e', ?, ?, NULL)",
                    [`2025-${month}-10`, 9 + extra, extra]
                );
            });
            const summary = await b.getMonthlyOvertimeSummary();
            const byMonth = Object.fromEntries(summary.map(s => [s.month, s.total_remunerated_extra_hours]));
            cases.forEach(([extra, expected], i) => {
                const month = `2025-${String(i + 1).padStart(2, '0')}`;
                assertEqual(byMonth[month], expected, `fallback SQL extra=${extra}`);
            });
        });

        suite.test('recordJornada respeta una remunerada explicita (incluida 0) y redondea a 2 decimales', async () => {
            const b = newDb();
            await quiet(() => b.recordJornada({
                date: '2026-10-05', startTime: new Date(2026, 9, 5, 8), endTime: new Date(2026, 9, 5, 18),
                workedHours: 9.456, extraHours: 1.004, remuneratedExtraHours: 0
            }));
            const r = rowsOf(b, 'SELECT worked_hours AS w, extra_hours AS e, remunerated_extra_hours AS r FROM jornadas')[0];
            assertEqual(r.w, 9.46);
            assertEqual(r.e, 1);
            assertEqual(r.r, 0, 'remunerada=0 explicita no debe recalcularse');
        });

        // ================================================================== M5
        suite.test('M5 la remuneracion es por DIA: dos jornadas de 20 min extra el mismo dia suman 40 min = 0.5h (no 0 por fila)', async () => {
            const b = newDb();
            await quiet(async () => {
                for (const h of [8, 14]) {
                    await b.recordJornada({
                        date: '2026-10-05', startTime: new Date(2026, 9, 5, h), endTime: new Date(2026, 9, 5, h + 5),
                        workedHours: 5, extraHours: 0.33
                    });
                }
            });
            const summary = await b.getMonthlyOvertimeSummary();
            assertEqual(summary[0].total_worked_extra_hours, 0.66, 'reales');
            assertEqual(summary[0].total_remunerated_extra_hours, 0.5, 'la UI documenta "blocs de 30m diaris": 40 min el mismo dia deben remunerar 0.5h');
        });

        suite.test('M5 control: un solo dia con 45 min extra remunera 0.5h y 20 min remunera 0h', async () => {
            const b = newDb();
            await quiet(async () => {
                await b.recordJornada({ date: '2026-10-05', startTime: new Date(2026, 9, 5, 8), endTime: new Date(2026, 9, 5, 18), workedHours: 9.75, extraHours: 0.75 });
                await b.recordJornada({ date: '2026-10-06', startTime: new Date(2026, 9, 6, 8), endTime: new Date(2026, 9, 6, 18), workedHours: 9.33, extraHours: 0.33 });
            });
            const summary = await b.getMonthlyOvertimeSummary();
            assertEqual(summary[0].total_remunerated_extra_hours, 0.5);
        });

        // ================================================================== L7
        async function seedL7() {
            const b = newDb();
            await quiet(async () => {
                const mk = (date, startH, worked, extra) => b.recordJornada({
                    date, startTime: new Date(2026, 8, +date.slice(8), startH), endTime: new Date(2026, 8, +date.slice(8), startH + 1),
                    workedHours: worked, extraHours: extra
                });
                await mk('2026-09-28', 8, 10, 1);   // dia con extra (fila 1)
                await mk('2026-09-28', 20, 1, 0.5); // mismo dia, segunda fila con extra
                await mk('2026-09-29', 8, 8.5, 0);  // dia sin extra
                await mk('2026-09-30', 8, 9.5, 0.5); // dia con extra
            });
            return b;
        }

        suite.test('L7 days_with_extra debe contar DIAS distintos con extra (2), no filas (3)', async () => {
            const b = await seedL7();
            const s = (await b.getMonthlyOvertimeSummary())[0];
            assertEqual(s.days_with_extra, 2, 'dias 28 y 30');
        });

        suite.test('L7 total_worked_hours del mes incluye tambien los dias sin extra (29h) (antes [DUDOSO]: se implemento esta semantica)', async () => {
            const b = await seedL7();
            const s = (await b.getMonthlyOvertimeSummary())[0];
            assertEqual(s.total_worked_hours, 29, 'worked total del mes (10 + 1 + 8.5 + 9.5)');
        });

        suite.test('L7 control: resumen mensual agrupa y ordena meses DESC con sumas de extra correctas', async () => {
            const b = newDb();
            await quiet(async () => {
                await b.recordJornada({ date: '2026-08-31', startTime: new Date(2026, 7, 31, 8), endTime: new Date(2026, 7, 31, 19), workedHours: 11, extraHours: 2 });
                await b.recordJornada({ date: '2026-09-01', startTime: new Date(2026, 8, 1, 8), endTime: new Date(2026, 8, 1, 19), workedHours: 10, extraHours: 1 });
                await b.recordJornada({ date: '2026-09-02', startTime: new Date(2026, 8, 2, 8), endTime: new Date(2026, 8, 2, 17), workedHours: 9, extraHours: 0 });
            });
            const s = await b.getMonthlyOvertimeSummary();
            assertDeepEqual(s.map(x => x.month), ['2026-09', '2026-08']);
            assertEqual(s[0].total_worked_extra_hours, 1);
            assertEqual(s[1].total_worked_extra_hours, 2);
        });

        suite.test('Resumen mensual vacio: sin jornadas devuelve []', async () => {
            const b = newDb();
            assertDeepEqual(await b.getMonthlyOvertimeSummary(), []);
            assertDeepEqual(await b.getOvertimeDaysForMonth('2026-09'), []);
            assertDeepEqual(await b.getJornadasForMonth('2026-09'), []);
        });

        // ================================================================== limites de mes/ano
        suite.test('getJornadasForMonth: limites de mes y ano (31-dic / 01-ene, bisiesto, febrero)', async () => {
            const b = newDb();
            const dates = ['2025-12-31', '2026-01-01', '2026-01-31', '2026-02-28', '2026-12-31', '2027-01-01', '2028-02-29'];
            await quiet(async () => {
                for (const d of dates) {
                    const [y, m, day] = d.split('-').map(Number);
                    await b.recordJornada({ date: d, startTime: new Date(y, m - 1, day, 8), endTime: new Date(y, m - 1, day, 17), workedHours: 9, extraHours: 0 });
                }
            });
            const get = async (ym) => (await b.getJornadasForMonth(ym)).map(r => r.date);
            assertDeepEqual(await get('2025-12'), ['2025-12-31']);
            assertDeepEqual(await get('2026-01'), ['2026-01-01', '2026-01-31']);
            assertDeepEqual(await get('2026-02'), ['2026-02-28']);
            assertDeepEqual(await get('2026-12'), ['2026-12-31']);
            assertDeepEqual(await get('2027-01'), ['2027-01-01']);
            assertDeepEqual(await get('2028-02'), ['2028-02-29']);
            assertDeepEqual(await get('2027-02'), []);
        });

        suite.test('getJornadasForMonth: mes invalido o mal formado devuelve [] sin lanzar', async () => {
            const b = newDb();
            await quiet(() => b.recordJornada({ date: '2026-09-10', startTime: new Date(2026, 8, 10, 8), endTime: new Date(2026, 8, 10, 17), workedHours: 9, extraHours: 0 }));
            for (const bad of ['2026-13', '2026-00', '', '2026-9', '26-09', 'septiembre']) {
                assertDeepEqual(await b.getJornadasForMonth(bad), [], `mes "${bad}"`);
            }
        });

        suite.test('getJornadasForMonth ordena por fecha e id ascendentes; getOvertimeDaysForMonth solo extra>0 en DESC', async () => {
            const b = newDb();
            await quiet(async () => {
                await b.recordJornada({ date: '2026-09-10', startTime: new Date(2026, 8, 10, 8), endTime: new Date(2026, 8, 10, 17), workedHours: 9, extraHours: 0, observations: 'b' });
                await b.recordJornada({ date: '2026-09-02', startTime: new Date(2026, 8, 2, 8), endTime: new Date(2026, 8, 2, 19), workedHours: 11, extraHours: 2, observations: 'a' });
                await b.recordJornada({ date: '2026-09-10', startTime: new Date(2026, 8, 10, 18), endTime: new Date(2026, 8, 10, 20), workedHours: 2, extraHours: 1, observations: 'c' });
            });
            assertDeepEqual((await b.getJornadasForMonth('2026-09')).map(r => r.observations), ['a', 'b', 'c']);
            assertDeepEqual((await b.getOvertimeDaysForMonth('2026-09')).map(r => r.observations), ['c', 'a']);
        });

        suite.test('Una jornada que cruza medianoche se asigna al dia de INICIO', async () => {
            const b = newDb();
            await quiet(() => b.recordJornada({
                startTime: new Date(2026, 8, 30, 22, 0), endTime: new Date(2026, 9, 1, 6, 0), workedHours: 8, extraHours: 0
            }));
            assertEqual((await b.getJornadasForMonth('2026-09')).length, 1);
            assertEqual((await b.getJornadasForMonth('2026-10')).length, 0);
        });

        // ================================================================== pausas
        async function seedPauses() {
            const b = newDb();
            const mk = (date, type, mins, h) => b.recordPausa({
                date, type, startTime: new Date(2026, 8, +date.slice(8), h, 0), endTime: new Date(2026, 8, +date.slice(8), h, 30), durationMinutes: mins
            });
            await quiet(async () => {
                await mk('2026-09-28', 'esmorçar', 15.26, 10);
                await mk('2026-09-28', 'dinar', 30.04, 14);
                await mk('2026-09-29', 'dinar', 31, 14);
                await mk('2026-09-30', 'esmorçar', 14.5, 10);
                await mk('2026-09-30', 'pausa', 5, 16); // tipo desconocido: cuenta en el total pero no en esmorzar/dinar
            });
            return b;
        }

        suite.test('getDailyPausesSummary: agrupa por dia, desglosa esmorzar/dinar, ordena DESC y redondea a 1 decimal', async () => {
            const b = await seedPauses();
            const s = await b.getDailyPausesSummary();
            assertDeepEqual(s.map(r => r.date), ['2026-09-30', '2026-09-29', '2026-09-28']);
            const d28 = s[2];
            assertEqual(d28.breakfast_min, 15.3);
            assertEqual(d28.lunch_min, 30);
            assertEqual(d28.total_pause_min, 45.3);
            assertEqual(d28.total_pauses, 2);
            const d30 = s[0];
            assertEqual(d30.breakfast_min, 14.5);
            assertEqual(d30.lunch_min, 0);
            assertEqual(d30.total_pause_min, 19.5, 'el tipo desconocido suma al total');
            assertEqual(d30.total_pauses, 2);
        });

        suite.test('getDailyPausesSummary: limite (2 dias mas recientes, 0 = ninguno) y BD vacia', async () => {
            const b = await seedPauses();
            assertDeepEqual((await b.getDailyPausesSummary(2)).map(r => r.date), ['2026-09-30', '2026-09-29']);
            assertDeepEqual(await b.getDailyPausesSummary(0), []);
            assertDeepEqual(await newDb().getDailyPausesSummary(), []);
        });

        suite.test('recordPausa: sin date usa el dia LOCAL de inicio; getPausesForDate ordena por inicio', async () => {
            const b = newDb();
            await quiet(async () => {
                await b.recordPausa({ type: 'dinar', startTime: new Date(2026, 8, 30, 0, 10), endTime: new Date(2026, 8, 30, 0, 40), durationMinutes: 30 });
                await b.recordPausa({ type: 'esmorçar', startTime: new Date(2026, 8, 30, 0, 5), endTime: new Date(2026, 8, 30, 0, 20), durationMinutes: 15 });
            });
            const rows = await b.getPausesForDate('2026-09-30');
            assertEqual(rows.length, 2, 'dia local 30 aunque en UTC sea el 29');
            assertDeepEqual(rows.map(r => r.type), ['esmorçar', 'dinar']);
        });

        suite.test('getDatabaseStats cuenta filas de las tres tablas', async () => {
            const b = await seedPauses();
            await quiet(async () => {
                await b.recordJornada({ date: '2026-09-28', startTime: new Date(2026, 8, 28, 8), endTime: new Date(2026, 8, 28, 17), workedHours: 9, extraHours: 0 });
                await b.recordFichaje({ action: 'entrada', point: 'J' });
            });
            const st = await b.getDatabaseStats();
            assertEqual(st.jornadasCount, 1);
            assertEqual(st.pausasCount, 5);
            assertEqual(st.fichajesCount, 1);
            assert(st.sizeKb >= 0);
        });
    });
};
