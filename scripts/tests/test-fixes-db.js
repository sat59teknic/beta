/**
 * scripts/tests/test-fixes-db.js
 * Tests de los arreglos sobre db.js (Beta10Database REAL con sql.js + wasm):
 * migraciones (A1), persistencia propagada y serializada (A2, L9), import/restauracion segura (A4),
 * backup en Android (A5), remuneracion por dia (M5) y entradas invalidas.
 *
 * Cero red real: IndexedDB, Capacitor, document y navigator se simulan en memoria.
 */

const fs = require('fs');
const path = require('path');
const initSqlJs = require('../../sql-wasm.js');
const Beta10Database = require('../../db.js');
const { assert, assertEqual, assertDeepEqual, assertThrowsAsync } = require('../test-harness.js');

module.exports = function registerFixesDbTests(runner) {
    runner.suite('Arreglos DB: migracion, persistencia, restauracion, backup Android y estadisticas', async (suite) => {
        const wasmBinary = fs.readFileSync(path.join(__dirname, '../../sql-wasm.wasm'));
        const SQL = await initSqlJs({ wasmBinary });

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

        function oldDbInstance() {
            const d = new SQL.Database();
            d.run(OLD_SCHEMA);
            const ins = "INSERT INTO jornadas (user, date, start_time, end_time, worked_hours, extra_hours) VALUES ('m', ?, 's', 'e', ?, ?)";
            d.run(ins, ['2026-09-28', 9.75, 0.75]);
            d.run(ins, ['2026-09-29', 9.2, 0.2]);
            return d;
        }

        // IndexedDB simulada con control fino: fallos, retardos por escritura y registro de eventos
        function installFakeIndexedDB(opts = {}) {
            const store = opts.store || {};
            const events = opts.events || [];
            let inFlight = 0;
            const stats = { puts: 0, maxConcurrent: 0 };
            const state = { failPut: !!opts.failPut };
            global.indexedDB = {
                open() {
                    const req = {};
                    setImmediate(() => {
                        req.result = {
                            close() {},
                            objectStoreNames: { contains: () => true },
                            createObjectStore() {},
                            transaction() {
                                const tx = {};
                                tx.objectStore = () => ({
                                    put(bytes, key) {
                                        const r = { error: new Error('QuotaExceededError (simulado)') };
                                        stats.puts++;
                                        inFlight++;
                                        stats.maxConcurrent = Math.max(stats.maxConcurrent, inFlight);
                                        const delay = opts.delayFor ? opts.delayFor(stats.puts) : 0;
                                        setTimeout(() => {
                                            inFlight--;
                                            if (state.failPut) { if (r.onerror) r.onerror(); }
                                            else {
                                                store[key] = bytes;
                                                events.push('put:' + key);
                                                if (r.onsuccess) r.onsuccess();
                                            }
                                        }, delay);
                                        return r;
                                    },
                                    get(key) {
                                        const r = {};
                                        setImmediate(() => { r.result = store[key]; if (r.onsuccess) r.onsuccess(); });
                                        return r;
                                    }
                                });
                                return tx;
                            }
                        };
                        if (req.onsuccess) req.onsuccess();
                    });
                    return req;
                }
            };
            return { store, events, stats, state, restore: () => { delete global.indexedDB; } };
        }

        const sameBytes = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;

        // ================================================================== A1
        suite.test('A1 la migracion fija PRAGMA user_version=1, rellena el historico y NO lo reescribe en la siguiente ejecucion', async () => {
            const b = new Beta10Database();
            b.SQL = SQL;
            b.db = oldDbInstance();
            assertEqual(b.db.exec('PRAGMA user_version')[0].values[0][0], 0, 'precondicion: BD antigua sin version');
            b._createTables();
            assertEqual(b.db.exec('PRAGMA user_version')[0].values[0][0], 1, 'version de esquema');
            const byDate = Object.fromEntries(rowsOf(b, 'SELECT date, remunerated_extra_hours AS r FROM jornadas').map(r => [r.date, r.r]));
            assertEqual(byDate['2026-09-28'], 0.5);
            assertEqual(byDate['2026-09-29'], 0);

            // El usuario corrige una remunerada a mano; una segunda ejecucion de la migracion no la pisa
            b.db.run("UPDATE jornadas SET remunerated_extra_hours = 2 WHERE date = '2026-09-28'");
            b._createTables();
            assertEqual(rowsOf(b, "SELECT remunerated_extra_hours AS r FROM jornadas WHERE date = '2026-09-28'")[0].r, 2, 'idempotente: no recalcula');
        });

        suite.test('A1 una BD que YA tiene la columna (user_version 0) no se reescribe, solo se marca la version', async () => {
            const b = newDb();
            b.db.run("INSERT INTO jornadas (date, start_time, end_time, worked_hours, extra_hours, remunerated_extra_hours) VALUES ('2026-09-28', 's', 'e', 9.75, 0.75, 0)");
            b.db.run('PRAGMA user_version = 0');
            b._createTables();
            assertEqual(rowsOf(b, 'SELECT remunerated_extra_hours AS r FROM jornadas')[0].r, 0, 'valor existente intacto');
            assertEqual(b.db.exec('PRAGMA user_version')[0].values[0][0], 1);
        });

        suite.test('A1 no se traga errores genericos: si el ALTER falla por otro motivo, _createTables lanza', async () => {
            const b = new Beta10Database();
            b.SQL = SQL;
            const real = oldDbInstance();
            const wrapped = Object.create(real);
            wrapped.run = (sql, params) => {
                if (/ALTER TABLE/i.test(sql)) throw new Error('disk I/O error');
                return real.run(sql, params);
            };
            b.db = wrapped;
            let msg = '';
            try { b._createTables(); } catch (e) { msg = e.message; }
            assertEqual(msg, 'disk I/O error');
        });

        suite.test('A1 crea indices por fecha y la migracion es idempotente (3 ejecuciones)', async () => {
            const b = newDb();
            b._createTables();
            b._createTables();
            const idx = rowsOf(b, "SELECT name FROM sqlite_master WHERE type='index'").map(r => r.name);
            assert(idx.includes('idx_jornadas_date'), 'idx_jornadas_date');
            assert(idx.includes('idx_pausas_date'), 'idx_pausas_date');
        });

        // ================================================================== A2 / L9
        suite.test('A2 si falla la persistencia, recordJornada/recordPausa/recordFichaje rechazan y NO dejan la fila en memoria; un reintento no duplica', async () => {
            const b = newDb();
            const idb = installFakeIndexedDB({ failPut: true });
            try {
                const jornada = { date: '2026-10-05', startTime: new Date(2026, 9, 5, 8), endTime: new Date(2026, 9, 5, 18), workedHours: 9.5, extraHours: 0.5 };
                await assertThrowsAsync(() => quiet(() => b.recordJornada(jornada)), 'recordJornada');
                await assertThrowsAsync(() => quiet(() => b.recordPausa({ type: 'dinar', startTime: new Date(2026, 9, 5, 12), endTime: new Date(2026, 9, 5, 12, 30), durationMinutes: 30 })), 'recordPausa');
                await assertThrowsAsync(() => quiet(() => b.recordFichaje({ action: 'entrada', point: 'J' })), 'recordFichaje');
                for (const t of ['jornadas', 'pausas', 'fichajes']) {
                    assertEqual(rowsOf(b, `SELECT COUNT(*) AS c FROM ${t}`)[0].c, 0, `${t} sin filas fantasma`);
                }
                idb.state.failPut = false; // IndexedDB vuelve a funcionar (la cola de reintento reenvia)
                await quiet(() => b.recordJornada(jornada));
                assertEqual(rowsOf(b, 'SELECT COUNT(*) AS c FROM jornadas')[0].c, 1, 'exactamente una fila tras el reintento');
            } finally { idb.restore(); }
        });

        suite.test('A2 si falla la persistencia, updateJornada y deleteJornada restauran la fila original', async () => {
            const b = newDb();
            await quiet(() => b.recordJornada({ date: '2026-10-05', startTime: new Date(2026, 9, 5, 8), endTime: new Date(2026, 9, 5, 18), workedHours: 9.5, extraHours: 0.5, observations: 'original' }));
            const id = rowsOf(b, 'SELECT id FROM jornadas')[0].id;
            const idb = installFakeIndexedDB({ failPut: true });
            try {
                await assertThrowsAsync(() => quiet(() => b.updateJornada(id, { worked_hours: 5, extra_hours: 0, pause_minutes: 99, observations: 'cambiada' })), 'update');
                let r = rowsOf(b, 'SELECT * FROM jornadas')[0];
                assertEqual(r.observations, 'original');
                assertEqual(r.worked_hours, 9.5);
                assertEqual(r.pause_minutes, 0);
                await assertThrowsAsync(() => quiet(() => b.deleteJornada(id)), 'delete');
                r = rowsOf(b, 'SELECT * FROM jornadas')[0];
                assert(r && r.id === id && r.observations === 'original', 'la fila borrada se restaura');
            } finally { idb.restore(); }
        });

        suite.test('L9 persist() serializa los desados: nunca hay dos put concurrentes y gana siempre el estado mas reciente', async () => {
            const b = newDb();
            // El 1er put es lento y el 2o rapido: sin cola, el viejo acabaria PISANDO al nuevo
            const idb = installFakeIndexedDB({ delayFor: (n) => (n === 1 ? 40 : 1) });
            try {
                await quiet(async () => {
                    b.db.run("INSERT INTO jornadas (date, start_time, end_time, worked_hours) VALUES ('2026-10-01', 's', 'e', 1)");
                    const p1 = b.persist();
                    b.db.run("INSERT INTO jornadas (date, start_time, end_time, worked_hours) VALUES ('2026-10-02', 's', 'e', 2)");
                    const p2 = b.persist();
                    await Promise.all([p1, p2]);
                });
                assertEqual(idb.stats.puts, 2);
                assertEqual(idb.stats.maxConcurrent, 1, 'nunca dos put a la vez');
                assert(sameBytes(idb.store[b.IDB_KEY], b.db.export()), 'lo guardado es el estado final (2 filas)');
            } finally { idb.restore(); }
        });

        suite.test('L9 un persist fallido no bloquea la cola: el siguiente persist funciona', async () => {
            const b = newDb();
            const idb = installFakeIndexedDB({ failPut: true });
            try {
                await assertThrowsAsync(() => quiet(() => b.persist()), 'falla');
                idb.state.failPut = false;
                const ok = await quiet(() => b.persist());
                assertEqual(ok, true);
            } finally { idb.restore(); }
        });

        // ================================================================== A4
        function validBackupBytes() {
            const src = newDb();
            src.db.run("INSERT INTO jornadas (user, date, start_time, end_time, worked_hours, extra_hours, remunerated_extra_hours, observations) VALUES ('m','2026-09-01','s','e',9,0,0,'del backup')");
            return src.db.export();
        }
        const toAb = (u8) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);

        suite.test('A4 restaurar guarda una copia previa (memoria + IndexedDB) y undoLastRestore devuelve los datos anteriores', async () => {
            const b = newDb();
            const idb = installFakeIndexedDB();
            try {
                await quiet(() => b.recordJornada({ date: '2026-10-05', startTime: new Date(2026, 9, 5, 8), endTime: new Date(2026, 9, 5, 18), workedHours: 9.5, extraHours: 0.5, observations: 'datos actuales' }));
                assertEqual(await b.hasRestoreSnapshot(), false);
                await quiet(() => b.importDatabaseFile(toAb(validBackupBytes())));
                assertEqual(rowsOf(b, 'SELECT observations AS o FROM jornadas')[0].o, 'del backup');
                assert(idb.store[b.IDB_PRE_RESTORE_KEY] && idb.store[b.IDB_PRE_RESTORE_KEY].length > 0, 'snapshot persistido en IndexedDB');
                assertEqual(await b.hasRestoreSnapshot(), true);

                await quiet(() => b.undoLastRestore());
                assertEqual(rowsOf(b, 'SELECT observations AS o FROM jornadas')[0].o, 'datos actuales', 'datos previos recuperados');
                assert(sameBytes(idb.store[b.IDB_KEY], b.db.export()), 'y persistidos');
            } finally { idb.restore(); }
        });

        suite.test('A4 el snapshot sobrevive a un reinicio (otra instancia lo lee de IndexedDB) y undo sin snapshot rechaza', async () => {
            const idb = installFakeIndexedDB();
            try {
                const b = newDb();
                await assertThrowsAsync(() => quiet(() => b.undoLastRestore()), 'sin snapshot');
                await quiet(() => b.recordJornada({ date: '2026-10-05', startTime: new Date(2026, 9, 5, 8), endTime: new Date(2026, 9, 5, 18), workedHours: 9.5, extraHours: 0, observations: 'antes' }));
                await quiet(() => b.importDatabaseFile(toAb(validBackupBytes())));
                const other = newDb(); // "reinicio": instancia nueva sin snapshot en memoria
                assertEqual(await other.hasRestoreSnapshot(), true);
                await quiet(() => other.undoLastRestore());
                assertEqual(rowsOf(other, 'SELECT observations AS o FROM jornadas')[0].o, 'antes');
            } finally { idb.restore(); }
        });

        suite.test('A4 la BD nueva se persiste ANTES de cerrar la antigua', async () => {
            const b = newDb();
            const events = [];
            const idb = installFakeIndexedDB({ events });
            try {
                const old = b.db;
                const realClose = old.close.bind(old);
                old.close = () => { events.push('close-old'); return realClose(); };
                await quiet(() => b.importDatabaseFile(toAb(validBackupBytes())));
                const putIdx = events.lastIndexOf('put:' + b.IDB_KEY);
                const closeIdx = events.indexOf('close-old');
                assert(putIdx >= 0 && closeIdx >= 0, 'ambos eventos: ' + events.join(','));
                assert(putIdx < closeIdx, 'orden de eventos: ' + events.join(','));
            } finally { idb.restore(); }
        });

        suite.test('A4 si persistir falla durante la restauracion se vuelve a la BD anterior (operativa) y se cierra la candidata', async () => {
            const b = newDb();
            await quiet(() => b.recordJornada({ date: '2026-10-05', startTime: new Date(2026, 9, 5, 8), endTime: new Date(2026, 9, 5, 18), workedHours: 9.5, extraHours: 0, observations: 'local' }));
            const original = b.db;
            const opened = [];
            const RealDb = SQL.Database;
            b.SQL = { Database: class extends RealDb { constructor(d) { super(d); opened.push(this); } close() { this._closed = true; return super.close(); } } };
            const idb = installFakeIndexedDB({ failPut: true });
            try {
                await assertThrowsAsync(() => quiet(() => b.importDatabaseFile(toAb(validBackupBytes()))), 'debe rechazar');
                assert(b.db === original, 'BD anterior activa');
                assertEqual(rowsOf(b, 'SELECT observations AS o FROM jornadas')[0].o, 'local', 'y utilizable (no cerrada)');
                assertEqual(opened.length, 1);
                assertEqual(opened[0]._closed === true, true, 'candidata cerrada');
            } finally { idb.restore(); }
        });

        suite.test('A4 valida columnas de pausas/fichajes: una tabla pausas incompleta se rechaza; faltar remunerated_extra_hours (backup antiguo) se acepta', async () => {
            const bad = new SQL.Database();
            bad.run(OLD_SCHEMA);
            bad.run('CREATE TABLE pausas (id INTEGER PRIMARY KEY, date TEXT);');
            const badBytes = bad.export();
            const b = newDb();
            let msg = '';
            await quiet(async () => { try { await b.importDatabaseFile(toAb(badBytes)); } catch (e) { msg = e.message; } });
            assert(msg.includes('pausas'), 'mensaje menciona la tabla: ' + msg);

            const old = oldDbInstance().export();
            await quiet(() => b.importDatabaseFile(toAb(old)));
            assertEqual(rowsOf(b, 'SELECT COUNT(*) AS c FROM jornadas')[0].c, 2);
            assert(b._getColumns('pausas').includes('duration_minutes'), 'las tablas que faltaban se crean');
        });

        suite.test('A4 un backup truncado a mitad se rechaza (quick_check) sin tocar la BD actual', async () => {
            const b = newDb();
            await quiet(() => b.recordJornada({ date: '2026-10-05', startTime: new Date(2026, 9, 5, 8), endTime: new Date(2026, 9, 5, 18), workedHours: 9.5, extraHours: 0 }));
            const full = validBackupBytes();
            const cut = full.slice(0, Math.floor(full.length / 2));
            const original = b.db;
            await assertThrowsAsync(() => quiet(() => b.importDatabaseFile(toAb(cut))), 'truncado');
            assert(b.db === original);
        });

        // ================================================================== A5
        function withGlobals(globals, fn) {
            const saved = {};
            for (const k of Object.keys(globals)) {
                saved[k] = Object.getOwnPropertyDescriptor(global, k);
                Object.defineProperty(global, k, { value: globals[k], configurable: true, writable: true });
            }
            const restore = () => {
                for (const k of Object.keys(globals)) {
                    if (saved[k]) Object.defineProperty(global, k, saved[k]); else delete global[k];
                }
            };
            return Promise.resolve().then(fn).then(r => { restore(); return r; }, e => { restore(); throw e; });
        }

        suite.test('A5 APK sin plugins Share/Filesystem NO simula exito: success=false y needsBase64 (la UI ofrece el texto)', async () => {
            const b = newDb();
            await withGlobals({ window: { Capacitor: { isNativePlatform: () => true, Plugins: {} } }, document: undefined }, async () => {
                const res = await quiet(() => b.downloadDatabaseFile());
                assertEqual(res.success, false);
                assertEqual(res.needsBase64, true);
                assertEqual(res.method, 'native_download_unsupported');
                assert(/^beta10_registres_\d{4}-\d{2}-\d{2}\.sqlite$/.test(res.fileName), res.fileName);
            });
        });

        suite.test('A5 APK con plugins Filesystem+Share: escribe el .sqlite en cache y abre el menu de compartir', async () => {
            const b = newDb();
            const calls = { write: null, share: null };
            const plugins = {
                Filesystem: { writeFile: async (o) => { calls.write = o; return { uri: 'file:///cache/' + o.path }; } },
                Share: { share: async (o) => { calls.share = o; return {}; } }
            };
            await withGlobals({ window: { Capacitor: { isNativePlatform: () => true, Plugins: plugins } } }, async () => {
                const res = await quiet(() => b.downloadDatabaseFile());
                assertEqual(res.success, true);
                assertEqual(res.method, 'capacitor_share');
                assertEqual(calls.write.directory, 'CACHE');
                assert(Buffer.from(calls.write.data, 'base64').toString('latin1').startsWith('SQLite format 3'), 'contenido = fichero SQLite valido');
                assertEqual(calls.share.url, 'file:///cache/' + res.fileName);
            });
        });

        suite.test('A5 APK: si el usuario cancela el menu de compartir no es un error; si Share falla de verdad se ofrece Base64', async () => {
            const b = newDb();
            const mk = (err) => ({
                Filesystem: { writeFile: async () => ({ uri: 'file:///x' }) },
                Share: { share: async () => { throw err; } }
            });
            await withGlobals({ window: { Capacitor: { isNativePlatform: () => true, Plugins: mk(new Error('Share canceled')) } } }, async () => {
                const res = await quiet(() => b.downloadDatabaseFile());
                assertEqual(res.success, true);
                assertEqual(res.method, 'cancelled_by_user');
            });
            await withGlobals({ window: { Capacitor: { isNativePlatform: () => true, Plugins: mk(new Error('boom')) } } }, async () => {
                const res = await quiet(() => b.downloadDatabaseFile());
                assertEqual(res.success, false);
                assertEqual(res.needsBase64, true);
            });
        });

        suite.test('A5 navegador web (no nativo): <a download> sigue funcionando y se devuelve download_anchor', async () => {
            const b = newDb();
            let clicked = false;
            const anchor = { style: {}, click() { clicked = true; } };
            const fakeDoc = {
                createElement: () => anchor,
                body: { appendChild() {}, removeChild() {}, contains: () => true }
            };
            const timers = [];
            await withGlobals({ document: fakeDoc, window: {}, setTimeout: (fn) => { timers.push(fn); return 0; } }, async () => {
                const res = await quiet(() => b.downloadDatabaseFile());
                assertEqual(res.success, true);
                assertEqual(res.method, 'download_anchor');
                assertEqual(clicked, true);
                assertEqual(timers.length, 1, 'revoke diferido');
            });
        });

        // ================================================================== M5 / entradas invalidas
        suite.test('M5 una jornada sola con remunerada explicita 0 se respeta; un dia con varias jornadas se agrega por dia', async () => {
            const b = newDb();
            await quiet(async () => {
                // Dia A: una fila, 45 min extra pero remunerada explicita 0 (p. ej. editada a mano)
                await b.recordJornada({ date: '2026-10-05', startTime: new Date(2026, 9, 5, 8), endTime: new Date(2026, 9, 5, 18), workedHours: 9.75, extraHours: 0.75, remuneratedExtraHours: 0 });
                // Dia B: dos filas de 20 min -> 40 min -> 0.5h
                for (const h of [8, 14]) {
                    await b.recordJornada({ date: '2026-10-06', startTime: new Date(2026, 9, 6, h), endTime: new Date(2026, 9, 6, h + 4), workedHours: 4, extraHours: 0.33 });
                }
            });
            const s = (await b.getMonthlyOvertimeSummary())[0];
            assertEqual(s.total_remunerated_extra_hours, 0.5);
            assertEqual(s.days_with_extra, 2);
            assertEqual(s.total_worked_extra_hours, 1.41);
        });

        suite.test('M5 la agregacion por dia no mezcla meses: el mismo dia del mes siguiente no se suma', async () => {
            const b = newDb();
            await quiet(async () => {
                await b.recordJornada({ date: '2026-09-30', startTime: new Date(2026, 8, 30, 8), endTime: new Date(2026, 8, 30, 18), workedHours: 10, extraHours: 0.3 });
                await b.recordJornada({ date: '2026-10-01', startTime: new Date(2026, 9, 1, 8), endTime: new Date(2026, 9, 1, 18), workedHours: 10, extraHours: 0.3 });
            });
            const s = await b.getMonthlyOvertimeSummary();
            assertDeepEqual(s.map(x => [x.month, x.total_remunerated_extra_hours]), [['2026-10', 0], ['2026-09', 0]]);
        });

        suite.test('recordJornada/updateJornada sanean NaN: extraHours NaN -> 0 y remunerada recalculada; worked NaN rechaza', async () => {
            const b = newDb();
            await quiet(() => b.recordJornada({ date: '2026-10-05', startTime: new Date(2026, 9, 5, 8), endTime: new Date(2026, 9, 5, 17), workedHours: 9, extraHours: NaN, remuneratedExtraHours: NaN, pauseMinutes: NaN }));
            const r = rowsOf(b, 'SELECT extra_hours AS e, remunerated_extra_hours AS r, pause_minutes AS p FROM jornadas')[0];
            assertDeepEqual([r.e, r.r, r.p], [0, 0, 0]);
            const id = rowsOf(b, 'SELECT id FROM jornadas')[0].id;
            await assertThrowsAsync(() => quiet(() => b.updateJornada(id, { worked_hours: NaN, extra_hours: 0, pause_minutes: 0 })), 'worked NaN');
            await quiet(() => b.updateJornada(id, { worked_hours: 9, extra_hours: undefined, pause_minutes: 'x', observations: '' }));
            const u = rowsOf(b, 'SELECT extra_hours AS e, pause_minutes AS p FROM jornadas')[0];
            assertDeepEqual([u.e, u.p], [0, 0]);
        });

        suite.test('getDatabaseStats: sizeKb sale de PRAGMA page_count*page_size (coincide con el export) sin exportar', async () => {
            const b = newDb();
            await quiet(() => b.recordJornada({ date: '2026-10-05', startTime: new Date(2026, 9, 5, 8), endTime: new Date(2026, 9, 5, 17), workedHours: 9, extraHours: 0 }));
            let exported = 0;
            const realExport = b.db.export.bind(b.db);
            b.db.export = () => { exported++; return realExport(); };
            const st = await b.getDatabaseStats();
            assertEqual(exported, 0, 'no se exporta la BD solo para medirla');
            assertEqual(st.sizeKb, Math.round(realExport().length / 1024));
            assertEqual(st.jornadasCount, 1);
        });

        suite.test('init(): un fallo al cargar IndexedDB cierra la BD a medias y el siguiente init() recupera', async () => {
            const b = new Beta10Database();
            global.initSqlJs = (cfg) => initSqlJs({ ...cfg, wasmBinary });
            const idb = installFakeIndexedDB();
            let failLoad = true;
            const realLoad = b._loadFromIndexedDB.bind(b);
            b._loadFromIndexedDB = async (...a) => { if (failLoad) throw new Error('IDB abierta con error'); return realLoad(...a); };
            try {
                await assertThrowsAsync(() => quiet(() => b.init()), 'primer init falla');
                assertEqual(b.db, null);
                assertEqual(b.initPromise, null, 'no se cachea el rechazo');
                failLoad = false;
                assertEqual(await quiet(() => b.init()), true);
                assert(b.db, 'BD operativa');
            } finally { delete global.initSqlJs; idb.restore(); }
        });
    });
};
