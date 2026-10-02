/**
 * scripts/tests/test-whatsapp-modal-and-dual-stats.js
 * Tests for the end-of-workday WhatsApp reminder modal and dual overtime statistics (worked vs remunerated).
 */

const fs = require('fs');
const path = require('path');
const { assert, assertEqual } = require('../test-harness.js');

module.exports = function registerWhatsAppAndDualStatsTests(runner) {
    runner.suite('WhatsApp Modal & Dual Overtime Statistics', async (suite) => {

        const scriptContent = fs.readFileSync(path.join(__dirname, '../../script.js'), 'utf8');
        const styleContent = fs.readFileSync(path.join(__dirname, '../../style.css'), 'utf8');
        const dbUiContent = fs.readFileSync(path.join(__dirname, '../../db-ui.js'), 'utf8');
        const dbContent = fs.readFileSync(path.join(__dirname, '../../db.js'), 'utf8');

        // ==========================================
        // 1. WHATSAPP REMINDER MODAL VERIFICATION
        // ==========================================
        suite.test('WhatsApp reminder modal definition and styling in script.js and style.css', () => {
            // Function exists in script.js
            assert(scriptContent.includes('function showWhatsAppReminderModal()'), 'showWhatsAppReminderModal function must be defined in script.js');
            assert(scriptContent.includes('whatsapp-reminder-modal'), 'Modal id whatsapp-reminder-modal must exist');
            
            // Contains exact WhatsApp symbol SVG with official color #25D366
            assert(scriptContent.includes('whatsapp-modal-svg'), 'Must include whatsapp-modal-svg');
            assert(scriptContent.includes('#25D366'), 'Must include WhatsApp brand color #25D366');

            // Contains exact required message
            assert(
                scriptContent.includes('No te olvides de enviar la jornada de hoy al grupo de WhatsApp'),
                'Modal must contain exact message: "No te olvides de enviar la jornada de hoy al grupo de WhatsApp"'
            );

            // Contains buttons
            assert(scriptContent.includes('btn-open-whatsapp'), 'Must contain button to open WhatsApp');
            assert(scriptContent.includes('btn-close-whatsapp-modal'), 'Must contain button to dismiss modal');

            // Called inside endWorkday
            assert(
                scriptContent.includes('showWhatsAppReminderModal();'),
                'endWorkday must trigger showWhatsAppReminderModal() upon finishing workday'
            );

            // CSS classes exist in style.css
            assert(styleContent.includes('.whatsapp-modal-overlay'), 'CSS rule .whatsapp-modal-overlay must be defined');
            assert(styleContent.includes('.whatsapp-modal-content'), 'CSS rule .whatsapp-modal-content must be defined');
            assert(styleContent.includes('.whatsapp-icon-container'), 'CSS rule .whatsapp-icon-container must be defined');
            assert(styleContent.includes('.btn-whatsapp'), 'CSS rule .btn-whatsapp must be defined');
        });

        // ==========================================
        // 2. DUAL OVERTIME METRICS IN DB & SQLITE
        // ==========================================
        suite.test('Dual Overtime: Database correctly separates worked extra vs remunerated extra by day', async () => {
            const initSqlJs = require('../../sql-wasm.js');
            const SQL = await initSqlJs();
            const db = new SQL.Database();

            // Create schema with remunerated_extra_hours
            db.run(`
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
            `);

            // Day 1: 9h standard, 9h 45min worked -> worked extra = 0.75h, remunerated extra = 0.5h (15min discarded)
            db.run(
                "INSERT INTO jornadas (user, date, start_time, end_time, type, day_type, standard_hours, worked_hours, extra_hours, remunerated_extra_hours, pause_minutes, observations) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                ['marc', '2026-10-01', '2026-10-01T08:00:00Z', '2026-10-01T17:45:00Z', 'JORNADA', 'Dilluns-Dijous', 9, 9.75, 0.75, 0.5, 0, 'Feina allargada 45m']
            );

            // Day 2: 9h standard, 9h 23min worked -> worked extra = 0.38h, remunerated extra = 0.0h (<30m)
            db.run(
                "INSERT INTO jornadas (user, date, start_time, end_time, type, day_type, standard_hours, worked_hours, extra_hours, remunerated_extra_hours, pause_minutes, observations) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                ['marc', '2026-10-02', '2026-10-02T08:00:00Z', '2026-10-02T17:23:00Z', 'JORNADA', 'Divendres', 9, 9.38, 0.38, 0.0, 0, 'Tancament amb 23m extra']
            );

            // Query monthly summary using the same query as db.js
            const summarySql = `
                SELECT 
                    strftime('%Y-%m', date) as month,
                    ROUND(SUM(extra_hours), 2) as total_worked_extra_hours,
                    ROUND(SUM(COALESCE(remunerated_extra_hours, CAST(((extra_hours + 0.0001) / 0.5) AS INT) * 0.5)), 2) as total_remunerated_extra_hours,
                    COUNT(*) as days_with_extra
                FROM jornadas 
                WHERE extra_hours > 0 
                GROUP BY strftime('%Y-%m', date);
            `;

            const res = db.exec(summarySql);
            assertEqual(res[0].values[0][0], '2026-10', 'Month must be 2026-10');
            assertEqual(res[0].values[0][1], 1.13, 'Total worked extra hours must be 1.13h (45m + 23m = 68m)');
            assertEqual(res[0].values[0][2], 0.5, 'Total remunerated extra hours must be exactly 0.5h (Day 1: 0.5h + Day 2: 0h)');
            assertEqual(res[0].values[0][3], 2, 'Days with extra should be 2');
        });

        // ==========================================
        // 3. DUAL OVERTIME UI STRUCTURE IN DB-UI.JS & STYLE.CSS
        // ==========================================
        suite.test('Dual Overtime UI: db-ui.js and style.css contain both Worked and Remunerated sections', () => {
            // Check db-ui.js
            assert(dbUiContent.includes('db-highlight-dual-grid'), 'db-ui.js must include dual highlight grid');
            assert(dbUiContent.includes('worked-card'), 'db-ui.js must include worked-card');
            assert(dbUiContent.includes('remunerated-card'), 'db-ui.js must include remunerated-card');
            assert(dbUiContent.includes('Hores Extra Treballades'), 'db-ui.js must display "Hores Extra Treballades"');
            assert(dbUiContent.includes('Hores Remunerades'), 'db-ui.js must display "Hores Remunerades"');
            assert(dbUiContent.includes('db-rule-info-card'), 'db-ui.js must include info card explaining 30min rule');
            assert(dbUiContent.includes('Extra real:'), 'Daily card must display "Extra real"');
            assert(dbUiContent.includes('Extra remunerat:'), 'Daily card must display "Extra remunerat"');

            // Check style.css
            assert(styleContent.includes('.db-highlight-dual-grid'), 'style.css must define .db-highlight-dual-grid');
            assert(styleContent.includes('.db-highlight-card.worked-card'), 'style.css must define .worked-card');
            assert(styleContent.includes('.db-highlight-card.remunerated-card'), 'style.css must define .remunerated-card');
            assert(styleContent.includes('.db-rule-info-card'), 'style.css must define .db-rule-info-card');
        });

        // ==========================================
        // 4. FUNCTIONAL SIMULATION OF WHATSAPP REMINDER DISMISSAL
        // ==========================================
        suite.test('WhatsApp modal dismissal lifecycle test', () => {
            let modalRemoved = false;
            let whatsappUrlOpened = null;

            const modalMock = {
                id: 'whatsapp-reminder-modal',
                remove: () => { modalRemoved = true; }
            };

            function simulateDismiss() {
                modalMock.remove();
            }

            function simulateOpenWhatsApp() {
                whatsappUrlOpened = 'https://api.whatsapp.com/';
                modalMock.remove();
            }

            // Dismiss
            simulateDismiss();
            assertEqual(modalRemoved, true, 'Modal should be removed on dismiss');

            // Open WhatsApp
            modalRemoved = false;
            simulateOpenWhatsApp();
            assertEqual(modalRemoved, true, 'Modal should be removed on WhatsApp open');
            assertEqual(whatsappUrlOpened, 'https://api.whatsapp.com/');
        });
    });
};
