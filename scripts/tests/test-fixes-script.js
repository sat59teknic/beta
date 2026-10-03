/**
 * scripts/tests/test-fixes-script.js
 * Tests de los arreglos sobre script.js (CODIGO REAL en vm, ver scripts/test-fake-app.js):
 * estado persistido (M14, L2), calculo unico de extras (M4), esperas (M3), GPS (M9),
 * cola de fichajes pendientes (M8), cola de escrituras SQLite (A3), notificaciones sin bloquear la UI (M10),
 * escape de HTML (M11) y formato de horas (L3).
 *
 * Cero red real: fetch simulado en memoria; GPS, Capacitor y base de datos simulados.
 */

const { assert, assertEqual, assertDeepEqual } = require('../test-harness.js');
const {
    createClock, createMemoryStorage, loadScriptApp, nativeGlobals, flush
} = require('../test-fake-app.js');

const H = 3600 * 1000;
const M = 60 * 1000;

const baseState = (over = {}) => ({
    currentState: 'FUERA', workStartTime: null, currentPauseStart: null, currentPauseType: null,
    totalPauseTimeToday: 0, currentLocation: null, isAlarmPlaying: false, pauseAlarmTriggered: false,
    lastAlarmTime: null, alarmSource: null, wakeLock: null, wakeLockLost: false,
    workDayStandard: null, workDayType: null, workStartDay: null, breakfastDate: null, ...over
});

// GPS controlable: modo ok/fail y avance opcional del reloj (simula un GPS lento)
function gpsController(clock) {
    const g = { mode: 'ok', calls: 0, advance: 0 };
    g.geolocation = {
        getCurrentPosition: (ok, err) => {
            g.calls++;
            if (g.advance) clock.advance(g.advance);
            if (g.mode === 'ok') ok({ coords: { latitude: 41.79, longitude: 2.77, accuracy: 5 } });
            else err({ code: 1, message: 'User denied Geolocation' });
        }
    };
    return g;
}

const okHealth = { ok: true, json: async () => ({ message: 'ok' }) };

module.exports = function registerFixesScriptTests(runner) {
    runner.suite('Arreglos script.js (codigo real): estado, GPS, colas, extras y notificaciones sin bloqueo', async (suite) => {

        // ------------------------------------------------------------ M14 / L2
        suite.test('M14 un estado corrupto conserva una copia en beta10AppState_corrupt, borra la clave y arranca en FUERA', async () => {
            const storage = createMemoryStorage();
            storage.setItem('beta10AppState', '{"currentState":"JORNADA","workStart');
            const app = await loadScriptApp({ storage });
            assertEqual(app.t.getState().currentState, 'FUERA');
            assertEqual(storage.getItem('beta10AppState_corrupt'), '{"currentState":"JORNADA","workStart', 'copia de la clave danada');
            assert(app.logTexts().some(t => t.includes('beta10AppState_corrupt')), 'se avisa en el registro');
            // Tras arrancar, el estado valido ya se vuelve a guardar normalmente
            app.t.saveState();
            assertEqual(JSON.parse(storage.getItem('beta10AppState')).currentState, 'FUERA');
        });

        suite.test('M14 valores no objeto (numero, array, cadena) tambien se tratan como estado corrupto', async () => {
            const app = await loadScriptApp();
            for (const bad of ['42', '"texto"', '[1,2]', 'true']) {
                app.storage.setItem('beta10AppState', bad);
                app.t.loadState();
                assertEqual(app.t.getState().currentState, 'FUERA', bad);
                assertEqual(app.storage.getItem('beta10AppState_corrupt'), bad);
            }
        });

        suite.test('L2 el estandar 0 (fin de semana) y el dia 0 (domingo) sobreviven a saveState/loadState (antes `|| null` los perdia y se pasaba a 9h)', async () => {
            const app = await loadScriptApp();
            const start = new Date(app.clock.now - 3 * H);
            app.t.setState(baseState({ currentState: 'JORNADA', workStartTime: start, workDayStandard: 0, workDayType: 'Diumenge', workStartDay: 0 }));
            app.t.saveState();
            app.t.setState(baseState());
            app.t.loadState();
            const s = app.t.getState();
            assertEqual(s.workDayStandard, 0, 'estandar 0');
            assertEqual(s.workStartDay, 0, 'domingo');
            const r = app.t.calculateExtraHours();
            assertEqual(r.standardWorkDay, 0, 'sigue siendo fin de semana tras recargar');
            assertEqual(r.extraHours, 3);
        });

        suite.test('M14 totalPauseTimeToday NaN, negativo o texto en el estado guardado se sanea a 0', async () => {
            const app = await loadScriptApp();
            for (const bad of ['"abc"', '-5', 'null']) {
                app.storage.setItem('beta10AppState', `{"currentState":"FUERA","totalPauseTimeToday":${bad}}`);
                app.t.loadState();
                assertEqual(app.t.getState().totalPauseTimeToday, 0, bad);
            }
        });

        suite.test('M14 loadState rellena los campos que faltan con los valores por defecto (estado parcial)', async () => {
            const app = await loadScriptApp();
            app.storage.setItem('beta10AppState', '{"currentState":"FUERA"}');
            app.t.loadState();
            const s = app.t.getState();
            assertEqual(s.isAlarmPlaying, false);
            assertEqual(s.pauseAlarmTriggered, false);
            assertEqual(s.breakfastDate, null);
        });

        // ------------------------------------------------------------ calculateExtraHours NaN
        suite.test('calculateExtraHours: workStartTime invalido o pausa NaN nunca produce NaN (devuelve ceros)', async () => {
            const app = await loadScriptApp();
            app.t.setState(baseState({ currentState: 'JORNADA', workStartTime: new Date('no-es-fecha'), workDayStandard: 9 }));
            let r = app.t.calculateExtraHours();
            assertEqual(r.totalHours, 0);
            assertEqual(r.extraHours, 0);
            app.t.setState(baseState({ currentState: 'JORNADA', workStartTime: new Date(app.clock.now - 10 * H), totalPauseTimeToday: NaN, workDayStandard: 'x' }));
            r = app.t.calculateExtraHours();
            assert(Number.isFinite(r.totalHours) && Number.isFinite(r.extraHours) && Number.isFinite(r.remuneratedExtraHours), JSON.stringify(r));
            assertEqual(r.standardWorkDay, 9, 'estandar invalido -> 9');
        });

        // ------------------------------------------------------------ L3
        suite.test('L3 formatHoursMinutes redondea a minutos totales primero (nunca "60min")', async () => {
            const { t } = await loadScriptApp();
            assertEqual(t.formatHoursMinutes(8 + 59 / 60 + 45 / 3600), '9h 0min');
            assertEqual(t.formatHoursMinutes(9.5), '9h 30min');
            assertEqual(t.formatHoursMinutes(0), '0h 0min');
            assertEqual(t.formatHoursMinutes(NaN), '0h 0min');
            assertEqual(t.formatHoursMinutes(-3), '0h 0min');
            assertEqual(t.formatHoursMinutes(1.9999), '2h 0min');
        });

        // ------------------------------------------------------------ M11
        suite.test('M11 escapeHtml escapa & < > " \' y tolera null/undefined/numeros', async () => {
            const { t } = await loadScriptApp();
            assertEqual(t.escapeHtml('<img src="x" onerror=\'a&b\'>'), '&lt;img src=&quot;x&quot; onerror=&#39;a&amp;b&#39;&gt;');
            assertEqual(t.escapeHtml(null), '');
            assertEqual(t.escapeHtml(undefined), '');
            assertEqual(t.escapeHtml(7), '7');
        });

        suite.test('M11 el banner de pendientes escapa el titulo (texto no confiable) antes de usar innerHTML', async () => {
            const app = await loadScriptApp();
            app.t.savePendingSync({ type: 'X', title: '<img src=x onerror=alert(1)>', actions: [], timestamp: new Date(app.clock.now).toISOString() });
            const html = app.el('pending-sync-banner').innerHTML;
            assert(html.includes('&lt;img src=x'), 'titulo escapado');
            assert(!html.includes('<img src=x'), 'sin etiqueta inyectada');
        });

        // ------------------------------------------------------------ M4 / M3
        suite.test('M4 endWorkday calcula las extras UNA vez: si el GPS tarda y se cruza el umbral de 30 min no se abre un 2o modal y se registra lo calculado al pulsar', async () => {
            const clock = createClock();
            const gps = gpsController(clock);
            const calls = [];
            const app = await loadScriptApp({
                clock,
                navigator: { geolocation: gps.geolocation },
                beta10DB: { init: async () => true, recordFichaje: async () => {}, recordPausa: async () => {}, recordJornada: async (a) => { calls.push(a); } }
            });
            // 9h 29m 50s de jornada: 29 min 50 s de extra (< 30 min: sin modal de horas extra)
            const start = new Date(clock.now - (9 * H + 29 * M + 50 * 1000));
            app.t.setState(baseState({ currentState: 'JORNADA', workStartTime: start, workDayStandard: 9, workDayType: 'Dilluns-Dijous' }));
            const clickedAt = clock.now;
            gps.advance = 10 * 1000; // el GPS tarda 10 s: al terminar ya serian 9h 30m 00s
            const outcome = await Promise.race([
                app.t.endWorkday(false).then(() => 'done'),
                new Promise(resolve => setTimeout(() => resolve('timeout: se abrio un segundo modal'), 1500))
            ]);
            assertEqual(outcome, 'done');
            assertEqual(calls.length, 1);
            const c = calls[0];
            assertEqual(new Date(c.endTime).getTime(), clickedAt, 'fin = instante en que se pulso');
            assertEqual(Math.round(c.extraHours * 10000) / 10000, 0.4972, 'extra al pulsar (29m50s), no la de despues del GPS');
            assertEqual(c.remuneratedExtraHours, 0);
            assert(Math.abs(c.workedHours - (9 + 29 / 60 + 50 / 3600)) < 1e-6, 'worked coherente con el mismo instante: ' + c.workedHours);
            assertEqual(app.t.getState().currentState, 'FUERA');
        });

        suite.test('M3 startWorkday/endWorkday esperan a handleAction: al resolver ya estan en el nuevo estado (sin flush) y los fallos no dejan promesas sin capturar', async () => {
            const unhandled = [];
            const onUnhandled = (e) => unhandled.push(e);
            process.on('unhandledRejection', onUnhandled);
            try {
                const jornadas = [];
                const app = await loadScriptApp({
                    beta10DB: { init: async () => true, recordFichaje: async () => {}, recordPausa: async () => {}, recordJornada: async (a) => { jornadas.push(a); } }
                });
                await app.t.startWorkday(false);
                assertEqual(app.t.getState().currentState, 'JORNADA', 'sin flush');
                await app.t.endWorkday(false);
                assertEqual(app.t.getState().currentState, 'FUERA', 'sin flush');
                assertEqual(jornadas.length, 1, 'jornada registrada antes de resolver');

                // Camino de error: sin conexion
                const offline = await loadScriptApp({
                    fetchImpl: async (url) => {
                        if (url === '/api/health') return okHealth;
                        throw new Error('Unable to resolve host "9teknic.movbeta10.es"');
                    }
                });
                await offline.t.startWorkday(false);
                await flush(20);
                assertEqual(offline.t.getState().currentState, 'FUERA');
                assertEqual(offline.alerts.length, 1, 'un unico aviso al usuario');
                assertEqual(unhandled.length, 0, 'ninguna promesa rechazada sin capturar');
            } finally { process.removeListener('unhandledRejection', onUnhandled); }
        });

        // ------------------------------------------------------------ M9
        suite.test('M9 GPS caido y sin posicion reciente: UN solo alert (no una cascada) y ningun fichaje; el arranque automatico no muestra alert', async () => {
            const clock = createClock();
            const gps = gpsController(clock);
            gps.mode = 'fail';
            const app = await loadScriptApp({ clock, navigator: { geolocation: gps.geolocation } });
            assertEqual(app.alerts.length, 0, 'calentar el GPS al arrancar no debe molestar con un alert');
            app.t.setState(baseState({ currentState: 'JORNADA', workStartTime: new Date(clock.now - 2 * H), workDayStandard: 9 }));
            await app.t.startPause('dinar');
            assertEqual(app.alerts.length, 1, 'alerts: ' + JSON.stringify(app.alerts));
            assertEqual(app.fetchCalls.length, 0, 'no se ficha sin coordenadas');
            assertEqual(app.t.getState().currentState, 'JORNADA');

            await app.t.endWorkday(false);
            assertEqual(app.alerts.length, 2, 'cada accion del usuario muestra el error una vez');
            assertEqual(app.t.getState().currentState, 'JORNADA');
        });

        suite.test('M9 GPS caido pero con posicion de hace < 15 min: se ficha con la ultima posicion y se deja constancia en el registro', async () => {
            const clock = createClock();
            const gps = gpsController(clock);
            const app = await loadScriptApp({ clock, navigator: { geolocation: gps.geolocation } });
            app.t.setState(Object.assign(app.t.getState(), baseState({ currentState: 'JORNADA', workStartTime: new Date(clock.now - 2 * H), workDayStandard: 9, currentLocation: app.t.getState().currentLocation })));
            assert(app.t.getState().currentLocation, 'precondicion: el arranque obtuvo una posicion');
            gps.mode = 'fail';
            clock.advance(5 * M);
            await app.t.startPause('dinar');
            assertEqual(app.alerts.length, 0, 'sin alert');
            assertEqual(app.t.getState().currentState, 'PAUSA');
            assertEqual(app.fetchCalls.map(c => c.action + ':' + c.point).join(','), 'salida:J,entrada:P');
            assertEqual(app.fetchCalls[0].location.latitude, 41.79);
            assert(app.logTexts().some(t => t.includes('última posició')), 'constancia en el registro');
        });

        suite.test('M9 posicion de hace > 15 min: no se reutiliza (un solo alert, sin fichaje)', async () => {
            const clock = createClock();
            const gps = gpsController(clock);
            const app = await loadScriptApp({ clock, navigator: { geolocation: gps.geolocation } });
            app.t.setState(Object.assign(app.t.getState(), baseState({ currentState: 'JORNADA', workStartTime: new Date(clock.now - 2 * H), workDayStandard: 9, currentLocation: app.t.getState().currentLocation })));
            gps.mode = 'fail';
            clock.advance(16 * M);
            await app.t.startPause('dinar');
            assertEqual(app.alerts.length, 1);
            assertEqual(app.fetchCalls.length, 0);
            assertEqual(app.t.getState().currentState, 'JORNADA');
        });

        suite.test('M9 coordenadas NaN del sensor se rechazan sin dejar NaN en el estado', async () => {
            const clock = createClock();
            const app = await loadScriptApp({
                clock,
                navigator: { geolocation: { getCurrentPosition: (ok) => ok({ coords: { latitude: NaN, longitude: 2.77, accuracy: 5 } }) } }
            });
            assertEqual(app.t.getState().currentLocation, null, 'no se guarda una posicion invalida');
            let err = null;
            try { await app.t.getCurrentLocation(); } catch (e) { err = e; }
            assert(err && /invàlides/.test(err.message), 'rechaza con mensaje claro');
            assertEqual(app.alerts.length, 0, 'getCurrentLocation ya no muestra alerts por su cuenta');
        });

        suite.test('showTranslatedError muestra un mismo error una sola vez aunque lo pasen varias capas', async () => {
            const app = await loadScriptApp();
            const err = new Error('algo ha fallat');
            app.t.showTranslatedError(err);
            app.t.showTranslatedError(err);
            assertEqual(app.alerts.length, 1);
            app.t.showTranslatedError(new Error('otro'));
            assertEqual(app.alerts.length, 2);
        });

        // ------------------------------------------------------------ M8
        function offlineSwitch() {
            const sw = { online: false, failOnCall: 0, calls: [], attempts: 0 };
            sw.fetchImpl = async (url, init) => {
                if (url === '/api/health') return okHealth;
                if (url !== '/api/beta10') throw new Error('SECURITY VIOLATION: unexpected network call to ' + url);
                sw.attempts++;
                if (!sw.online || (sw.failOnCall && sw.attempts === sw.failOnCall)) throw new Error('Unable to resolve host "9teknic.movbeta10.es"');
                sw.calls.push(JSON.parse(init.body));
                return { ok: true, status: 200, json: async () => ({ success: true }) };
            };
            return sw;
        }

        const pausedState = (now, type = 'dinar', since = 30 * M) => baseState({
            currentState: 'PAUSA', workStartTime: new Date(now - 3 * H), currentPauseStart: new Date(now - since),
            currentPauseType: type, workDayStandard: 9
        });

        suite.test('M8 la cola de pendientes ACUMULA varios fichajes (antes el segundo pisaba al primero) y los reenvia en orden con su hora original', async () => {
            const clock = createClock();
            const sw = offlineSwitch();
            const fichajes = [];
            const app = await loadScriptApp({
                clock, fetchImpl: sw.fetchImpl,
                beta10DB: { init: async () => true, recordPausa: async () => {}, recordJornada: async () => {}, recordFichaje: async (a) => { fichajes.push(a); } }
            });
            const firstAt = new Date(clock.now).toISOString();
            app.t.setState(pausedState(clock.now, 'esmorçar', 15 * M));
            await app.t.endPause();
            clock.advance(5 * M);
            const secondAt = new Date(clock.now).toISOString();
            app.t.setState(pausedState(clock.now, 'dinar', 30 * M));
            await app.t.endPause();

            let pending = app.t.getPendingSync();
            assertEqual(pending.length, 2, 'dos pendientes distintos');
            assertDeepEqual(pending.map(p => p.timestamp), [firstAt, secondAt]);
            assertDeepEqual(pending[0].actions.map(a => a.action + ':' + a.point + '@' + a.timestamp), [`salida:P@${firstAt}`, `entrada:J@${firstAt}`]);

            clock.advance(10 * M);
            sw.online = true;
            await app.t.executePendingSync();
            assertEqual(sw.calls.map(c => c.action + ':' + c.point).join(','), 'salida:P,entrada:J,salida:P,entrada:J');
            assert(sw.calls[0].observations.includes('[Fitxatge fet a les'), 'hora original en observaciones: ' + sw.calls[0].observations);
            assertEqual(app.t.getPendingSync(), null, 'cola vacia');
            assertEqual(app.storage.getItem('beta10_pending_sync'), null);
            await flush(10);
            const replayed = fichajes.filter(f => f.timestamp === firstAt || f.timestamp === secondAt);
            assertEqual(replayed.length, 4, 'SQLite guarda los fichajes con la hora ORIGINAL, no la del reenvio');
        });

        suite.test('M8 reintento parcial: si falla la 2a accion, la 1a ya enviada no se reenvia (sin duplicados)', async () => {
            const clock = createClock();
            const sw = offlineSwitch();
            sw.online = true;
            sw.failOnCall = 2;
            const app = await loadScriptApp({ clock, fetchImpl: sw.fetchImpl });
            const at = new Date(clock.now - 20 * M).toISOString();
            app.t.savePendingSync({
                type: 'END_PAUSE', title: 'Tornada de Pausa', timestamp: at,
                actions: [{ action: 'salida', point: 'P', timestamp: at }, { action: 'entrada', point: 'J', timestamp: at }]
            });
            await app.t.executePendingSync();
            assertEqual(sw.calls.length, 1, 'se envio salida:P');
            const pending = app.t.getPendingSync();
            assertEqual(pending.length, 1);
            assertDeepEqual(pending[0].actions.map(a => a.action + ':' + a.point), ['entrada:J'], 'solo queda lo no enviado');

            await app.t.executePendingSync();
            assertEqual(sw.calls.map(c => c.action + ':' + c.point).join(','), 'salida:P,entrada:J', 'sin salida:P duplicada');
            assertEqual(app.t.getPendingSync(), null);
        });

        suite.test('M8 endPause: si falla solo la 2a accion, en la cola queda unicamente la que no se envio', async () => {
            const clock = createClock();
            const sw = offlineSwitch();
            sw.online = true;
            sw.failOnCall = 2;
            const app = await loadScriptApp({ clock, fetchImpl: sw.fetchImpl });
            app.t.setState(pausedState(clock.now));
            await app.t.endPause();
            assertEqual(sw.calls.map(c => c.action + ':' + c.point).join(','), 'salida:P');
            const pending = app.t.getPendingSync();
            assertEqual(pending.length, 1);
            assertDeepEqual(pending[0].actions.map(a => a.action + ':' + a.point), ['entrada:J']);
            assertEqual(app.t.getState().currentState, 'JORNADA', 'el tiempo de pausa local ya se habia parado');
        });

        suite.test('M8 compatibilidad: un pendiente guardado con el formato antiguo (objeto unico) se sigue procesando', async () => {
            const clock = createClock();
            const sw = offlineSwitch();
            sw.online = true;
            const storage = createMemoryStorage();
            storage.setItem('beta10_pending_sync', JSON.stringify({
                type: 'END_PAUSE', title: 'Tornada de Pausa',
                actions: [{ action: 'salida', point: 'P' }, { action: 'entrada', point: 'J', newState: 'JORNADA' }],
                timestamp: new Date(clock.now - 3 * H).toISOString()
            }));
            const app = await loadScriptApp({ clock, storage, fetchImpl: sw.fetchImpl });
            const pending = app.t.getPendingSync();
            assertEqual(Array.isArray(pending) && pending.length, 1);
            await app.t.executePendingSync();
            assertEqual(sw.calls.length, 2);
            assert(sw.calls[0].observations.includes('[Fitxatge fet a les'), 'usa el timestamp de la entrada');
            assertEqual(app.t.getPendingSync(), null);
        });

        suite.test('M8 ejecuciones concurrentes de executePendingSync no duplican envios', async () => {
            const clock = createClock();
            const sw = offlineSwitch();
            sw.online = true;
            const app = await loadScriptApp({ clock, fetchImpl: sw.fetchImpl });
            const at = new Date(clock.now - 5 * M).toISOString();
            app.t.savePendingSync({ type: 'END_PAUSE', title: 'x', timestamp: at, actions: [{ action: 'salida', point: 'P', timestamp: at }, { action: 'entrada', point: 'J', timestamp: at }] });
            await Promise.all([app.t.executePendingSync(), app.t.executePendingSync()]);
            assertEqual(sw.calls.length, 2);
        });

        // ------------------------------------------------------------ A3 cola SQLite
        suite.test('A3 si SQLite falla al finalizar, la jornada queda en una cola persistente, se avisa al usuario y se reintenta al abrir la app', async () => {
            const clock = createClock();
            const storage = createMemoryStorage();
            let failDb = true;
            const recorded = [];
            const dbMock = {
                init: async () => true, recordFichaje: async () => {}, recordPausa: async () => {},
                recordJornada: async (a) => { if (failDb) throw new Error('QuotaExceededError'); recorded.push(a); }
            };
            const app = await loadScriptApp({ clock, storage, beta10DB: dbMock });
            app.t.setState(baseState({ currentState: 'JORNADA', workStartTime: new Date(clock.now - 8 * H), workDayStandard: 9, workDayType: 'Dilluns-Dijous' }));
            await app.t.endWorkday(false);
            const queue = JSON.parse(storage.getItem('beta10_pending_db_writes'));
            assertEqual(queue.length, 1);
            assertEqual(queue[0].kind, 'jornada');
            assertEqual(queue[0].payload.workedHours, 8);
            assertEqual(queue[0].payload.date, '2026-10-05');
            assertEqual(typeof queue[0].payload.startTime, 'string', 'las fechas se serializan (ISO)');
            assert(app.alerts.some(a => a.includes('No s\'ha pogut desar')), 'aviso visible: ' + JSON.stringify(app.alerts));
            assertEqual(app.t.getState().currentState, 'FUERA');

            // La app se reabre y la base de datos ya funciona: la cola se vacia y se registra UNA vez
            failDb = false;
            await loadScriptApp({ clock, storage, beta10DB: dbMock });
            await flush(20);
            assertEqual(recorded.length, 1);
            assertEqual(recorded[0].workedHours, 8);
            assertEqual(storage.getItem('beta10_pending_db_writes'), null, 'cola vaciada');
        });

        suite.test('A3 flushDbQueue conserva el orden y se detiene en el primer fallo (lo no guardado sigue en cola)', async () => {
            const storage = createMemoryStorage();
            let calls = 0;
            const app = await loadScriptApp({
                storage,
                beta10DB: {
                    init: async () => true, recordFichaje: async () => {}, recordJornada: async () => {},
                    recordPausa: async () => { calls++; if (calls === 2) throw new Error('IndexedDB bloqueada'); }
                }
            });
            storage.setItem('beta10_pending_db_writes', JSON.stringify([
                { kind: 'pausa', payload: { type: 'dinar', n: 1 } },
                { kind: 'pausa', payload: { type: 'dinar', n: 2 } },
                { kind: 'pausa', payload: { type: 'dinar', n: 3 } }
            ]));
            const done = await app.t.flushDbQueue();
            assertEqual(done, 1);
            const left = JSON.parse(storage.getItem('beta10_pending_db_writes'));
            assertDeepEqual(left.map(x => x.payload.n), [2, 3]);
            const done2 = await app.t.flushDbQueue();
            assertEqual(done2, 2);
            assertEqual(storage.getItem('beta10_pending_db_writes'), null);
        });

        suite.test('A3 una pausa que no se puede guardar en SQLite tambien queda en cola (no se pierde en silencio)', async () => {
            const clock = createClock();
            const app = await loadScriptApp({
                clock,
                beta10DB: { init: async () => true, recordFichaje: async () => {}, recordJornada: async () => {}, recordPausa: async () => { throw new Error('disco lleno'); } }
            });
            app.t.setState(pausedState(clock.now, 'dinar', 30 * M));
            await app.t.endPause();
            await flush(20);
            const queue = JSON.parse(app.storage.getItem('beta10_pending_db_writes'));
            assertEqual(queue.length, 1);
            assertEqual(queue[0].kind, 'pausa');
            assertEqual(queue[0].payload.durationMinutes, 30);
        });

        // ------------------------------------------------------------ M10
        suite.test('M10 la UI se pinta sin esperar al dialogo de permiso de notificaciones (el init completa cuando el usuario responde)', async () => {
            const clock = createClock();
            const nat = nativeGlobals(clock, { permission: 'prompt', gateRequest: true });
            const app = await loadScriptApp({ clock, globals: nat.globals, awaitInit: false });
            assertEqual(app.el('current-state-text').textContent, 'Fora de Jornada', 'estado pintado con el dialogo aun abierto');
            assert(app.el('button-container').children.length > 0, 'botones generados');
            let settled = false;
            app.t.initPromise.then(() => { settled = true; });
            await flush(10);
            assertEqual(settled, false, 'init sigue esperando el permiso, pero la UI ya es usable');
            nat.ln.release('granted');
            await app.t.initPromise;
            assertEqual(settled, true);
            assertEqual(nat.ln.channels.length, 1, 'canal creado tras conceder el permiso');
        });

        suite.test('M10 permiso denegado: aviso visible (clase alert) y la app sigue funcionando', async () => {
            const clock = createClock();
            const nat = nativeGlobals(clock, { permission: 'denied' });
            const app = await loadScriptApp({ clock, globals: nat.globals });
            const info = app.el('info-message');
            assert(info.textContent.includes('Notificacions desactivades'), 'aviso: ' + info.textContent);
            assert(info.classList.contains('alert'), 'clase alert');
            assertEqual(app.t.getState().currentState, 'FUERA');
            assertEqual(nat.ln.channels.length, 0, 'sin permiso no se crea canal');
        });
    });
};
