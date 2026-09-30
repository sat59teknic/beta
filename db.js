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
    }

    /**
     * Inicialitza la base de dades SQLite
     */
    async init() {
        if (this.initPromise) return this.initPromise;

        this.initPromise = (async () => {
            try {
                console.log('🔄 Inicialitzant SQLite (sql.js Wasm)...');

                // 1. Carregar el mòdul Wasm de sql.js
                if (typeof initSqlJs !== 'function') {
                    throw new Error('initSqlJs no està disponible. Assegura\'t de carregar sql-wasm.js abans.');
                }

                this.SQL = await initSqlJs({
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

                // 4. Desar estat inicial
                await this.persist();

                this.isInitialized = true;
                console.log('✅ Base de dades SQLite llesta i operativa!');
                return true;
            } catch (err) {
                console.error('❌ Error inicialitzant SQLite:', err);
                this.isInitialized = false;
                throw err;
            }
        })();

        return this.initPromise;
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
    }

    /**
     * Desa el contingut actual de SQLite a IndexedDB
     */
    async persist() {
        if (!this.db) return;
        try {
            const data = this.db.export();
            await this._saveToIndexedDB(data);
        } catch (err) {
            console.error('❌ Error persistint SQLite a IndexedDB:', err);
        }
    }

    /**
     * Obre connexió amb IndexedDB
     */
    _openIndexedDB() {
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
    async _saveToIndexedDB(bytes) {
        const idb = await this._openIndexedDB();
        return new Promise((resolve, reject) => {
            const tx = idb.transaction(this.IDB_STORE, 'readwrite');
            const store = tx.objectStore(this.IDB_STORE);
            const req = store.put(bytes, this.IDB_KEY);
            req.onsuccess = () => resolve(true);
            req.onerror = () => reject(req.error);
        });
    }

    /**
     * Carrega bytes des d'IndexedDB
     */
    async _loadFromIndexedDB() {
        const idb = await this._openIndexedDB();
        return new Promise((resolve, reject) => {
            const tx = idb.transaction(this.IDB_STORE, 'readonly');
            const store = tx.objectStore(this.IDB_STORE);
            const req = store.get(this.IDB_KEY);
            req.onsuccess = () => resolve(req.result ? new Uint8Array(req.result) : null);
            req.onerror = () => reject(req.error);
        });
    }

    // ==========================================
    // INSERCIÓ DE DADES
    // ==========================================

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
        await this.persist();
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
        const durMin = Math.round(durationMinutes * 10) / 10;

        const sql = `
            INSERT INTO pausas (user, date, type, start_time, end_time, duration_minutes)
            VALUES (?, ?, ?, ?, ?, ?);
        `;
        this.db.run(sql, [user, d, type, startIso, endIso, durMin]);
        await this.persist();
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
        pauseMinutes = 0,
        observations = ''
    }) {
        await this.init();
        const d = date || this.formatDate(startTime || new Date());
        const startIso = new Date(startTime).toISOString();
        const endIso = new Date(endTime).toISOString();
        const stdH = Number(standardHours) || 0;
        const wrkH = Math.round(Number(workedHours) * 100) / 100;
        const extH = Math.round(Number(extraHours) * 100) / 100;
        const pauM = Math.round(Number(pauseMinutes) * 10) / 10;

        const sql = `
            INSERT INTO jornadas (user, date, start_time, end_time, type, day_type, standard_hours, worked_hours, extra_hours, pause_minutes, observations)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
        `;
        this.db.run(sql, [user, d, startIso, endIso, type, dayType, stdH, wrkH, extH, pauM, observations || '']);
        await this.persist();
        console.log(`💾 SQLite: Jornada registrada (${d}: ${wrkH}h treballades, ${extH}h extra)`);
    }

    /**
     * Actualitza manualment una jornada existent (per a corregir anomalies com 191m de pausa)
     */
    async updateJornada(id, { worked_hours, extra_hours, pause_minutes, observations }) {
        await this.init();
        const sql = `
            UPDATE jornadas 
            SET worked_hours = ?, extra_hours = ?, pause_minutes = ?, observations = ?
            WHERE id = ?;
        `;
        this.db.run(sql, [
            Math.round(Number(worked_hours) * 100) / 100,
            Math.round(Number(extra_hours) * 100) / 100,
            Math.round(Number(pause_minutes) * 10) / 10,
            observations || '',
            id
        ]);
        await this.persist();
        console.log(`💾 SQLite: Jornada #${id} actualitzada`);
    }

    /**
     * Elimina una jornada per ID
     */
    async deleteJornada(id) {
        await this.init();
        this.db.run("DELETE FROM jornadas WHERE id = ?;", [id]);
        await this.persist();
        console.log(`💾 SQLite: Jornada #${id} eliminada`);
    }

    /**
     * Elimina una pausa per ID
     */
    async deletePausa(id) {
        await this.init();
        this.db.run("DELETE FROM pausas WHERE id = ?;", [id]);
        await this.persist();
        console.log(`💾 SQLite: Pausa #${id} eliminada`);
    }

    // ==========================================
    // CONSULTES PER A LA UI
    // ==========================================

    /**
     * Retorna el resum d'hores extra agrupades per mes
     */
    async getMonthlyOvertimeSummary() {
        await this.init();
        const sql = `
            SELECT 
                strftime('%Y-%m', date) as month,
                ROUND(SUM(extra_hours), 2) as total_extra_hours,
                COUNT(*) as days_with_extra
            FROM jornadas 
            WHERE extra_hours > 0 
            GROUP BY strftime('%Y-%m', date) 
            ORDER BY month DESC;
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
        const stmt = this.db.prepare(sql);
        stmt.bind([yearMonth]);
        const rows = [];
        while (stmt.step()) {
            rows.push(stmt.getAsObject());
        }
        stmt.free();
        return rows;
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
        const stmt = this.db.prepare(sql);
        stmt.bind([yearMonth]);
        const rows = [];
        while (stmt.step()) {
            rows.push(stmt.getAsObject());
        }
        stmt.free();
        return rows;
    }

    /**
     * Retorna el resum de pauses diàries (desglossat per esmorzar, dinar i total)
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
        const stmt = this.db.prepare(sql);
        stmt.bind([limit]);
        const rows = [];
        while (stmt.step()) {
            rows.push(stmt.getAsObject());
        }
        stmt.free();
        return rows;
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
        const stmt = this.db.prepare(sql);
        stmt.bind([dateStr]);
        const rows = [];
        while (stmt.step()) {
            rows.push(stmt.getAsObject());
        }
        stmt.free();
        return rows;
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
        const stmt = this.db.prepare(sql);
        stmt.bind([limit]);
        const rows = [];
        while (stmt.step()) {
            rows.push(stmt.getAsObject());
        }
        stmt.free();
        return rows;
    }

    /**
     * Estadístiques generals de la base de dades
     */
    async getDatabaseStats() {
        await this.init();
        const countJ = this.db.exec("SELECT COUNT(*) as c FROM jornadas")[0]?.values[0][0] || 0;
        const countP = this.db.exec("SELECT COUNT(*) as c FROM pausas")[0]?.values[0][0] || 0;
        const countF = this.db.exec("SELECT COUNT(*) as c FROM fichajes")[0]?.values[0][0] || 0;
        const bytes = this.db.export();
        return {
            jornadasCount: countJ,
            pausasCount: countP,
            fichajesCount: countF,
            sizeKb: Math.round(bytes.length / 1024)
        };
    }

    /**
     * Exporta i descarrega el fitxer .sqlite al dispositiu de l'usuari
     */
    async downloadDatabaseFile() {
        await this.init();
        const binaryArray = this.db.export();
        const blob = new Blob([binaryArray], { type: 'application/x-sqlite3' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const today = this.formatDate(new Date());
        a.download = `beta10_registres_${today}.sqlite`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
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
window.beta10DB = new Beta10Database();
