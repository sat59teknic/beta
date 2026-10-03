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
        if (this.isInitialized && this.db) return true;
        if (this.initPromise) return this.initPromise;

        this.initPromise = (async () => {
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

        // Migració per afegir remunerated_extra_hours si s'utilitza una base de dades existent
        try {
            this.db.run("ALTER TABLE jornadas ADD COLUMN remunerated_extra_hours REAL DEFAULT 0;");
        } catch (e) {
            // La columna ja existeix
        }
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
    async _saveToIndexedDB(bytes) {
        if (typeof indexedDB === 'undefined') return true;
        const idb = await this._openIndexedDB();
        if (!idb) return true;
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
        if (typeof indexedDB === 'undefined') return null;
        const idb = await this._openIndexedDB();
        if (!idb) return null;
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
        remuneratedExtraHours = null,
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
        const remExtH = remuneratedExtraHours !== null && remuneratedExtraHours !== undefined
            ? Math.round(Number(remuneratedExtraHours) * 100) / 100
            : Math.floor((extH + 0.0001) / 0.5) * 0.5;
        const pauM = Math.round(Number(pauseMinutes) * 10) / 10;

        const sql = `
            INSERT INTO jornadas (user, date, start_time, end_time, type, day_type, standard_hours, worked_hours, extra_hours, remunerated_extra_hours, pause_minutes, observations)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
        `;
        this.db.run(sql, [user, d, startIso, endIso, type, dayType, stdH, wrkH, extH, remExtH, pauM, observations || '']);
        await this.persist();
        console.log(`💾 SQLite: Jornada registrada (${d}: ${wrkH}h treballades, ${extH}h extra real, ${remExtH}h extra remunerades)`);
    }

    /**
     * Actualitza manualment una jornada existent (per a corregir anomalies com 191m de pausa)
     */
    async updateJornada(id, { worked_hours, extra_hours, remunerated_extra_hours, pause_minutes, observations }) {
        await this.init();
        const extH = Math.round(Number(extra_hours) * 100) / 100;
        const remH = remunerated_extra_hours !== undefined && remunerated_extra_hours !== null
            ? Math.round(Number(remunerated_extra_hours) * 100) / 100
            : Math.floor((extH + 0.0001) / 0.5) * 0.5;

        const sql = `
            UPDATE jornadas 
            SET worked_hours = ?, extra_hours = ?, remunerated_extra_hours = ?, pause_minutes = ?, observations = ?
            WHERE id = ?;
        `;
        this.db.run(sql, [
            Math.round(Number(worked_hours) * 100) / 100,
            extH,
            remH,
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
     * Diferencia entre hores extra treballades (totals reals) i hores extra remunerades (blocs de 30 min per dia)
     */
    async getMonthlyOvertimeSummary() {
        await this.init();
        const sql = `
            SELECT 
                strftime('%Y-%m', date) as month,
                ROUND(SUM(extra_hours), 2) as total_worked_extra_hours,
                ROUND(SUM(COALESCE(remunerated_extra_hours, CAST(((extra_hours + 0.0001) / 0.5) AS INT) * 0.5)), 2) as total_remunerated_extra_hours,
                ROUND(SUM(extra_hours), 2) as total_extra_hours,
                ROUND(SUM(worked_hours), 2) as total_worked_hours,
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
     * Suporta Web Share API a Android per obrir el menú natiu de desar o compartir
     */
    async downloadDatabaseFile() {
        await this.init();
        const binaryArray = this.db.export();
        const blob = new Blob([binaryArray], { type: 'application/x-sqlite3' });
        const today = this.formatDate(new Date());
        const fileName = `beta10_registres_${today}.sqlite`;

        // 1. MÈTODE 1: Android WebView / Mòbil (Web Share API)
        // A Android WebView aquest mètode permet desar directament a Descàrregues / Drive / WhatsApp
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
                if (shareErr.name === 'AbortError') {
                    return { success: true, method: 'cancelled_by_user', fileName };
                }
                console.warn('Web Share no disponible, provant descàrrega directa:', shareErr);
            }
        }

        // 2. MÈTODE 2: Descàrrega directa amb retard de revoke (evita cancel·lació a WebView)
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
     * Importa i restaura una base de dades SQLite des d'un ArrayBuffer (.sqlite)
     */
    async importDatabaseFile(arrayBuffer) {
        await this.init();
        if (!arrayBuffer) throw new Error("No s'ha proporcionat cap fitxer vàlid.");

        const u8 = new Uint8Array(arrayBuffer);
        const importedDb = new this.SQL.Database(u8);

        // Validar que tingui la taula 'jornadas'
        const check = importedDb.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='jornadas';");
        if (!check || check.length === 0 || check[0].values.length === 0) {
            throw new Error("El fitxer seleccionat no és una base de dades vàlida de Beta10.");
        }

        try {
            if (this.db) this.db.close();
        } catch (e) {}

        this.db = importedDb;
        this._createTables(); // Aplica migracions si en calen
        await this.persist();
        console.log("✅ Base de dades SQLite restaurada i desada correctament a IndexedDB!");
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
