/**
 * scripts/tests/test-pause-alarms-real.js
 * Notificaciones de pausa ejecutando el script.js REAL (vm + DOM falso) con un LocalNotifications
 * simulado que reproduce el comportamiento relevante del plugin Android real (permiso POST_NOTIFICATIONS,
 * alarma exacta, programaciones descartadas en silencio, mismo id => reemplaza, notificaciones inmediatas
 * que disparan localNotificationReceived, tocar una notificacion la quita de la bandeja).
 *
 * Modelo actual (sustituye a la antigua alarma en bucle con alarm.wav):
 *  - 1002 "En pausa": persistente (ongoing), canal silencioso, boton END_PAUSE "Finalitzar pausa".
 *  - 1001 "Pausa acabada": programada a inicio + limite, canal HIGH con pause_end.wav (CLINK x3), UNA vez.
 * Cero red real.
 */

const { assert, assertEqual, assertDeepEqual } = require('../test-harness.js');
const {
    createClock, createMemoryStorage, loadScriptApp, nativeGlobals, flush
} = require('../test-fake-app.js');

const H = 3600 * 1000;
const M = 60 * 1000;
const STORAGE_KEY = 'beta10AppState';
const END_ID = 1001;
const STATUS_ID = 1002;

const baseState = (over = {}) => ({
    currentState: 'FUERA', workStartTime: null, currentPauseStart: null, currentPauseType: null,
    totalPauseTimeToday: 0, currentLocation: null, isAlarmPlaying: false, pauseAlarmTriggered: false,
    lastAlarmTime: null, alarmSource: null, wakeLock: null, wakeLockLost: false,
    workDayStandard: null, workDayType: null, workStartDay: null, breakfastDate: null, ...over
});

const savedPauseState = (now, type, elapsedMs, over = {}) => JSON.stringify(baseState({
    currentState: 'PAUSA', workStartTime: new Date(now - 2 * H), currentPauseStart: new Date(now - elapsedMs),
    currentPauseType: type, workDayStandard: 9, workDayType: 'Dilluns-Dijous', ...over
}));

function dbSpy() {
    const calls = { pausa: [], jornada: [] };
    return {
        calls,
        db: {
            init: async () => true,
            recordFichaje: async () => {},
            recordJornada: async (j) => { calls.jornada.push(j); },
            recordPausa: async (p) => { calls.pausa.push(p); }
        }
    };
}

async function nativeApp(opts = {}) {
    const clock = opts.clock || createClock();
    const nat = nativeGlobals(clock, opts.ln || {}, opts.extraGlobals || {});
    const app = await loadScriptApp({ clock, storage: opts.storage, globals: nat.globals, beta10DB: opts.beta10DB });
    return { app, nat, clock, ln: nat.ln };
}

const inJornada = (app) => app.t.setState(baseState({
    currentState: 'JORNADA', workStartTime: new Date(app.clock.now - 2 * H), workDayStandard: 9, workDayType: 'Dilluns-Dijous'
}));

// Cuenta las reproducciones de audio del <audio> falso
function spyAudio(app) {
    const spy = { endPlays: 0, alarmPlays: 0, paused: 0, loops: [] };
    app.fake.audio.play = async function () {
        if (this.src === 'pause_end.wav') { spy.endPlays++; spy.loops.push(this.loop); }
        if (this.src === 'alarm.wav') spy.alarmPlays++;
    };
    app.fake.audio.pause = () => { spy.paused++; };
    return spy;
}

const sessionTimerDelays = (app) => app.timers.pending().filter(t => !t.interval).map(t => t.delay);
const delivered = (ln, id) => ln.delivered.find(n => n.id === id);
const scheduledIds = (ln) => ln.scheduled.map(n => n.id);
const punchesOf = (nat) => nat.punches.map(p => `${p.action}:${p.point}`);

module.exports = function registerPauseAlarmsRealTests(runner) {
    runner.suite('Notificaciones de pausa (codigo real + plugin Android simulado)', async (suite) => {

        // ------------------------------------------------------------ canales, permisos
        suite.test('Canales: "Pausa en curs" silencioso (LOW) y "Fi de pausa" HIGH con pause_end.wav; canales de la alarma antigua (v1..v4) borrados; accion END_PAUSE; listeners', async () => {
            const { ln } = await nativeApp();
            assertEqual(ln.channels.length, 2);
            const status = ln.channels.find(c => c.id === 'pause_status_channel_v1');
            const end = ln.channels.find(c => c.id === 'pause_end_channel_v1');
            assert(status && end, 'ambos canales creados');
            assertEqual(status.importance, 2, 'sin sonido ni heads-up');
            assertEqual(status.sound, undefined);
            assertEqual(status.vibration, false);
            assertEqual(end.importance, 4, 'suena una vez y aparece arriba');
            assertEqual(end.sound, 'pause_end.wav');
            assertEqual(end.visibility, 1);
            assert(!ln.channels.some(c => c.sound === 'alarm.wav'), 'ningun canal con la alarma antigua');
            assertDeepEqual(ln.deleted.slice().sort(), ['pause_alarm_channel', 'pause_alarm_channel_v2', 'pause_alarm_channel_v3', 'pause_alarm_channel_v4'].sort());
            assertEqual(ln.actionTypes[0].id, 'PAUSE_ACTIONS');
            assertEqual(ln.actionTypes[0].actions.length, 1);
            assertEqual(ln.actionTypes[0].actions[0].id, 'END_PAUSE');
            assert(ln.actionTypes[0].actions[0].title.includes('Finalitzar pausa'));
            assertEqual((ln.listeners.localNotificationReceived || []).length, 1);
            assertEqual((ln.listeners.localNotificationActionPerformed || []).length, 1);
        });

        suite.test('Si el usuario ha silenciado el canal "Fi de pausa" en Ajustes (importancia < 3) se avisa visiblemente', async () => {
            const { app } = await nativeApp({ ln: { channelImportance: 0 } });
            const info = app.el('info-message');
            assert(info.textContent.includes('silenciat'), info.textContent);
            assert(info.classList.contains('alert'));
            assert(app.logTexts().some(t => t.includes('silenciat')));
        });

        suite.test('Alarma exacta denegada (Android 12+): se ofrece abrir Ajustes UNA sola vez y despues solo se avisa', async () => {
            const confirms = [];
            const storage = createMemoryStorage();
            const extraGlobals = { confirm: (m) => { confirms.push(m); return true; } };
            const first = await nativeApp({ storage, extraGlobals, ln: { exact: 'denied', exactAfterChange: 'granted' } });
            assertEqual(confirms.length, 1);
            assert(confirms[0].includes('Alarmes i recordatoris'));
            assertEqual(first.ln.exactChangeCalls, 1);
            assertEqual(first.app.t.notificationStatus.exactAlarm, 'granted', 'reconsultado tras volver de Ajustes');

            const second = await nativeApp({ storage, extraGlobals, ln: { exact: 'denied' } });
            assertEqual(confirms.length, 1, 'sin segundo confirm');
            assertEqual(second.ln.exactChangeCalls, 0);
            inJornada(second.app);
            await second.app.t.startPause('dinar');
            const info = second.app.el('info-message');
            assertDeepEqual(scheduledIds(second.ln), [END_ID], 'se programa igualmente (inexacta)');
            assert(info.textContent.includes('endarrerir'), 'avisa del posible retraso: ' + info.textContent);
            assert(info.classList.contains('alert'));
        });

        // ------------------------------------------------------------ iniciar la pausa
        suite.test('startPause: publica YA la notificacion persistente 1002 "En pausa" con boton Finalitzar y programa UNA 1001 a +30 min con pause_end.wav', async () => {
            const { app, ln, clock } = await nativeApp();
            inJornada(app);
            await app.t.startPause('dinar');
            await flush(5);

            const st = delivered(ln, STATUS_ID);
            assert(st, 'notificacion "En pausa" visible en la bandeja');
            assertEqual(st.ongoing, true, 'persistente');
            assertEqual(st.autoCancel, false);
            assertEqual(st.channelId, 'pause_status_channel_v1');
            assertEqual(st.actionTypeId, 'PAUSE_ACTIONS');
            assertEqual(st.schedule, undefined, 'inmediata');
            assert(st.title.includes('En pausa') && st.title.includes('dinar'), st.title);
            assert(st.body.includes('acaba a les'), st.body);
            assertEqual(st.smallIcon, 'ic_stat_pause_alarm');

            assertDeepEqual(scheduledIds(ln), [END_ID]);
            const n = ln.scheduled[0];
            assertEqual(n.atMs, clock.now + 30 * M);
            assertEqual(n.schedule.allowWhileIdle, true, 'sobrevive a Doze');
            assertEqual(n.channelId, 'pause_end_channel_v1');
            assertEqual(n.sound, 'pause_end.wav');
            assertEqual(n.actionTypeId, 'PAUSE_ACTIONS', 'tambien permite finalizar la pausa');
            assertEqual(n.ongoing, undefined, 'la de fin no es persistente');

            assertEqual(app.t.getState().currentState, 'PAUSA');
            assertEqual(JSON.parse(app.storage.getItem(STORAGE_KEY)).currentState, 'PAUSA');
            // Publicar la 1002 dispara localNotificationReceived (plugin real): NO es el fin de la pausa
            assertEqual(app.el('alarm-banner').style.display, undefined, 'sin banner de fin');
            assertEqual(app.t.getState().pauseAlarmTriggered, false);
        });

        suite.test('startPause esmorzar programa a +15 min y el texto lo dice', async () => {
            const { app, ln, clock } = await nativeApp();
            inJornada(app);
            await app.t.startPause('esmorçar');
            assertEqual(ln.scheduled[0].atMs, clock.now + 15 * M);
            assert(ln.scheduled[0].body.includes('15 minuts'));
            assert(delivered(ln, STATUS_ID).title.includes('esmorçar'));
        });

        suite.test('El mensaje informativo de la pausa NO se borra al regenerar los botones ni en el siguiente tick', async () => {
            const { app } = await nativeApp();
            inJornada(app);
            await app.t.startPause('dinar');
            const info = app.el('info-message');
            assert(info.textContent.includes('Pausa dinar iniciada'), info.textContent);
            assert(info.textContent.includes('notificacions'), 'explica que la pausa esta en las notificaciones');
            app.t.updateUI();
            app.timers.pending().filter(t => t.interval).forEach(t => t.fn());
            assert(info.textContent.includes('Pausa dinar iniciada'), 'sigue visible: ' + info.textContent);
            assert(info.classList.contains('success'));
            assert(!info.classList.contains('alert'));
        });

        suite.test('Sin permiso POST_NOTIFICATIONS: la pausa empieza, no se publica nada y el usuario ve un aviso rojo claro', async () => {
            const { app, ln } = await nativeApp({ ln: { permission: 'denied' } });
            inJornada(app);
            await app.t.startPause('dinar');
            const info = app.el('info-message');
            assertEqual(ln.scheduled.length, 0);
            assertEqual(ln.delivered.length, 0);
            assertEqual(app.t.getState().currentState, 'PAUSA');
            assert(info.textContent.includes('NO s\'ha pogut programar'), info.textContent);
            assert(info.textContent.includes('permís de notificacions denegat'));
            assert(info.classList.contains('alert'));
            assert(app.logTexts().some(t => t.includes('NO garantit')));
        });

        suite.test('scheduleNotification con hora pasada detecta que Android no la deja pendiente (not-pending)', async () => {
            const clock = createClock();
            const storage = createMemoryStorage();
            storage.setItem(STORAGE_KEY, savedPauseState(clock.now, 'dinar', 5 * M));
            const { app, ln } = await nativeApp({ clock, storage, ln: { beforeSchedule: async () => { clock.advance(10 * M); } } });
            const outcome = await app.t.scheduleNotification('dinar', 1000);
            assertEqual(outcome.ok, false);
            assertEqual(outcome.reason, 'not-pending');
            assert(ln.dropped.some(n => n.id === END_ID));
        });

        suite.test('Si el permiso se revoca despues de abrir la app, scheduleNotification lo detecta y avisa', async () => {
            const { app, ln } = await nativeApp();
            inJornada(app);
            ln.permission = 'denied';
            await app.t.startPause('dinar');
            assertEqual(app.t.notificationStatus.permission, 'denied');
            assert(app.el('info-message').textContent.includes('NO s\'ha pogut programar'));
        });

        // ------------------------------------------------------------ fin del tiempo
        suite.test('Fin del tiempo (AlarmManager): la 1001 suena por el canal (CLINK x3), la app NO reproduce audio propio, banner informativo y la 1002 pasa a "esgotat"', async () => {
            const { app, ln, clock } = await nativeApp();
            inJornada(app);
            await app.t.startPause('dinar');
            const spy = spyAudio(app);
            clock.advance(30 * M);
            assert(ln.fire(END_ID), 'la alarma estaba programada');
            await flush(10);
            assertEqual(spy.endPlays, 0, 'sin doble sonido: lo hace el canal de Android');
            assertEqual(spy.alarmPlays, 0, 'nada de la alarma antigua');
            assertEqual(app.el('alarm-banner').style.display, 'flex');
            assert(app.el('alarm-banner-sub').textContent.includes('finalitzar la pausa'));
            const st = delivered(ln, STATUS_ID);
            assert(st && st.body.includes('esgotat'), 'la persistente avisa del tiempo agotado: ' + (st && st.body));
            assertEqual(st.ongoing, true);
            assertEqual(app.t.getState().currentState, 'PAUSA', 'la pausa NO se cierra sola');
            assertEqual(app.t.getState().isAlarmPlaying, false, 'no hay nada sonando que haya que parar');
            const persisted = JSON.parse(app.storage.getItem(STORAGE_KEY));
            assertEqual(persisted.pauseAlarmTriggered, true);
            assert(!persisted.isAlarmPlaying && !persisted.alarmSource, 'lo transitorio no se persiste');
        });

        suite.test('"Entesos" solo cierra el banner: la pausa y la notificacion "En pausa" siguen', async () => {
            const { app, ln, clock } = await nativeApp();
            inJornada(app);
            await app.t.startPause('dinar');
            clock.advance(30 * M);
            ln.fire(END_ID);
            await flush(10);
            app.el('btn-stop-alarm-banner').onclick({ stopPropagation() {} });
            await flush(5);
            assertEqual(app.el('alarm-banner').style.display, 'none');
            assertEqual(app.t.getState().currentState, 'PAUSA');
            assert(delivered(ln, STATUS_ID), 'la persistente sigue');
        });

        suite.test('El aviso de fin suena UNA sola vez por pausa aunque lleguen varios disparos (nativo + temporizador + contador UI + mas tarde)', async () => {
            const { app, ln, clock } = await nativeApp();
            inJornada(app);
            await app.t.startPause('dinar');
            const spy = spyAudio(app);
            clock.advance(30 * M);
            ln.fire(END_ID);
            app.t.notifyPauseEnd('dinar', 'background-timer');
            app.t.notifyPauseEnd('dinar', 'timer-limit');
            clock.advance(10 * M);
            app.t.notifyPauseEnd('dinar', 'background-timer');
            await flush(10);
            assertEqual(spy.endPlays, 0);
            assertEqual(app.logTexts().filter(t => t.includes('Fi de pausa detectada')).length, 1);
            assertEqual(ln.posted.filter(n => n.id === END_ID).length, 0, 'no se re-publica la 1001 ya sonada');
        });

        suite.test('Si el temporizador de la app llega ANTES que la alarma (inexacta) de Android, se publica la 1001 al instante y se cancela la programada: un solo sonido, a su hora', async () => {
            const { app, ln, clock } = await nativeApp();
            inJornada(app);
            await app.t.startPause('dinar');
            const spy = spyAudio(app);
            clock.advance(30 * M);
            app.timers.fireMatching(t => !t.interval && t.delay === 30 * M);
            await flush(10);
            assertEqual(scheduledIds(ln).length, 0, 'la programada ya no queda pendiente (no sonara otra vez)');
            const now = ln.posted.filter(n => n.id === END_ID);
            assertEqual(now.length, 1, 'publicada una vez al instante');
            assertEqual(now[0].sound, 'pause_end.wav');
            assertEqual(now[0].channelId, 'pause_end_channel_v1');
            assertEqual(spy.endPlays, 0, 'el sonido lo hace el canal');
            assertEqual(app.t.getState().alarmSource, 'background-timer');
            assertEqual(app.el('alarm-banner').style.display, 'flex');
        });

        suite.test('APK sin permiso de notificaciones: el temporizador de la app reproduce pause_end.wav UNA vez (sin bucle) con vibracion corta', async () => {
            const vibr = [];
            const { app } = await nativeApp({ ln: { permission: 'denied' } });
            app.sandbox.navigator.vibrate = (p) => { vibr.push(p); return true; };
            inJornada(app);
            await app.t.startPause('dinar');
            const spy = spyAudio(app);
            app.timers.fireMatching(t => !t.interval && t.delay === 30 * M);
            await flush(5);
            assertEqual(spy.endPlays, 1);
            assertDeepEqual(spy.loops, [false], 'sin bucle');
            assertEqual(app.fake.audio.src, 'pause_end.wav');
            assertEqual(vibr.length, 1);
            assert(vibr[0].reduce((a, b) => a + b, 0) < 1500, 'vibracion corta: ' + vibr[0]);
        });

        suite.test('Un isAlarmPlaying obsoleto persistido por una version anterior NO silencia el aviso de la pausa siguiente', async () => {
            const clock = createClock();
            const storage = createMemoryStorage();
            storage.setItem(STORAGE_KEY, JSON.stringify(baseState({
                currentState: 'JORNADA', workStartTime: new Date(clock.now - 3 * H), workDayStandard: 9,
                isAlarmPlaying: true, pauseAlarmTriggered: true, lastAlarmTime: new Date(clock.now - 1 * M), alarmSource: 'native-notification'
            })));
            const { app, ln } = await nativeApp({ clock, storage });
            assertEqual(app.t.getState().isAlarmPlaying, false, 'se descarta al cargar');
            await app.t.startPause('dinar');
            clock.advance(30 * M);
            ln.fire(END_ID);
            await flush(5);
            assertEqual(app.el('alarm-banner').style.display, 'flex', 'el aviso de ESTA pausa sale');
        });

        suite.test('Un aviso que llega cuando ya no hay pausa (SW o temporizador tardio) se ignora', async () => {
            const { app } = await nativeApp();
            inJornada(app);
            const spy = spyAudio(app);
            app.t.notifyPauseEnd('dinar', 'service-worker');
            assertEqual(spy.endPlays, 0);
            assert(app.el('alarm-banner').style.display !== 'flex');
            assertEqual(app.t.getState().pauseAlarmTriggered, false);
        });

        suite.test('Sin elemento <audio> (web) el aviso recurre al pitido de WebAudio en vez de quedar mudo', async () => {
            const clock = createClock();
            const storage = createMemoryStorage();
            storage.setItem(STORAGE_KEY, savedPauseState(clock.now, 'dinar', 30 * M));
            let beeps = 0;
            class FakeAudioContext {
                constructor() { beeps++; }
                createOscillator() { return { connect() {}, frequency: {}, start() {}, stop() {} }; }
                createGain() { return { connect() {}, gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} } }; }
                get destination() { return {}; }
                get currentTime() { return 0; }
            }
            const app = await loadScriptApp({ clock, storage, globals: { AudioContext: FakeAudioContext } });
            delete app.fake.staticById['pause-audio-player'];
            app.t.getState().pauseAlarmTriggered = false;
            app.t.notifyPauseEnd('dinar', 'background-timer');
            assertEqual(beeps, 1);
            assertEqual(app.el('alarm-banner').style.display, 'flex');
        });

        // ------------------------------------------------------------ finalizar desde la notificacion
        suite.test('Boton "Finalitzar pausa" (END_PAUSE) en la persistente: cierra la pausa como el boton de la app (fichajes P/J, SQLite, estado) y quita 1001 y 1002', async () => {
            const spyDb = dbSpy();
            const { app, ln, nat, clock } = await nativeApp({ beta10DB: spyDb.db });
            inJornada(app);
            await app.t.startPause('esmorçar');
            nat.punches.length = 0;
            clock.advance(12 * M);
            ln.tap(STATUS_ID, 'END_PAUSE');
            await flush(30);
            const s = app.t.getState();
            assertEqual(s.currentState, 'JORNADA');
            assertEqual(s.currentPauseStart, null);
            assertEqual(Math.round(s.totalPauseTimeToday / M), 12);
            assertDeepEqual(punchesOf(nat), ['salida:P', 'entrada:J']);
            assertEqual(spyDb.calls.pausa.length, 1);
            assertEqual(spyDb.calls.pausa[0].type, 'esmorçar');
            assertEqual(Math.round(spyDb.calls.pausa[0].durationMinutes), 12);
            assertEqual(ln.scheduled.length, 0, 'sin aviso de fin pendiente');
            assertEqual(ln.delivered.length, 0, 'bandeja limpia');
            assert(ln.removedDelivered.includes(STATUS_ID) && ln.removedDelivered.includes(END_ID));
            assertEqual(JSON.parse(app.storage.getItem(STORAGE_KEY)).currentState, 'JORNADA');
        });

        suite.test('END_PAUSE desde la notificacion de FIN (1001) tambien cierra la pausa', async () => {
            const { app, ln, nat, clock } = await nativeApp();
            inJornada(app);
            await app.t.startPause('dinar');
            nat.punches.length = 0;
            clock.advance(31 * M);
            ln.fire(END_ID);
            await flush(5);
            ln.tap(END_ID, 'END_PAUSE');
            await flush(30);
            assertEqual(app.t.getState().currentState, 'JORNADA');
            assertDeepEqual(punchesOf(nat), ['salida:P', 'entrada:J']);
            assertEqual(ln.delivered.length, 0);
            assertEqual(app.el('alarm-banner').style.display, 'none');
        });

        suite.test('Doble pulsacion de END_PAUSE (o END_PAUSE + boton de la app a la vez): un solo cierre, sin fichajes duplicados', async () => {
            const spyDb = dbSpy();
            const { app, ln, nat } = await nativeApp({ beta10DB: spyDb.db });
            inJornada(app);
            await app.t.startPause('dinar');
            nat.punches.length = 0;
            ln.tap(STATUS_ID, 'END_PAUSE');
            ln.tap(STATUS_ID, 'END_PAUSE');
            const p = app.t.endPause();
            await p;
            await flush(30);
            assertDeepEqual(punchesOf(nat), ['salida:P', 'entrada:J']);
            assertEqual(spyDb.calls.pausa.length, 1);
            assertEqual(app.t.getState().currentState, 'JORNADA');
        });

        suite.test('Arranque en frio por "Finalitzar pausa" con la app cerrada: la pausa se cierra UNA vez y la reprogramacion del arranque no deja notificaciones, keep-alive ni avisos falsos', async () => {
            const clock = createClock();
            const storage = createMemoryStorage();
            storage.setItem(STORAGE_KEY, savedPauseState(clock.now, 'dinar', 10 * M));
            const spyDb = dbSpy();
            const { app, ln, nat } = await nativeApp({
                clock, storage, beta10DB: spyDb.db,
                ln: { retainedAction: { actionId: 'END_PAUSE', notification: { id: STATUS_ID } } }
            });
            await flush(40);
            assertEqual(app.t.getState().currentState, 'JORNADA');
            assertDeepEqual(punchesOf(nat), ['salida:P', 'entrada:J']);
            assertEqual(spyDb.calls.pausa.length, 1);
            assertEqual(ln.delivered.length, 0, 'sin persistente: ' + JSON.stringify(ln.delivered.map(n => n.id)));
            assertEqual(ln.scheduled.length, 0, 'sin aviso de fin');
            assert(!sessionTimerDelays(app).includes(20 * M), 'sin temporizador de fin huerfano');
            assert(!app.el('info-message').textContent.includes("No s'ha pogut reprogramar"), app.el('info-message').textContent);
        });

        suite.test('END_PAUSE cuando ya no hay pausa (notificacion vieja): se ignora, sin fichajes, y se limpia la bandeja', async () => {
            const { app, ln, nat } = await nativeApp();
            inJornada(app);
            ln.delivered.push({ id: STATUS_ID, ongoing: true });
            ln.tap(STATUS_ID, 'END_PAUSE');
            await flush(20);
            assertEqual(nat.punches.length, 0);
            assertEqual(app.t.getState().currentState, 'JORNADA');
            assert(app.logTexts().some(t => t.includes('ignorat')));
            assertEqual(ln.delivered.length, 0);
        });

        suite.test('END_PAUSE sin red: la pausa local se cierra igual y la vuelta queda en la cola offline', async () => {
            const clock = createClock();
            const nat = nativeGlobals(clock, {});
            let fail = false;
            const exec = nat.globals.Beta10Direct.executeFichaje;
            nat.globals.Beta10Direct.executeFichaje = async (...a) => { if (fail) throw new Error('Unable to resolve host'); return exec(...a); };
            const app = await loadScriptApp({ clock, globals: nat.globals });
            inJornada(app);
            await app.t.startPause('dinar');
            fail = true;
            nat.ln.tap(STATUS_ID, 'END_PAUSE');
            await flush(40);
            assertEqual(app.t.getState().currentState, 'JORNADA');
            const pending = app.t.getPendingSync();
            const list = Array.isArray(pending) ? pending : [pending];
            assert(list.some(x => x && x.type === 'END_PAUSE'), 'vuelta de pausa en cola: ' + JSON.stringify(pending));
            assertEqual(nat.ln.delivered.length, 0);
        });

        suite.test('Tocar el cuerpo de la persistente (el plugin la quita) la vuelve a publicar mientras dure la pausa, sin cerrar nada', async () => {
            const { app, ln, nat } = await nativeApp();
            inJornada(app);
            await app.t.startPause('dinar');
            nat.punches.length = 0;
            ln.tap(STATUS_ID); // el plugin la quita de la bandeja al tocarla
            await flush(10);
            assert(delivered(ln, STATUS_ID), 'republicada');
            assertEqual(app.t.getState().currentState, 'PAUSA');
            assertEqual(nat.punches.length, 0);
            assertDeepEqual(scheduledIds(ln), [END_ID]);
        });

        suite.test('Carrera: END_PAUSE mientras la vuelta a primer plano esta re-publicando la persistente => no queda ninguna notificacion huerfana', async () => {
            let gate = null;
            let arm = false;
            const opts = { beforeSchedule: async (n) => { if (arm && n.id === STATUS_ID) { arm = false; await new Promise(r => { gate = r; }); } } };
            const { app, ln } = await nativeApp({ ln: opts });
            inJornada(app);
            await app.t.startPause('dinar');
            arm = true;
            app.fake.document.hidden = false;
            (app.fake.document.listeners.visibilitychange || []).forEach(fn => fn());
            await flush(5);
            assert(gate, 're-publicacion en vuelo');
            const ending = app.t.endPause();
            await flush(5);
            gate();
            await ending;
            await flush(30);
            assertEqual(app.t.getState().currentState, 'JORNADA');
            assertEqual(ln.delivered.length, 0, 'sin persistente huerfana: ' + JSON.stringify(ln.delivered.map(n => n.id)));
            assertEqual(ln.scheduled.length, 0, 'sin aviso de fin pendiente');
        });

        suite.test('endPause (boton de la app) quita 1001 y 1002, para el audio, borra el temporizador de sesion y el mensaje', async () => {
            const { app, ln } = await nativeApp();
            const spy = spyAudio(app);
            inJornada(app);
            await app.t.startPause('dinar');
            assert(sessionTimerDelays(app).includes(30 * M));
            await app.t.endPause();
            await flush(5);
            assertEqual(ln.scheduled.length, 0);
            assertEqual(ln.delivered.length, 0);
            assert(ln.removedDelivered.includes(END_ID) && ln.removedDelivered.includes(STATUS_ID));
            assert(!sessionTimerDelays(app).includes(30 * M), 'temporizador cancelado');
            assert(spy.paused >= 1, 'audio detenido');
            assertEqual(app.t.getState().currentState, 'JORNADA');
            assertEqual(app.el('info-message').textContent, '');
        });

        suite.test('Finalizar la JORNADA estando en pausa tambien quita la persistente y el aviso de fin', async () => {
            const { app, ln, nat } = await nativeApp();
            inJornada(app);
            await app.t.startPause('dinar');
            nat.punches.length = 0;
            await app.t.endWorkday(false);
            await flush(30);
            assertEqual(app.t.getState().currentState, 'FUERA');
            assertDeepEqual(punchesOf(nat), ['salida:P', 'entrada:J', 'salida:J']);
            assertEqual(ln.scheduled.length, 0);
            assertEqual(ln.delivered.length, 0);
        });

        // ------------------------------------------------------------ reabrir / reinicio
        suite.test('Reabrir a mitad de pausa: re-publica la persistente y reprograma la 1001 con el tiempo RESTANTE (10 min)', async () => {
            const clock = createClock();
            const storage = createMemoryStorage();
            storage.setItem(STORAGE_KEY, savedPauseState(clock.now, 'dinar', 20 * M));
            const { app, ln } = await nativeApp({ clock, storage });
            assertDeepEqual(scheduledIds(ln), [END_ID]);
            assertEqual(ln.scheduled[0].atMs, clock.now + 10 * M);
            assert(delivered(ln, STATUS_ID), 'persistente visible tras reabrir / reiniciar el movil');
            const delays = sessionTimerDelays(app);
            assert(delays.includes(10 * M), 'temporizador a 10 min: ' + delays);
            assert(!delays.includes(30 * M));
            assert(app.el('info-message').textContent.includes('Pausa dinar activa'));
        });

        suite.test('Volver al primer plano: re-publica la persistente (Android 14 permite deslizarla), no duplica la 1001 si sigue programada y la reprograma si desaparecio', async () => {
            const clock = createClock();
            const storage = createMemoryStorage();
            storage.setItem(STORAGE_KEY, savedPauseState(clock.now, 'dinar', 20 * M));
            const { app, ln } = await nativeApp({ clock, storage });
            const fire = async () => { (app.fake.document.listeners.visibilitychange || []).forEach(fn => fn()); await flush(10); };
            app.fake.document.hidden = false;

            ln.delivered = ln.delivered.filter(n => n.id !== STATUS_ID); // el usuario la deslizo
            const endPostsBefore = ln.scheduleCalls;
            await fire();
            assert(delivered(ln, STATUS_ID), 'persistente recuperada');
            assertEqual(ln.scheduleCalls, endPostsBefore + 1, 'solo se republica la persistente; la 1001 sigue pendiente');
            assertDeepEqual(scheduledIds(ln), [END_ID]);

            ln.scheduled = [];
            await fire();
            assertDeepEqual(scheduledIds(ln), [END_ID], 'reprogramada');
            assertEqual(ln.scheduled[0].atMs, clock.now + 10 * M);
            await fire();
            assertEqual(ln.scheduled.length, 1, 'nunca duplicada');
            assertEqual(ln.delivered.filter(n => n.id === STATUS_ID).length, 1, 'persistente nunca duplicada');
        });

        suite.test('Reabrir con la pausa ya vencida: SIN sonido retroactivo, sin programar la 1001, persistente "esgotat" y aviso visible', async () => {
            const clock = createClock();
            const storage = createMemoryStorage();
            storage.setItem(STORAGE_KEY, savedPauseState(clock.now, 'esmorçar', 45 * M));
            const { app, ln } = await nativeApp({ clock, storage });
            assertEqual(ln.scheduled.length, 0);
            assertEqual(ln.posted.filter(n => n.id === END_ID).length, 0, 'ningun aviso de fin publicado');
            assert(app.fake.audio.src !== 'pause_end.wav' && app.fake.audio.src !== 'alarm.wav', 'no suena nada');
            assert(app.el('alarm-banner').style.display !== 'flex');
            assert(delivered(ln, STATUS_ID).body.includes('esgotat'));
            const info = app.el('info-message');
            assert(info.textContent.includes('ja ha superat'), info.textContent);
            assert(info.classList.contains('alert'));
        });

        suite.test('Reabrir mid-pausa con notificaciones denegadas: avisa de que el aviso en segundo plano no se pudo reprogramar', async () => {
            const clock = createClock();
            const storage = createMemoryStorage();
            storage.setItem(STORAGE_KEY, savedPauseState(clock.now, 'dinar', 20 * M));
            const { app, ln } = await nativeApp({ clock, storage, ln: { permission: 'denied' } });
            assertEqual(ln.scheduled.length, 0);
            assertEqual(ln.delivered.length, 0);
            assert(app.el('info-message').textContent.includes('No s\'ha pogut reprogramar'), app.el('info-message').textContent);
        });

        suite.test('resumeActivePause tras startPause no duplica nada (mismos ids)', async () => {
            const { app, ln } = await nativeApp();
            inJornada(app);
            await app.t.startPause('dinar');
            await app.t.resumeActivePause();
            assertEqual(ln.scheduled.length, 1);
            assertEqual(ln.delivered.filter(n => n.id === STATUS_ID).length, 1);
        });

        // ------------------------------------------------------------ pausa cerrada por autocorreccion
        suite.test('Una pausa auto-cerrada por >1h tambien quita la persistente y el aviso de fin pendiente', async () => {
            const clock = createClock();
            const { app, ln } = await nativeApp({ clock });
            inJornada(app);
            await app.t.startPause('dinar');
            assertEqual(ln.scheduled.length, 1);
            clock.advance(2 * H);
            assertEqual(app.t.validateAppState(), true);
            await flush(10);
            assertEqual(ln.scheduled.length, 0);
            assertEqual(ln.delivered.length, 0);
            assert(!sessionTimerDelays(app).includes(30 * M));
        });

        suite.test('Estado inconsistente (PAUSA sin inicio de jornada) => reset a FUERA y bandeja limpia (antes quedaba huerfana)', async () => {
            const { app, ln } = await nativeApp();
            inJornada(app);
            await app.t.startPause('dinar');
            app.t.getState().workStartTime = null;
            assertEqual(app.t.validateAppState(), true);
            await flush(10);
            assertEqual(app.t.getState().currentState, 'FUERA');
            assertEqual(ln.scheduled.length, 0);
            assertEqual(ln.delivered.length, 0);
        });

        suite.test('Estado inconsistente (PAUSA sin inicio de pausa) => vuelta a JORNADA y bandeja limpia', async () => {
            const { app, ln } = await nativeApp();
            inJornada(app);
            await app.t.startPause('dinar');
            app.t.getState().currentPauseStart = null;
            assertEqual(app.t.validateAppState(), true);
            await flush(10);
            assertEqual(app.t.getState().currentState, 'JORNADA');
            assertEqual(ln.scheduled.length, 0);
            assertEqual(ln.delivered.length, 0);
        });

        // ------------------------------------------------------------ Web / PWA
        const webNavigator = (serviceWorker) => ({ serviceWorker });
        const grantedNotification = () => {
            const n = function Notification() { throw new TypeError("Failed to construct 'Notification': Illegal constructor. Use ServiceWorkerRegistration.showNotification() instead."); };
            n.permission = 'granted';
            n.requestPermission = async () => 'granted';
            return n;
        };

        suite.test('Web: si el service worker no esta listo (ready nunca se resuelve) startPause NO se cuelga: acaba y avisa', async () => {
            const app = await loadScriptApp({
                navigator: webNavigator({ ready: new Promise(() => {}), register: () => Promise.reject(new Error('sin https')), addEventListener() {} }),
                globals: { Notification: grantedNotification() }
            });
            inJornada(app);
            const p = app.t.startPause('dinar');
            for (let i = 0; i < 60 && !app.timers.pending().some(t => !t.interval && t.delay === 3000); i++) await flush(2);
            app.timers.fireMatching(t => !t.interval && t.delay === 3000);
            await p;
            assertEqual(app.t.getState().currentState, 'PAUSA');
            const info = app.el('info-message');
            assert(info.textContent.includes('NO s\'ha pogut programar'), info.textContent);
            assert(info.textContent.includes('service worker'));
            assert(info.classList.contains('alert'));
        });

        suite.test('Web: con SW activo se programa por postMessage con el retardo exacto y endPause envia CANCEL_NOTIFICATION', async () => {
            const messages = [];
            const registration = { active: { postMessage: (m) => messages.push(m) } };
            const app = await loadScriptApp({
                navigator: webNavigator({ ready: Promise.resolve(registration), register: () => Promise.resolve(registration), addEventListener() {} }),
                globals: { Notification: grantedNotification() }
            });
            inJornada(app);
            await app.t.startPause('dinar');
            const sched = messages.find(m => m.type === 'SCHEDULE_NOTIFICATION');
            assert(sched);
            assertEqual(sched.pauseType, 'dinar');
            assertEqual(sched.delayMs, 30 * M);
            assertEqual(sched.timeLimit, 30);
            await app.t.endPause();
            assert(messages.some(m => m.type === 'CANCEL_NOTIFICATION'));
        });

        suite.test('Web: fin de pausa => pause_end.wav UNA vez (sin bucle), notificacion corta (sin requireInteraction) y banner, aunque Notification lance "Illegal constructor"', async () => {
            const shown = [];
            const registration = { active: { postMessage() {} }, showNotification: async (title, options) => { shown.push({ title, options }); } };
            const clock = createClock();
            const storage = createMemoryStorage();
            storage.setItem(STORAGE_KEY, savedPauseState(clock.now, 'dinar', 1 * M));
            const app = await loadScriptApp({
                clock, storage,
                navigator: webNavigator({ ready: Promise.resolve(registration), register: () => Promise.resolve(registration), addEventListener() {} }),
                globals: { Notification: grantedNotification() }
            });
            const spy = spyAudio(app);
            app.t.notifyPauseEnd('dinar', 'service-worker');
            await flush(10);
            assertEqual(spy.endPlays, 1);
            assertDeepEqual(spy.loops, [false]);
            assertEqual(app.el('alarm-banner').style.display, 'flex');
            assertEqual(shown.length, 1);
            assertEqual(shown[0].options.tag, 'pause-end');
            assertEqual(shown[0].options.requireInteraction, false);

            const reg2 = { active: { postMessage() {} } };
            const storage2 = createMemoryStorage();
            storage2.setItem(STORAGE_KEY, savedPauseState(clock.now, 'dinar', 1 * M));
            const app2 = await loadScriptApp({
                clock, storage: storage2,
                navigator: webNavigator({ ready: Promise.resolve(reg2), register: () => Promise.resolve(reg2), addEventListener() {} }),
                globals: { Notification: grantedNotification() }
            });
            app2.t.notifyPauseEnd('dinar', 'service-worker');
            await flush(10);
            assertEqual(app2.el('alarm-banner').style.display, 'flex');
        });

        suite.test('Web sin API Notification (Safari iOS): el aviso suena y el banner sale sin ReferenceError', async () => {
            const clock = createClock();
            const storage = createMemoryStorage();
            storage.setItem(STORAGE_KEY, savedPauseState(clock.now, 'dinar', 1 * M));
            const app = await loadScriptApp({ clock, storage, globals: { Notification: undefined } });
            const spy = spyAudio(app);
            app.t.notifyPauseEnd('dinar', 'background-timer');
            await flush(5);
            assertEqual(spy.endPlays, 1);
            assertEqual(app.el('alarm-banner').style.display, 'flex');
        });

        suite.test('Web: permiso de notificaciones denegado -> no se vuelve a pedir y se avisa de que solo sonara con la pestana abierta', async () => {
            let requests = 0;
            const registration = { active: { postMessage() {} } };
            const app = await loadScriptApp({
                navigator: webNavigator({ ready: Promise.resolve(registration), register: () => Promise.resolve(registration), addEventListener() {} }),
                globals: { Notification: { permission: 'denied', requestPermission: async () => { requests++; return 'denied'; } } }
            });
            assertEqual(requests, 0);
            inJornada(app);
            await app.t.startPause('dinar');
            assertEqual(requests, 0);
            const info = app.el('info-message');
            assert(info.textContent.includes('Notificacions denegades'), info.textContent);
            assert(info.classList.contains('alert'));
        });
    });
};
