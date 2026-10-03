/**
 * db.js - Gestor de Base de Dades Local SQLite per a Beta10
 * Utilitza sql.js (WebAssembly SQLite) amb persistència a IndexedDB.
 */

class Beta10Database {
    constructor() {
        this.db = null;
        this.SQL = null;
        this.isInitialized = false;
        this.initPromise = null;
        this.IDB_NAME = 'beta10_sqlite_storage';
        this.IDB_STORE = 'sqlite_file';
        this.IDB_KEY = 'database_bytes';
        // Còpia de la BD anterior a l'última restauració (per poder desfer-la)
        this.IDB_PRE_RESTORE_KEY = 'database_bytes_pre_restore';
        this._previousSnapshot = null;
        // Cua que serialitza els desats a IndexedDB (L9): mai dos export/put concurrents
        this._persistQueue = Promise.resolve();
        // Versió d'esquema (PRAGMA user_version)
        this.SCHEMA_VERSION = 1;
    }

    /**
     * Inicialitza la base de dades SQLite
     */
    async init() {
        if (this.isInitialized && this.db) return true;
        if (this.initPromise) return this.initPromise;

        const initRun = (async () => {
            try {
                console.log('🔄 Inicialitzant SQLite (sql.js Wasm)...');

                // 1. Carregar el mòdul Wasm de sql.js
                const sqlInitFn = (typeof initSqlJs === 'function') 
                    ? initSqlJs 
                    : (typeof window !== 'undefined' && typeof window.initSqlJs === 'function')
                        ? window.initSqlJs
                        : (typeof global !== 'undefined' && typeof global.initSqlJs === 'function')
                            ? global.initSqlJs
                            : null;

                if (!sqlInitFn) {
                    throw new Error('initSqlJs no està disponible. Assegura\'t de carregar sql-wasm.js abans.');
                }

                this.SQL = await sqlInitFn({
                    locateFile: (file) => file
                });

                // 2. Llegir bytes de la base de dades des d'IndexedDB si existeix
                const savedBytes = await this._loadFromIndexedDB();

                if (savedBytes && savedBytes.length > 0) {
                    console.log(`📦 Base de dades SQLite existent recuperada (${savedBytes.length} bytes)`);
                    this.db = new this.SQL.Database(savedBytes);
                } else {
                    console.log('✨ Creant nova base de dades SQLite...');
                    this.db = new this.SQL.Database();
                }

                // 3. Crear taules si no existeixen
                this._createTables();

                // 4. Desar estat inicial (no fatal: la BD en memòria ja és operativa;
                //    els desats posteriors reintentaran i propagaran l'error)
                try {
                    await this.persist();
                } catch (persistErr) {
                    console.warn('⚠️ No s\'ha pogut desar l\'estat inicial a IndexedDB:', persistErr);
                }

                this.isInitialized = true;
                console.log('✅ Base de dades SQLite llesta i operativa!');
                return true;
            } catch (err) {
                console.error('❌ Error inicialitzant SQLite:', err);
                this.isInitialized = false;
                try { if (this.db) this.db.close(); } catch (closeErr) {}
                this.db = null;
                throw err;
            }
        })();

        // A3: no deixar la promesa rebutjada en cache; el proper init() torna a intentar-ho.
        // (S'ha de fer aquí i no al catch: si l'error és síncron, el catch s'executaria abans
        // d'assignar this.initPromise i l'assignació posterior ho tornaria a deixar rebutjat.)
        this.initPromise = initRun;
        initRun.catch(() => {
            if (this.initPromise === initRun) this.initPromise = null;
        });

        return initRun;
    }

    /**
     * Crea l'esquema de taules SQLite
     */
    _createTables() {
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
        this.db.run(schema);
        this._migrate();
        this.db.run('CREATE INDEX IF NOT EXISTS idx_jornadas_date ON jornadas(date);');
        this.db.run('CREATE INDEX IF NOT EXISTS idx_pausas_date ON pausas(date);');
    }

    /**
     * Retorna els noms de columna d'una taula (PRAGMA table_info). [] si la taula no existeix.
     */
    _getColumns(table, dbInstance = this.db) {
        const res = dbInstance.exec(`PRAGMA table_info(${table})`);
        if (!res || res.length === 0) return [];
        const nameIdx = res[0].columns.indexOf('name');
        return res[0].values.map(row => row[nameIdx]);
    }

    /**
     * Migracions idempotents basades en PRAGMA table_info / user_version (A1).
     * No s'empassa errors genèrics: només s'afegeix la columna si realment falta.
     */
    _migrate() {
        const cols = this._getColumns('jornadas');
        if (!cols.includes('remunerated_extra_hours')) {
            this.db.run('ALTER TABLE jornadas ADD COLUMN remunerated_extra_hours REAL DEFAULT 0;');
            // Omplir l'històric: blocs complets de 30 min per jornada (mateixa fórmula que recordJornada)
            this.db.run(`UPDATE jornadas
                SET remunerated_extra_hours = CAST((COALESCE(extra_hours, 0) + 0.0001) / 0.5 AS INT) * 0.5;`);
        }
        const res = this.db.exec('PRAGMA user_version');
        const current = (res[0] && res[0].values[0][0]) || 0;
        if (current < this.SCHEMA_VERSION) {
            this.db.run(`PRAGMA user_version = ${this.SCHEMA_VERSION};`);
        }
    }

    /**
     * Desa el contingut actual de SQLite a IndexedDB
     */
    persist() {
        // L9: cua/mutex. Cada desat espera l'anterior, així no hi ha exports ni put concurrents
        // que puguin acabar escrivint un estat més antic sobre un de més nou.
        const run = async () => {
            if (!this.db) return false;
            try {
                const data = this.db.export();
                await this._saveToIndexedDB(data);
                return true;
            } catch (err) {
                console.error('❌ Error persistint SQLite a IndexedDB:', err);
                throw err; // A2: l'error ha d'arribar a qui ha cridat (UI / cua de pendents)
            }
        };
        const result = this._persistQueue.then(run, run);
        this._persistQueue = result.catch(() => {});
        return result;
    }

    /**
     * Persisteix; si falla, desfà el canvi en memòria (undo) perquè un reintent
     * (p. ex. la cua de jornades pendents) no dupliqui files.
     */
    async _persistOrUndo(undo) {
        try {
            await this.persist();
        } catch (err) {
            try { if (undo) undo(); } catch (undoErr) { console.warn('⚠️ No s\'ha pogut desfer el canvi:', undoErr); }
            throw err;
        }
    }

    _lastInsertId() {
        const r = this.db.exec('SELECT last_insert_rowid()');
        return r[0].values[0][0];
    }

    _snapshotRow(table, id) {
        const stmt = this.db.prepare(`SELECT * FROM ${table} WHERE id = ?`);
        stmt.bind([id]);
        const row = stmt.step() ? stmt.getAsObject() : null;
        stmt.free();
        return row;
    }

    _restoreRow(table, row) {
        if (!row) return;
        const cols = Object.keys(row);
        this.db.run(
            `INSERT OR REPLACE INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
            cols.map(c => row[c])
        );
    }

    /**
     * Obre connexió amb IndexedDB
     */
    _openIndexedDB() {
        if (typeof indexedDB === 'undefined') return Promise.resolve(null);
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.IDB_NAME, 1);
            request.onupgradeneeded = (e) => {
                const idb = e.target.result;
                if (!idb.objectStoreNames.contains(this.IDB_STORE)) {
                    idb.createObjectStore(this.IDB_STORE);
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Desa bytes a IndexedDB
     */
    async _saveToIndexedDB(bytes, key = this.IDB_KEY) {
        if (typeof indexedDB === 'undefined') return true;
        const idb = await this._openIndexedDB();
        if (!idb) return true;
        const closeIdb = () => { try { if (typeof idb.close === 'function') idb.close(); } catch (e) {} };
        return new Promise((resolve, reject) => {
            const tx = idb.transaction(this.IDB_STORE, 'readwrite');
            tx.onabort = () => { closeIdb(); reject(tx.error || new Error('Transacció IndexedDB avortada')); };
            const store = tx.objectStore(this.IDB_STORE);
            const req = store.put(bytes, key);
            req.onsuccess = () => { closeIdb(); resolve(true); };
            req.onerror = () => { closeIdb(); reject(req.error); };
        });
    }

    /**
     * Carrega bytes des d'IndexedDB
     */
    async _loadFromIndexedDB(key = this.IDB_KEY) {
        if (typeof indexedDB === 'undefined') return null;
        const idb = await this._openIndexedDB();
        if (!idb) return null;
        const closeIdb = () => { try { if (typeof idb.close === 'function') idb.close(); } catch (e) {} };
        return new Promise((resolve, reject) => {
            const tx = idb.transaction(this.IDB_STORE, 'readonly');
            const store = tx.objectStore(this.IDB_STORE);
            const req = store.get(key);
            req.onsuccess = () => { closeIdb(); resolve(req.result ? new Uint8Array(req.result) : null); };
            req.onerror = () => { closeIdb(); reject(req.error); };
        });
    }

    // ==========================================
    // INSERCIÓ DE DADES
    // ==========================================
    // Totes les escriptures propaguen l'error si IndexedDB falla (A2) i desfan el
    // canvi en memòria perquè un reintent no dupliqui registres.

    _num(value, fallback = 0) {
        const n = Number(value);
        return Number.isFinite(n) ? n : fallback;
    }

    /**
     * Registra un fitxatge individual
     */
    async recordFichaje({ user = '', timestamp = null, action, point, observations = '', latitude = null, longitude = null }) {
        await this.init();
        const ts = timestamp ? new Date(timestamp).toISOString() : new Date().toISOString();
        const sql = `
            INSERT INTO fichajes (user, timestamp, action, point, observations, latitude, longitude)
            VALUES (?, ?, ?, ?, ?, ?, ?);
        `;
        this.db.run(sql, [user, ts, action, point, observations || '', latitude, longitude]);
        const id = this._lastInsertId();
        await this._persistOrUndo(() => this.db.run('DELETE FROM fichajes WHERE id = ?;', [id]));
        console.log(`💾 SQLite: Fitxatge registrat (${action} ${point})`);
    }

    /**
     * Registra una pausa completada
     */
    async recordPausa({ user = '', date = null, type, startTime, endTime, durationMinutes }) {
        await this.init();
        const d = date || this.formatDate(startTime || new Date());
        const startIso = new Date(startTime).toISOString();
        const endIso = new Date(endTime).toISOString();
        const durMin = Math.round(this._num(durationMinutes) * 10) / 10;

        const sql = `
            INSERT INTO pausas (user, date, type, start_time, end_time, duration_minutes)
            VALUES (?, ?, ?, ?, ?, ?);
        `;
        this.db.run(sql, [user, d, type, startIso, endIso, durMin]);
        const id = this._lastInsertId();
        await this._persistOrUndo(() => this.db.run('DELETE FROM pausas WHERE id = ?;', [id]));
        console.log(`💾 SQLite: Pausa registrada (${type}, ${durMin} min)`);
    }

    /**
     * Registra una jornada finalitzada
     */
    async recordJornada({
        user = '',
        date = null,
        startTime,
        endTime = new Date(),
        type = 'JORNADA',
        dayType = '',
        standardHours = 9,
        workedHours,
        extraHours = 0,
        remuneratedExtraHours = null,
        pauseMinutes = 0,
        observations = ''
    }) {
        await this.init();
        const d = date || this.formatDate(startTime || new Date());
        const startIso = new Date(startTime).toISOString();
        const endIso = new Date(endTime).toISOString();
        const stdH = Number(standardHours) || 0;
        const wrkRaw = Number(workedHours);
        if (!Number.isFinite(wrkRaw)) {
            throw new Error('workedHours no és un número vàlid');
        }
        const wrkH = Math.round(wrkRaw * 100) / 100;
        // NaN/negatiu en extraHours no ha de deixar NULL ni valors absurds a la BD
        const extH = Math.max(0, Math.round(this._num(extraHours) * 100) / 100);
        const remExplicit = (remuneratedExtraHours !== null && remuneratedExtraHours !== undefined && Number.isFinite(Number(remuneratedExtraHours)))
            ? Math.max(0, Math.round(Number(remuneratedExtraHours) * 100) / 100)
            : null;
        const remExtH = remExplicit !== null
            ? remExplicit
            : Math.floor((extH + 0.0001) / 0.5) * 0.5;
        const pauM = Math.max(0, Math.round(this._num(pauseMinutes) * 10) / 10);

        const sql = `
            INSERT INTO jornadas (user, date, start_time, end_time, type, day_type, standard_hours, worked_hours, extra_hours, remunerated_extra_hours, pause_minutes, observations)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
        `;
        this.db.run(sql, [user, d, startIso, endIso, type, dayType, stdH, wrkH, extH, remExtH, pauM, observations || '']);
        const id = this._lastInsertId();
        await this._persistOrUndo(() => this.db.run('DELETE FROM jornadas WHERE id = ?;', [id]));
        console.log(`💾 SQLite: Jornada registrada (${d}: ${wrkH}h treballades, ${extH}h extra real, ${remExtH}h extra remunerades)`);
    }

    /**
     * Actualitza manualment una jornada existent (per a corregir anomalies com 191m de pausa)
     */
    async updateJornada(id, { worked_hours, extra_hours, remunerated_extra_hours, pause_minutes, observations }) {
        await this.init();
        const wrkRaw = Number(worked_hours);
        if (!Number.isFinite(wrkRaw)) {
            throw new Error('worked_hours no és un número vàlid');
        }
        const extH = Math.max(0, Math.round(this._num(extra_hours) * 100) / 100);
        const remH = (remunerated_extra_hours !== undefined && remunerated_extra_hours !== null && Number.isFinite(Number(remunerated_extra_hours)))
            ? Math.max(0, Math.round(Number(remunerated_extra_hours) * 100) / 100)
            : Math.floor((extH + 0.0001) / 0.5) * 0.5;

        const previous = this._snapshotRow('jornadas', id);
        const sql = `
            UPDATE jornadas
            SET worked_hours = ?, extra_hours = ?, remunerated_extra_hours = ?, pause_minutes = ?, observations = ?
            WHERE id = ?;
        `;
        this.db.run(sql, [
            Math.round(wrkRaw * 100) / 100,
            extH,
            remH,
            Math.round(this._num(pause_minutes) * 10) / 10,
            observations || '',
            id
        ]);
        await this._persistOrUndo(() => this._restoreRow('jornadas', previous));
        console.log(`💾 SQLite: Jornada #${id} actualitzada`);
    }

    /**
     * Elimina una jornada per ID
     */
    async deleteJornada(id) {
        await this.init();
        const previous = this._snapshotRow('jornadas', id);
        this.db.run("DELETE FROM jornadas WHERE id = ?;", [id]);
        await this._persistOrUndo(() => this._restoreRow('jornadas', previous));
        console.log(`💾 SQLite: Jornada #${id} eliminada`);
    }

    /**
     * Elimina una pausa per ID
     */
    async deletePausa(id) {
        await this.init();
        const previous = this._snapshotRow('pausas', id);
        this.db.run("DELETE FROM pausas WHERE id = ?;", [id]);
        await this._persistOrUndo(() => this._restoreRow('pausas', previous));
        console.log(`💾 SQLite: Pausa #${id} eliminada`);
    }

    // ==========================================
    // CONSULTES PER A LA UI
    // ==========================================

    /**
     * Retorna el resum d'hores extra agrupades per mes.
     *
     * Fórmula (M5): la remuneració és PER DIA, no per fila. Per a cada dia amb extra:
     *   - si només hi ha una jornada aquell dia, es respecta el valor desat a
     *     remunerated_extra_hours (o, si és NULL, floor(extra / 0.5) * 0.5);
     *   - si hi ha diverses jornades el mateix dia, es sumen les extra reals del dia i
     *     s'aplica floor(suma / 0.5) * 0.5 (blocs complets de 30 min).
     * Després se sumen els dies del mes. days_with_extra compta DIES distints (L7).
     * total_worked_hours és el total treballat de TOT el mes (també dies sense extra).
     */
    async getMonthlyOvertimeSummary() {
        await this.init();
        const sql = `
            SELECT
                d.month AS month,
                ROUND(SUM(d.extra), 2) AS total_worked_extra_hours,
                ROUND(SUM(d.rem), 2) AS total_remunerated_extra_hours,
                ROUND(SUM(d.extra), 2) AS total_extra_hours,
                ROUND((SELECT COALESCE(SUM(j.worked_hours), 0) FROM jornadas j WHERE strftime('%Y-%m', j.date) = d.month), 2) AS total_worked_hours,
                COUNT(*) AS days_with_extra
            FROM (
                SELECT
                    strftime('%Y-%m', date) AS month,
                    date,
                    SUM(extra_hours) AS extra,
                    CASE WHEN COUNT(*) = 1
                        THEN COALESCE(MAX(remunerated_extra_hours), CAST((SUM(extra_hours) + 0.0001) / 0.5 AS INT) * 0.5)
                        ELSE CAST((SUM(extra_hours) + 0.0001) / 0.5 AS INT) * 0.5
                    END AS rem
                FROM jornadas
                WHERE extra_hours > 0
                GROUP BY date
            ) d
            GROUP BY d.month
            ORDER BY d.month DESC;
        `;
        const res = this.db.exec(sql);
        return this._formatQueryResults(res);
    }

    /**
     * Retorna el detall de jornades amb hores extra d'un mes específic (ex: '2026-09')
     */
    async getOvertimeDaysForMonth(yearMonth) {
        await this.init();
        const sql = `
            SELECT * FROM jornadas
            WHERE strftime('%Y-%m', date) = ? AND extra_hours > 0
            ORDER BY date DESC, id DESC;
        `;
        return this._queryAll(sql, [yearMonth]);
    }

    /**
     * Retorna totes les jornades d'un mes específic (ex: '2026-09')
     */
    async getJornadasForMonth(yearMonth) {
        await this.init();
        const sql = `
            SELECT * FROM jornadas
            WHERE strftime('%Y-%m', date) = ?
            ORDER BY date ASC, id ASC;
        `;
        return this._queryAll(sql, [yearMonth]);
    }

    /**
     * Retorna el resum de pauses diàries (desglossat per esmorçar, dinar i total)
     */
    async getDailyPausesSummary(limit = 60) {
        await this.init();
        const sql = `
            SELECT
                date,
                ROUND(SUM(CASE WHEN type = 'esmorçar' THEN duration_minutes ELSE 0 END), 1) as breakfast_min,
                ROUND(SUM(CASE WHEN type = 'dinar' THEN duration_minutes ELSE 0 END), 1) as lunch_min,
                ROUND(SUM(duration_minutes), 1) as total_pause_min,
                COUNT(*) as total_pauses
            FROM pausas
            GROUP BY date
            ORDER BY date DESC
            LIMIT ?;
        `;
        return this._queryAll(sql, [limit]);
    }

    /**
     * Retorna el detall de totes les pauses d'un dia concret
     */
    async getPausesForDate(dateStr) {
        await this.init();
        const sql = `
            SELECT * FROM pausas
            WHERE date = ?
            ORDER BY start_time ASC;
        `;
        return this._queryAll(sql, [dateStr]);
    }

    /**
     * Retorna les últimes jornades
     */
    async getRecentJornadas(limit = 30) {
        await this.init();
        const sql = `
            SELECT * FROM jornadas
            ORDER BY date DESC, id DESC
            LIMIT ?;
        `;
        return this._queryAll(sql, [limit]);
    }

    _queryAll(sql, params = []) {
        const stmt = this.db.prepare(sql);
        try {
            stmt.bind(params);
            const rows = [];
            while (stmt.step()) {
                rows.push(stmt.getAsObject());
            }
            return rows;
        } finally {
            stmt.free();
        }
    }

    /**
     * Estadístiques generals de la base de dades
     */
    async getDatabaseStats() {
        await this.init();
        const count = (table) => this.db.exec(`SELECT COUNT(*) as c FROM ${table}`)[0]?.values[0][0] || 0;
        // Mida = pàgines * mida de pàgina (evita exportar tota la BD només per mesurar-la)
        const pages = this.db.exec('PRAGMA page_count')[0]?.values[0][0] || 0;
        const pageSize = this.db.exec('PRAGMA page_size')[0]?.values[0][0] || 0;
        return {
            jornadasCount: count('jornadas'),
            pausasCount: count('pausas'),
            fichajesCount: count('fichajes'),
            sizeKb: Math.round((pages * pageSize) / 1024)
        };
    }

    /**
     * Indica si el dispositiu és l'app nativa Capacitor (APK), on <a download> sobre un blob
     * NO descarrega res (el WebView no té DownloadListener).
     */
    _isNativePlatform() {
        try {
            const w = typeof window !== 'undefined' ? window : null;
            return !!(w && w.Capacitor && typeof w.Capacitor.isNativePlatform === 'function' && w.Capacitor.isNativePlatform());
        } catch (e) {
            return false;
        }
    }

    /**
     * Exporta i comparteix/descarrega el fitxer .sqlite.
     *
     * Retorna { success, method, fileName, needsBase64? }:
     *  - success=true NOMÉS si hi ha indicis raonables que l'usuari ha rebut el fitxer
     *    (menú de compartir obert, o descàrrega del navegador iniciada en web).
     *  - A l'APK sense plugins Share/Filesystem NO es fa creure que s'ha descarregat (A5):
     *    es retorna success=false + needsBase64=true perquè la UI ofereixi la còpia en text.
     */
    async downloadDatabaseFile() {
        await this.init();
        const binaryArray = this.db.export();
        const blob = new Blob([binaryArray], { type: 'application/x-sqlite3' });
        const today = this.formatDate(new Date());
        const fileName = `beta10_registres_${today}.sqlite`;
        const native = this._isNativePlatform();

        // 1. MÈTODE NATIU: plugins Capacitor Filesystem + Share (si estan instal·lats)
        if (native) {
            const plugins = (typeof window !== 'undefined' && window.Capacitor && window.Capacitor.Plugins) || {};
            if (plugins.Filesystem && plugins.Share) {
                try {
                    const data = await this.exportDatabaseAsBase64();
                    const written = await plugins.Filesystem.writeFile({ path: fileName, data, directory: 'CACHE' });
                    await plugins.Share.share({
                        title: fileName,
                        text: 'Còpia de seguretat SQLite Beta10',
                        url: written && written.uri,
                        dialogTitle: 'Desa la còpia de seguretat'
                    });
                    return { success: true, method: 'capacitor_share', fileName };
                } catch (nativeErr) {
                    const msg = String((nativeErr && nativeErr.message) || nativeErr).toLowerCase();
                    if (msg.includes('cancel')) {
                        return { success: true, method: 'cancelled_by_user', fileName };
                    }
                    console.warn('Share nadiu ha fallat:', nativeErr);
                }
            }
        }

        // 2. MÈTODE WEB SHARE API (navegadors mòbils i alguns WebView)
        const nav = typeof navigator !== 'undefined' ? navigator : null;
        if (nav && typeof nav.canShare === 'function' && typeof File !== 'undefined') {
            try {
                const file = new File([blob], fileName, { type: 'application/x-sqlite3' });
                if (nav.canShare({ files: [file] }) && typeof nav.share === 'function') {
                    await nav.share({
                        files: [file],
                        title: fileName,
                        text: 'Còpia de seguretat SQLite Beta10'
                    });
                    return { success: true, method: 'share', fileName };
                }
            } catch (shareErr) {
                if (shareErr && shareErr.name === 'AbortError') {
                    return { success: true, method: 'cancelled_by_user', fileName };
                }
                console.warn('Web Share no disponible, provant alternativa:', shareErr);
            }
        }

        // 3. A l'APK, la descàrrega per <a download> no funciona: no simular èxit.
        if (native) {
            return {
                success: false,
                method: 'native_download_unsupported',
                needsBase64: true,
                fileName,
                error: 'Aquest dispositiu no permet desar el fitxer directament. Usa la còpia en text (Base64).'
            };
        }

        // 4. NAVEGADOR WEB: descàrrega directa amb retard de revoke
        if (typeof URL !== 'undefined' && typeof document !== 'undefined') {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            a.target = '_blank';
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();

            // Marge de 60s per assegurar que el sistema no cancel·li el blob abans de baixar-lo
            setTimeout(() => {
                if (document.body && document.body.contains(a)) document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }, 60000);

            return { success: true, method: 'download_anchor', fileName };
        }

        return { success: true, method: 'bytes_exported', fileName };
    }

    /**
     * Exporta la base de dades a una cadena Base64 per a còpia ràpida en text
     */
    async exportDatabaseAsBase64() {
        await this.init();
        const binaryArray = this.db.export();
        if (typeof Buffer !== 'undefined') {
            return Buffer.from(binaryArray).toString('base64');
        }
        const bytes = new Uint8Array(binaryArray);
        let binary = '';
        const chunkSize = 8192;
        for (let i = 0; i < bytes.length; i += chunkSize) {
            const chunk = bytes.subarray(i, i + chunkSize);
            binary += String.fromCharCode.apply(null, chunk);
        }
        return btoa(binary);
    }

    /**
     * Importa i restaura la base de dades des d'una cadena Base64
     */
    async importDatabaseFromBase64(base64Str) {
        if (!base64Str || typeof base64Str !== 'string') {
            throw new Error("El text de la còpia és buit o no és vàlid.");
        }
        const cleanBase64 = base64Str.trim().replace(/^data:.*?;base64,/, '');
        if (typeof Buffer !== 'undefined') {
            const buf = Buffer.from(cleanBase64, 'base64');
            const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
            return await this.importDatabaseFile(ab);
        }
        const binary = atob(cleanBase64);
        const len = binary.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return await this.importDatabaseFile(bytes.buffer);
    }

    /**
     * Columnes obligatòries per considerar que un fitxer és una BD de Beta10 (A4).
     * remunerated_extra_hours NO és obligatòria: els backups antics no la tenen i es migra.
     */
    static get REQUIRED_COLUMNS() {
        return {
            jornadas: ['id', 'user', 'date', 'start_time', 'end_time', 'type', 'day_type', 'standard_hours', 'worked_hours', 'extra_hours', 'pause_minutes', 'observations'],
            pausas: ['id', 'user', 'date', 'type', 'start_time', 'end_time', 'duration_minutes'],
            fichajes: ['id', 'user', 'timestamp', 'action', 'point', 'observations', 'latitude', 'longitude']
        };
    }

    /**
     * Valida una instància candidata. Llança Error si no és vàlida.
     */
    _validateImportedDb(candidate) {
        const quick = candidate.exec('PRAGMA quick_check');
        const verdict = quick && quick[0] && quick[0].values[0] && quick[0].values[0][0];
        if (verdict !== 'ok') {
            throw new Error('El fitxer seleccionat està malmès o no és una base de dades SQLite vàlida.');
        }
        const tables = candidate.exec("SELECT name FROM sqlite_master WHERE type='table';");
        const names = (tables && tables[0]) ? tables[0].values.map(r => r[0]) : [];
        if (!names.includes('jornadas')) {
            throw new Error("El fitxer seleccionat no és una base de dades vàlida de Beta10.");
        }
        const required = Beta10Database.REQUIRED_COLUMNS;
        for (const table of Object.keys(required)) {
            if (!names.includes(table)) continue; // les taules que falten es creen després
            const cols = this._getColumns(table, candidate);
            const missing = required[table].filter(c => !cols.includes(c));
            if (missing.length > 0) {
                throw new Error(`El fitxer no és una còpia vàlida de Beta10: a la taula "${table}" falten les columnes ${missing.join(', ')}.`);
            }
        }
    }

    /**
     * Importa i restaura una base de dades SQLite des d'un ArrayBuffer (.sqlite).
     *
     * Ordre segur (A4): 1) obrir i validar el candidat (tancant-lo si falla), 2) guardar una
     * còpia de la BD actual per poder desfer, 3) activar el candidat + migrar + PERSISTIR,
     * 4) només aleshores tancar l'antiga. Si persistir falla es retorna a la BD anterior.
     */
    async importDatabaseFile(arrayBuffer) {
        await this.init();
        if (!arrayBuffer) throw new Error("No s'ha proporcionat cap fitxer vàlid.");

        const u8 = new Uint8Array(arrayBuffer);
        let importedDb = null;
        try {
            importedDb = new this.SQL.Database(u8);
            this._validateImportedDb(importedDb);
        } catch (validationErr) {
            try { if (importedDb) importedDb.close(); } catch (e) {}
            throw validationErr;
        }

        const previousDb = this.db;
        const previousBytes = previousDb ? previousDb.export() : null;
        try {
            if (previousBytes) {
                this._previousSnapshot = previousBytes;
                try {
                    await this._saveToIndexedDB(previousBytes, this.IDB_PRE_RESTORE_KEY);
                } catch (snapErr) {
                    console.warn('⚠️ No s\'ha pogut desar la còpia prèvia a IndexedDB (només en memòria):', snapErr);
                }
            }
            this.db = importedDb;
            this._createTables(); // Aplica migracions si en calen
            await this.persist();
        } catch (applyErr) {
            // Rollback: tornar a la BD anterior i descartar el candidat
            this.db = previousDb;
            try { importedDb.close(); } catch (e) {}
            throw applyErr;
        }

        try {
            if (previousDb) previousDb.close();
        } catch (e) {}
        console.log("✅ Base de dades SQLite restaurada i desada correctament a IndexedDB!");
        return true;
    }

    /**
     * Hi ha una còpia prèvia a l'última restauració que es pot recuperar?
     */
    async hasRestoreSnapshot() {
        if (this._previousSnapshot) return true;
        try {
            const bytes = await this._loadFromIndexedDB(this.IDB_PRE_RESTORE_KEY);
            return !!(bytes && bytes.length > 0);
        } catch (e) {
            return false;
        }
    }

    /**
     * Desfà l'última restauració tornant a la BD anterior.
     */
    async undoLastRestore() {
        await this.init();
        let bytes = this._previousSnapshot;
        if (!bytes) {
            bytes = await this._loadFromIndexedDB(this.IDB_PRE_RESTORE_KEY);
        }
        if (!bytes || bytes.length === 0) {
            throw new Error('No hi ha cap còpia prèvia per recuperar.');
        }
        const restored = new this.SQL.Database(new Uint8Array(bytes));
        const current = this.db;
        try {
            this.db = restored;
            this._createTables();
            await this.persist();
        } catch (err) {
            this.db = current;
            try { restored.close(); } catch (e) {}
            throw err;
        }
        try { if (current) current.close(); } catch (e) {}
        this._previousSnapshot = null;
        return true;
    }

    // ==========================================
    // UTILITATS
    // ==========================================

    formatDate(date) {
        const d = new Date(date);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }

    _formatQueryResults(execResult) {
        if (!execResult || execResult.length === 0) return [];
        const { columns, values } = execResult[0];
        return values.map(row => {
            const obj = {};
            columns.forEach((col, idx) => {
                obj[col] = row[idx];
            });
            return obj;
        });
    }
}

// Instància singleton global
if (typeof window !== 'undefined') {
    window.beta10DB = new Beta10Database();
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Beta10Database;
}
