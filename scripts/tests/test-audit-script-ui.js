/**
 * scripts/tests/test-audit-script-ui.js
 * Tests de la auditoria sobre script.js y db-ui.js ejecutando el CODIGO REAL (vm + DOM falso,
 * ver scripts/test-fake-app.js). Nada se reimplementa en el test.
 *
 * Los antiguos tests "[BUG]" reproducian defectos confirmados de la auditoria; ya estan corregidos
 * en el codigo de produccion y el prefijo se ha retirado (sin modificar los tests).
 *
 * Cero red real: fetch simulado (solo /api/health y /api/beta10, ambos en memoria).
 */

const fs = require('fs');
const path = require('path');
const initSqlJs = require('../../sql-wasm.js');
const Beta10Database = require('../../db.js');
const { assert, assertEqual } = require('../test-harness.js');
const {
    createClock, createMemoryStorage, loadScriptApp, loadDbUi, flush
} = require('../test-fake-app.js');

const H = 3600 * 1000;
const M = 60 * 1000;

const baseState = (over = {}) => ({
    currentState: 'FUERA', workStartTime: null, currentPauseStart: null, currentPauseType: null,
    totalPauseTimeToday: 0, currentLocation: null, isAlarmPlaying: false, pauseAlarmTriggered: false,
    lastAlarmTime: null, alarmSource: null, wakeLock: null, wakeLockLost: false,
    workDayStandard: null, workDayType: null, workStartDay: null, breakfastDate: null, ...over
});

module.exports = function registerAuditScriptUiTests(runner) {
    // ======================================================================
    // script.js REAL
    // ======================================================================
    runner.suite('Auditoria script.js (codigo real en vm): horas extra, estado, persistencia y alarmas', async (suite) => {

        // ----------------------------------------------------------------- horarios
        suite.test('getStandardWorkDay/getDayTypeName reales: L-J 9h, V 8h, S/D 0h (tot extra)', async () => {
            const app = await loadScriptApp();
            const { t } = app;
            const day = (d) => new Date(2026, 9, d, 10, 0); // 5 oct 2026 = lunes
            assertEqual(t.getStandardWorkDay(day(5)), 9, 'lunes');
            assertEqual(t.getStandardWorkDay(day(8)), 9, 'jueves');
            assertEqual(t.getStandardWorkDay(day(9)), 8, 'viernes');
            assertEqual(t.getStandardWorkDay(day(10)), 0, 'sabado');
            assertEqual(t.getStandardWorkDay(day(11)), 0, 'domingo');
            assertEqual(t.getDayTypeName(day(9)), 'Divendres');
            assertEqual(t.getDayTypeName(day(10)), 'Dissabte');
            assertEqual(t.getDayTypeName(day(11)), 'Diumenge');
        });

        // ----------------------------------------------------------------- M2
        suite.test('M2 calculateExtraHours en PAUSA no debe duplicar la pausa en curso (10h de jornada -> totalHours 10, no 11)', async () => {
            const app = await loadScriptApp();
            const now = app.clock.now;
            app.t.setState(baseState({
                currentState: 'PAUSA',
                workStartTime: new Date(now - 10 * H),
                currentPauseStart: new Date(now - 1 * H),
                currentPauseType: 'dinar',
                totalPauseTimeToday: 0,
                workDayStandard: 9
            }));
            const r = app.t.calculateExtraHours();
            assertEqual(r.totalHours, 10, 'el tiempo transcurrido desde el inicio es 10h');
            assertEqual(r.remuneratedExtraHours, 1, '1h extra real = 1h remunerada');
        });

        suite.test('M2 con pausas previas (30 min) + pausa en curso (15 min) la jornada total sigue siendo el tiempo transcurrido', async () => {
            const app = await loadScriptApp();
            const now = app.clock.now;
            app.t.setState(baseState({
                currentState: 'PAUSA',
                workStartTime: new Date(now - 10 * H),
                currentPauseStart: new Date(now - 15 * M),
                currentPauseType: 'esmorçar',
                totalPauseTimeToday: 30 * M,
                workDayStandard: 9
            }));
            assertEqual(app.t.calculateExtraHours().totalHours, 10);
        });

        suite.test('M2 control: en JORNADA totalHours = tiempo transcurrido (la pausa ya cerrada esta incluida en la jornada)', async () => {
            const app = await loadScriptApp();
            const now = app.clock.now;
            app.t.setState(baseState({
                currentState: 'JORNADA',
                workStartTime: new Date(now - 10 * H),
                totalPauseTimeToday: 30 * M,
                workDayStandard: 9
            }));
            const r = app.t.calculateExtraHours();
            assertEqual(r.totalHours, 10);
            assertEqual(r.extraHours, 1);
            assertEqual(r.extraBlocks, 2);
        });

        suite.test('calculateExtraHours: sin inicio de jornada devuelve ceros con estandar 9', async () => {
            const app = await loadScriptApp();
            const r = app.t.calculateExtraHours();
            assertEqual(r.totalHours, 0);
            assertEqual(r.remuneratedExtraHours, 0);
            assertEqual(r.extraBlocks, 0);
            assertEqual(r.standardWorkDay, 9);
        });

        suite.test('Bordes de remunerada en calculateExtraHours real: 29m->0, 30m->0.5, 59m->0.5, 60m->1.0 (estandar 9h)', async () => {
            const app = await loadScriptApp();
            const now = app.clock.now;
            const cases = [[29, 0], [29.99, 0], [30, 0.5], [45, 0.5], [59, 0.5], [60, 1.0], [89, 1.0], [90, 1.5]];
            for (const [extraMin, expected] of cases) {
                app.t.setState(baseState({
                    currentState: 'JORNADA',
                    workStartTime: new Date(now - (9 * H + extraMin * M)),
                    workDayStandard: 9
                }));
                assertEqual(app.t.calculateExtraHours().remuneratedExtraHours, expected, `${extraMin} min extra`);
            }
        });

        suite.test('calculateExtraHours en fin de semana (estandar 0): todo es extra; 20 min -> 0h, 30 min -> 0.5h', async () => {
            const app = await loadScriptApp();
            const now = app.clock.now;
            const run = (min) => {
                app.t.setState(baseState({ currentState: 'JORNADA', workStartTime: new Date(now - min * M), workDayStandard: 0 }));
                return app.t.calculateExtraHours();
            };
            assertEqual(run(20).remuneratedExtraHours, 0);
            assertEqual(run(30).remuneratedExtraHours, 0.5);
            assertEqual(run(120).extraHours, 2);
        });

        // ----------------------------------------------------------------- M7
        suite.test('M7 validateAppState: el reset por "jornada sin inicio" debe poner totalPauseTimeToday a 0', async () => {
            const app = await loadScriptApp();
            app.t.setState(baseState({ currentState: 'JORNADA', workStartTime: null, totalPauseTimeToday: 10 * M, workDayStandard: 9, workDayType: 'Dilluns-Dijous' }));
            const fixed = app.t.validateAppState();
            assertEqual(fixed, true, 'debe detectar la inconsistencia');
            const s = app.t.getState();
            assertEqual(s.currentState, 'FUERA');
            assertEqual(s.totalPauseTimeToday, 0, 'la pausa acumulada de la sesion perdida contaminaria la siguiente jornada');
        });

        suite.test('M7 updateUI: el reset de emergencia por estado invalido debe limpiar totalPauseTimeToday y el horario del dia', async () => {
            const app = await loadScriptApp();
            const now = app.clock.now;
            app.t.setState(baseState({
                currentState: 'XYZ-CORRUPTO', workStartTime: new Date(now - 2 * H), totalPauseTimeToday: 25 * M,
                workDayStandard: 9, workDayType: 'Dilluns-Dijous', workStartDay: 1
            }));
            app.t.updateUI();
            const s = app.t.getState();
            assertEqual(s.currentState, 'FUERA');
            assertEqual(s.totalPauseTimeToday, 0, 'totalPauseTimeToday');
            assertEqual(s.workDayStandard, null, 'workDayStandard');
        });

        // M6 (cambio justificado): antes la pausa de >1h se cerraba contando solo el maximo previsto (15 min)
        // y la pausa REAL desaparecia (no quedaba nada en la tabla pausas). Ahora el estado/horas siguen
        // limitados a 15 min (para no falsear las horas trabajadas con una pausa olvidada) pero la pausa
        // real se registra en SQLite con su duracion real. Se mantienen las aserciones originales.
        suite.test('M7 control: validateAppState corrige PAUSA sin inicio (-> JORNADA) y pausa >1h (cierra a 15 min de esmorzar y registra la pausa real)', async () => {
            const pausas = [];
            const app = await loadScriptApp({
                beta10DB: { init: async () => true, recordJornada: async () => {}, recordFichaje: async () => {}, recordPausa: async (a) => { pausas.push(a); } }
            });
            const now = app.clock.now;
            app.t.setState(baseState({ currentState: 'PAUSA', workStartTime: new Date(now - 3 * H), currentPauseStart: null, currentPauseType: 'dinar' }));
            assertEqual(app.t.validateAppState(), true);
            assertEqual(app.t.getState().currentState, 'JORNADA');
            assertEqual(pausas.length, 0, 'una pausa sin inicio no tiene datos que registrar');

            app.t.setState(baseState({
                currentState: 'PAUSA', workStartTime: new Date(now - 5 * H), currentPauseStart: new Date(now - 2 * H),
                currentPauseType: 'esmorçar', totalPauseTimeToday: 0
            }));
            assertEqual(app.t.validateAppState(), true);
            const s = app.t.getState();
            assertEqual(s.currentState, 'JORNADA');
            assertEqual(s.totalPauseTimeToday, 15 * M, 'se limita al maximo previsto del esmorzar');
            assertEqual(app.t.validateAppState(), false, 'estado ya coherente: sin cambios');

            await flush(10);
            assertEqual(pausas.length, 1, 'M6: la pausa real se registra en la tabla pausas');
            assertEqual(pausas[0].type, 'esmorçar');
            assertEqual(pausas[0].durationMinutes, 120, 'duracion REAL (2h), no la limitada');
            assertEqual(new Date(pausas[0].startTime).getTime(), now - 2 * H);
            assertEqual(new Date(pausas[0].endTime).getTime(), now);
            assertEqual(pausas[0].date, '2026-10-05');
        });

        // ----------------------------------------------------------------- M14
        suite.test('M14 loadState con JSON corrupto en localStorage no debe lanzar (la app debe arrancar en FUERA)', async () => {
            const app = await loadScriptApp();
            for (const corrupt of ['{"currentState":"JORNADA","workStart', 'null', '[1,2', 'undefined']) {
                app.storage.setItem('beta10AppState', corrupt);
                let err = null;
                try { app.t.loadState(); } catch (e) { err = e; }
                assert(!err, `loadState lanzo con "${corrupt}": ${err && err.message}`);
            }
        });

        suite.test('M14 arranque completo de la app con estado guardado corrupto: init() no debe rechazarse', async () => {
            const storage = createMemoryStorage();
            storage.setItem('beta10AppState', '{corrupto');
            let err = null;
            try { await loadScriptApp({ storage }); } catch (e) { err = e; }
            assert(!err, 'la app no arranca (init rechazado): ' + (err && err.message));
        });

        suite.test('M14 control: timestamps invalidos en el estado guardado se descartan y se registran', async () => {
            const storage = createMemoryStorage();
            storage.setItem('beta10AppState', JSON.stringify({
                currentState: 'JORNADA', workStartTime: 'no-es-fecha', currentPauseStart: null, totalPauseTimeToday: 0
            }));
            const app = await loadScriptApp({ storage });
            // validateAppState: JORNADA sin inicio -> FUERA
            assertEqual(app.t.getState().currentState, 'FUERA');
            assert(app.logTexts().some(t => t.includes('inicio de jornada inv')), 'se registra el timestamp invalido');
        });

        suite.test('M14 saveState no debe persistir campos transitorios (isAlarmPlaying, wakeLock, wakeLockLost, alarmSource)', async () => {
            const app = await loadScriptApp();
            app.t.setState(baseState({
                currentState: 'PAUSA', workStartTime: new Date(app.clock.now - 2 * H), currentPauseStart: new Date(app.clock.now - 20 * M),
                currentPauseType: 'dinar', isAlarmPlaying: true, alarmSource: 'native-notification',
                wakeLock: { released: false, type: 'screen' }, wakeLockLost: true
            }));
            app.t.saveState();
            const saved = JSON.parse(app.storage.getItem('beta10AppState'));
            assert(!saved.isAlarmPlaying, 'isAlarmPlaying persistido = ' + saved.isAlarmPlaying);
            assert(!saved.wakeLock, 'wakeLock persistido = ' + JSON.stringify(saved.wakeLock));
            assert(!saved.wakeLockLost, 'wakeLockLost persistido = ' + saved.wakeLockLost);
            assert(!saved.alarmSource, 'alarmSource persistido = ' + saved.alarmSource);
        });

        suite.test('M14 tras reabrir la app con isAlarmPlaying=true persistido, la alarma de pausa debe poder sonar', async () => {
            const clock = createClock();
            const storage = createMemoryStorage();
            storage.setItem('beta10AppState', JSON.stringify(baseState({
                currentState: 'PAUSA', workStartTime: new Date(clock.now - 2 * H), currentPauseStart: new Date(clock.now - 10 * M),
                currentPauseType: 'dinar', isAlarmPlaying: true
            })));
            const app = await loadScriptApp({ storage, clock });
            app.t.playPauseAlarm('dinar', 'native-notification');
            assertEqual(app.el('alarm-banner').style.display, 'flex', 'el banner de alarma debe mostrarse; la alarma se ignora por un isAlarmPlaying obsoleto');
        });

        suite.test('M14 control: con isAlarmPlaying=false guardado, la alarma de pausa si suena al reabrir (banner visible)', async () => {
            const clock = createClock();
            const storage = createMemoryStorage();
            storage.setItem('beta10AppState', JSON.stringify(baseState({
                currentState: 'PAUSA', workStartTime: new Date(clock.now - 2 * H), currentPauseStart: new Date(clock.now - 10 * M),
                currentPauseType: 'dinar', isAlarmPlaying: false
            })));
            const app = await loadScriptApp({ storage, clock });
            app.t.playPauseAlarm('dinar', 'native-notification');
            assertEqual(app.el('alarm-banner').style.display, 'flex');
            assertEqual(app.t.getState().isAlarmPlaying, true);
        });

        suite.test('M14 control: saveState/loadState conservan los campos de negocio (fechas como Date)', async () => {
            const app = await loadScriptApp();
            const start = new Date(app.clock.now - 3 * H);
            app.t.setState(baseState({
                currentState: 'JORNADA', workStartTime: start, totalPauseTimeToday: 15 * M, workDayStandard: 9,
                workDayType: 'Dilluns-Dijous', workStartDay: 1, breakfastDate: '2026-10-05'
            }));
            app.t.saveState();
            app.t.setState(baseState());
            app.t.loadState();
            const s = app.t.getState();
            assertEqual(s.currentState, 'JORNADA');
            assertEqual(s.workStartTime.getTime(), start.getTime());
            assertEqual(s.totalPauseTimeToday, 15 * M);
            assertEqual(s.breakfastDate, '2026-10-05');
            assertEqual(s.workDayType, 'Dilluns-Dijous');
        });

        // ----------------------------------------------------------------- L3
        async function openEndWorkdayModal(app, elapsedMs, withObs) {
            const now = app.clock.now;
            app.t.setState(baseState({
                currentState: 'JORNADA', workStartTime: new Date(now - elapsedMs), workDayStandard: 9, workDayType: 'Dilluns-Dijous'
            }));
            const pending = app.t.endWorkday(withObs);
            const modal = app.fake.document.body.lastChild;
            assert(modal, 'se esperaba un modal abierto');
            const html = modal.innerHTML;
            app.el('modal-cancel-btn').onclick();
            await pending;
            return html;
        }

        suite.test('L3 modal de salida con 8h 59m 45s no debe mostrar "8h 60min"', async () => {
            const app = await loadScriptApp();
            const html = await openEndWorkdayModal(app, 8 * H + 59 * M + 45 * 1000, true);
            assert(!html.includes('60min'), 'subtitulo con minutos = 60: ' + (html.match(/\(([^)]*totals)\)/) || [])[1]);
        });

        suite.test('L3 modal de horas extra con 9h 59m 45s no debe mostrar "9h 60min"', async () => {
            const app = await loadScriptApp();
            const html = await openEndWorkdayModal(app, 9 * H + 59 * M + 45 * 1000, false);
            assert(html.includes('HORES EXTRA'), 'precondicion: debe abrirse el modal de horas extra');
            assert(!html.includes('60min'), 'Total Treballat con minutos = 60');
        });

        suite.test('L3 control: formato normal "8h 30min" en el modal de salida', async () => {
            const app = await loadScriptApp();
            const html = await openEndWorkdayModal(app, 8 * H + 30 * M, true);
            assert(html.includes('8h 30min'), 'esperado 8h 30min');
        });

        // ----------------------------------------------------------------- A3 (script.js)
        suite.test('A3 si recordJornada falla al finalizar, el usuario debe enterarse o la jornada quedar en cola (hoy solo console.warn)', async () => {
            let attempts = 0;
            const app = await loadScriptApp({
                beta10DB: {
                    init: async () => true,
                    recordFichaje: async () => {},
                    recordPausa: async () => {},
                    recordJornada: async () => { attempts++; throw new Error('QuotaExceededError'); }
                }
            });
            app.t.setState(baseState({
                currentState: 'JORNADA', workStartTime: new Date(app.clock.now - 8 * H), workDayStandard: 9, workDayType: 'Dilluns-Dijous'
            }));
            await app.t.endWorkday(false);
            await flush(20);
            assertEqual(attempts, 1, 'se intento registrar la jornada');
            assertEqual(app.t.getState().currentState, 'FUERA', 'la jornada se cierra igualmente');
            assertEqual(app.t.getState().workStartTime, null, 'los datos de la jornada ya se han descartado del estado');

            const logs = app.logTexts().join('\n');
            const loggedFailure = /(sqlite|base de dades|jornada)[^\n]*(error|no s'ha|fall|perd)/i.test(logs) || /(error|fall)[^\n]*(sqlite|jornada)/i.test(logs);
            const queued = Object.keys(app.storage._store).some(k => /pending|queue|cua/i.test(k) && k !== 'beta10_pending_sync' && app.storage.getItem(k));
            const pendingSync = app.storage.getItem('beta10_pending_sync');
            const queuedInSync = !!pendingSync && /jornada/i.test(pendingSync);
            assert(app.alerts.length > 0 || loggedFailure || queued || queuedInSync,
                'fallo de SQLite silenciado: sin alerta, sin log visible y sin cola de reintento; la jornada se pierde');
        });

        suite.test('A3 control: recordJornada recibe usuario, dia local, horas trabajadas, pausa y extra remunerada correctos (sin extra)', async () => {
            const calls = [];
            const app = await loadScriptApp({
                beta10DB: { init: async () => true, recordFichaje: async () => {}, recordPausa: async () => {}, recordJornada: async (a) => { calls.push(a); } }
            });
            const now = app.clock.now;
            app.t.setState(baseState({
                currentState: 'JORNADA', workStartTime: new Date(now - 8 * H), totalPauseTimeToday: 30 * M, workDayStandard: 9, workDayType: 'Dilluns-Dijous'
            }));
            await app.t.endWorkday(false);
            await flush(20);
            assertEqual(calls.length, 1);
            const c = calls[0];
            assertEqual(c.user, 'tester');
            assertEqual(c.date, '2026-10-05');
            assertEqual(c.workedHours, 7.5, '8h - 30m de pausa');
            assertEqual(c.pauseMinutes, 30);
            assertEqual(c.extraHours, 0);
            assertEqual(c.remuneratedExtraHours, 0);
            assertEqual(c.type, 'JORNADA');
            assertEqual(app.t.getState().totalPauseTimeToday, 0);
        });

        suite.test('A3 control: jornada con horas extra exige comentario y registra extra real y remunerada', async () => {
            const calls = [];
            const app = await loadScriptApp({
                beta10DB: { init: async () => true, recordFichaje: async () => {}, recordPausa: async () => {}, recordJornada: async (a) => { calls.push(a); } }
            });
            const now = app.clock.now;
            app.t.setState(baseState({
                currentState: 'JORNADA', workStartTime: new Date(now - (10 * H + 20 * M)), workDayStandard: 9, workDayType: 'Dilluns-Dijous'
            }));
            const p = app.t.endWorkday(false);
            // Sin comentario no deja confirmar
            app.el('observations-input').value = '   ';
            app.el('modal-confirm-btn').onclick();
            assertEqual(app.alerts.length, 1, 'alerta de comentario obligatorio');
            assertEqual(calls.length, 0);
            app.el('observations-input').value = 'Feina client XYZ';
            app.el('modal-confirm-btn').onclick();
            await p;
            await flush(20);
            assertEqual(calls.length, 1);
            assertEqual(calls[0].observations, 'Feina client XYZ');
            assertEqual(Math.round(calls[0].extraHours * 100) / 100, 1.33);
            assertEqual(calls[0].remuneratedExtraHours, 1.0);
        });

        // ----------------------------------------------------------------- flujo completo
        suite.test('Flujo real FUERA -> JORNADA -> PAUSA(dinar) -> JORNADA -> FUERA: fichajes, pausa y jornada registrados', async () => {
            const jornadas = [];
            const pausas = [];
            const app = await loadScriptApp({
                beta10DB: {
                    init: async () => true,
                    recordFichaje: async () => {},
                    recordPausa: async (a) => { pausas.push(a); },
                    recordJornada: async (a) => { jornadas.push(a); }
                }
            });
            const { t, clock } = app;
            assertEqual(t.getState().currentState, 'FUERA');

            await t.startWorkday(false);
            await flush();
            assertEqual(t.getState().currentState, 'JORNADA');
            assertEqual(t.getState().workDayStandard, 9);

            clock.advance(1 * H);
            await t.startPause('dinar');
            await flush();
            assertEqual(t.getState().currentState, 'PAUSA');
            assertEqual(t.getState().currentPauseType, 'dinar');

            clock.advance(30 * M);
            await t.endPause();
            await flush(20);
            assertEqual(t.getState().currentState, 'JORNADA');
            assertEqual(t.getState().totalPauseTimeToday, 30 * M);
            assertEqual(pausas.length, 1);
            assertEqual(pausas[0].type, 'dinar');
            assertEqual(pausas[0].durationMinutes, 30);

            clock.advance(1 * H);
            await t.endWorkday(false);
            await flush(20);
            assertEqual(t.getState().currentState, 'FUERA');
            assertEqual(jornadas.length, 1);
            assertEqual(jornadas[0].workedHours, 2, '2.5h transcurridas - 0.5h de pausa');
            assertEqual(jornadas[0].pauseMinutes, 30);

            const actions = app.fetchCalls.map(c => `${c.action}:${c.point}`);
            assertEqual(actions.join(','), 'entrada:J,salida:J,entrada:P,salida:P,entrada:J,salida:J');
        });

        suite.test('updateTimers real en PAUSA: trabajo excluye la pausa en curso; total = trabajo + pausa', async () => {
            const app = await loadScriptApp();
            const now = app.clock.now;
            app.t.setState(baseState({
                currentState: 'PAUSA', workStartTime: new Date(now - 2 * H), currentPauseStart: new Date(now - 30 * M), currentPauseType: 'dinar', workDayStandard: 9
            }));
            app.t.updateTimers();
            assertEqual(app.el('work-timer').textContent, '01:30:00');
            assertEqual(app.el('pause-timer').textContent, '00:30:00');
            assertEqual(app.el('total-timer').textContent, '02:00:00');
        });
    });

    // ======================================================================
    // db-ui.js REAL
    // ======================================================================
    runner.suite('Auditoria db-ui.js (codigo real en vm): escape HTML y fecha por defecto', async (suite) => {
        const wasmBinary = fs.readFileSync(path.join(__dirname, '../../sql-wasm.wasm'));
        const SQL = await initSqlJs({ wasmBinary });

        function newRealDb() {
            const b = new Beta10Database();
            b.SQL = SQL;
            b.db = new SQL.Database();
            b.isInitialized = true;
            b._createTables();
            return b;
        }

        async function quiet(fn) {
            const saved = { log: console.log, warn: console.warn, error: console.error };
            console.log = console.warn = console.error = () => {};
            try { return await fn(); } finally { Object.assign(console, saved); }
        }

        const PAYLOAD = '<img src=x onerror=alert(document.cookie)>';

        async function seedWithObservation(obs) {
            const db = newRealDb();
            await quiet(() => db.recordJornada({
                date: '2026-09-28', startTime: new Date(2026, 8, 28, 8), endTime: new Date(2026, 8, 28, 19),
                workedHours: 10, extraHours: 1, observations: obs
            }));
            return db;
        }

        suite.test('M11 pestana Jornades: observations con HTML se debe escapar (XSS)', async () => {
            const db = await seedWithObservation(PAYLOAD);
            const { ui, fake } = loadDbUi({ beta10DB: db });
            const container = new fake.FakeEl('div');
            await ui.renderJornadasTab(container);
            assert(container.innerHTML.includes('db-comment-text'), 'precondicion: se pinta el comentario');
            assert(!container.innerHTML.includes('<img src=x'), 'las observaciones se inyectan sin escapar en innerHTML');
        });

        suite.test('M11 pestana Hores Extra: observations con HTML se debe escapar (XSS)', async () => {
            const db = await seedWithObservation(PAYLOAD);
            const { ui, fake } = loadDbUi({ beta10DB: db });
            const container = new fake.FakeEl('div');
            await ui.renderOvertimeTab(container);
            assert(container.innerHTML.includes('db-comment-text'), 'precondicion: se pinta el comentario');
            assert(!container.innerHTML.includes('<img src=x'), 'las observaciones se inyectan sin escapar en innerHTML');
        });

        suite.test('M11 un comentario con </div><script> no debe romper el marcado de la tarjeta', async () => {
            const db = await seedWithObservation('</span></div><script>alert(1)</script>');
            const { ui, fake } = loadDbUi({ beta10DB: db });
            const container = new fake.FakeEl('div');
            await ui.renderJornadasTab(container);
            assert(!container.innerHTML.includes('<script>alert(1)</script>'), 'script inyectado en el DOM');
        });

        suite.test('M11 control: un comentario normal se muestra tal cual', async () => {
            const db = await seedWithObservation('Feina client XYZ');
            const { ui, fake } = loadDbUi({ beta10DB: db });
            const container = new fake.FakeEl('div');
            await ui.renderJornadasTab(container);
            assert(container.innerHTML.includes('Feina client XYZ'));
            const c2 = new fake.FakeEl('div');
            await ui.renderOvertimeTab(c2);
            assert(c2.innerHTML.includes('Feina client XYZ'));
            assert(c2.innerHTML.includes('Hores Remunerades'), 'resumen dual presente');
        });

        suite.test('db-ui renderiza estados vacios sin lanzar (sin jornadas / sin pausas)', async () => {
            const db = newRealDb();
            const { ui, fake } = loadDbUi({ beta10DB: db });
            const c = new fake.FakeEl('div');
            await ui.renderOvertimeTab(c);
            assert(c.innerHTML.includes('Sense Hores Extra'));
            await ui.renderPausesTab(c);
            assert(c.innerHTML.includes('Sense Pauses'));
            await ui.renderJornadasTab(c);
            assert(c.innerHTML.includes('Sense Jornades'));
        });

        function withTimezone(tz, fn) {
            const had = Object.prototype.hasOwnProperty.call(process.env, 'TZ');
            const prev = process.env.TZ;
            process.env.TZ = tz;
            try { return fn(); } finally {
                if (had) process.env.TZ = prev; else delete process.env.TZ;
            }
        }

        suite.test('L1 el modal "Afegir Manual" propone la fecha LOCAL de hoy (a las 00:30 de Madrid no puede ser la de ayer en UTC)', async () => {
            withTimezone('Europe/Madrid', () => {
                const clock = createClock(new Date('2026-10-03T00:30:00+02:00'));
                const { ui, fake } = loadDbUi({ beta10DB: {}, clock });
                ui.openAddManualJornadaModal();
                const modal = fake.document.body.lastChild;
                const m = /id="man-date" value="([^"]+)"/.exec(modal.innerHTML);
                assert(m, 'no se encuentra el input de fecha');
                assertEqual(m[1], '2026-10-03', 'fecha por defecto (hoy local)');
            });
        });

        suite.test('L1 control: a mediodia la fecha por defecto coincide con hoy', async () => {
            withTimezone('Europe/Madrid', () => {
                const clock = createClock(new Date('2026-10-03T12:00:00+02:00'));
                const { ui, fake } = loadDbUi({ beta10DB: {}, clock });
                ui.openAddManualJornadaModal();
                const m = /id="man-date" value="([^"]+)"/.exec(fake.document.body.lastChild.innerHTML);
                assertEqual(m[1], '2026-10-03');
            });
        });

        suite.test('Alta manual: guarda una jornada con extra remunerada en bloques de 30 min y la muestra en la BD real', async () => {
            const db = newRealDb();
            const { ui, fake, alerts } = loadDbUi({ beta10DB: db });
            ui.openAddManualJornadaModal();
            const modal = fake.document.body.lastChild;
            // El modal real busca los inputs con modal.querySelector('#id'); los registramos como elementos editables
            fake.document.getElementById('man-date').value = '2026-10-02';
            fake.document.getElementById('man-start').value = '08:00';
            fake.document.getElementById('man-end').value = '18:00';
            fake.document.getElementById('man-worked').value = '9.8';
            fake.document.getElementById('man-extra').value = '0.8';
            fake.document.getElementById('man-obs').value = 'manual';
            await quiet(() => modal.querySelector('#btn-save-man').onclick());
            const rows = await db.getRecentJornadas(5);
            assertEqual(rows.length, 1);
            assertEqual(rows[0].date, '2026-10-02');
            assertEqual(rows[0].extra_hours, 0.8);
            assertEqual(rows[0].remunerated_extra_hours, 0.5);
            assertEqual(rows[0].observations, 'manual');
            assert(alerts.some(a => a.includes('desada')), 'confirmacion al usuario');
        });
    });
};
