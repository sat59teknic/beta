/**
 * scripts/tests/test-pause-alarms-real.js
 * Notificaciones y alarmas de pausa ejecutando el script.js REAL (vm + DOM falso) con un
 * LocalNotifications simulado que reproduce el comportamiento relevante del plugin Android real
 * (permiso POST_NOTIFICATIONS, alarma exacta, programaciones descartadas en silencio, mismo id => reemplaza).
 *
 * Sustituye en la practica a las "replicas" de test-alarm-and-notifications.js, que probaban copias
 * de la logica y no el codigo de la app. Cero red real.
 */

const { assert, assertEqual, assertDeepEqual } = require('../test-harness.js');
const {
    createClock, createMemoryStorage, loadScriptApp, nativeGlobals, flush
} = require('../test-fake-app.js');

const H = 3600 * 1000;
const M = 60 * 1000;
const STORAGE_KEY = 'beta10AppState';

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

async function nativeApp(opts = {}) {
    const clock = opts.clock || createClock();
    const nat = nativeGlobals(clock, opts.ln || {}, opts.extraGlobals || {});
    const app = await loadScriptApp({ clock, storage: opts.storage, globals: nat.globals, beta10DB: opts.beta10DB });
    return { app, nat, clock, ln: nat.ln };
}

const inJornada = (app) => app.t.setState(baseState({
    currentState: 'JORNADA', workStartTime: new Date(app.clock.now - 2 * H), workDayStandard: 9, workDayType: 'Dilluns-Dijous'
}));

// Cuenta las reproducciones de alarm.wav del <audio> falso
function spyAudio(app) {
    const spy = { alarmPlays: 0, paused: 0 };
    app.fake.audio.play = async function () { if (this.src === 'alarm.wav') spy.alarmPlays++; };
    app.fake.audio.pause = () => { spy.paused++; };
    return spy;
}

const sessionTimerDelays = (app) => app.timers.pending().filter(t => !t.interval).map(t => t.delay);

module.exports = function registerPauseAlarmsRealTests(runner) {
    runner.suite('Alarmas y notificaciones de pausa (codigo real + plugin Android simulado)', async (suite) => {

        // ------------------------------------------------------------ canal, permisos
        suite.test('Canal v4 con sonido/importancia maxima/vibracion/pantalla bloqueada, canales viejos borrados, accion STOP_ALARM y listeners registrados', async () => {
            const { ln } = await nativeApp();
            assertEqual(ln.channels.length, 1);
            const ch = ln.channels[0];
            assertEqual(ch.id, 'pause_alarm_channel_v4');
            assertEqual(ch.importance, 5);
            assertEqual(ch.sound, 'alarm.wav');
            assertEqual(ch.vibration, true);
            assertEqual(ch.visibility, 1);
            assertDeepEqual(ln.deleted.sort(), ['pause_alarm_channel', 'pause_alarm_channel_v2', 'pause_alarm_channel_v3'].sort(), 'canales antiguos (inmutables, pueden estar mudos) se eliminan');
            assertEqual(ln.actionTypes[0].id, 'PAUSE_ALARM_ACTIONS');
            assertEqual(ln.actionTypes[0].actions[0].id, 'STOP_ALARM');
            assertEqual((ln.listeners.localNotificationReceived || []).length, 1);
            assertEqual((ln.listeners.localNotificationActionPerformed || []).length, 1);
        });

        suite.test('Si el usuario ha silenciado el canal en Ajustes de Android (importancia < 3) se avisa visiblemente', async () => {
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

            // Segunda apertura de la app: sigue denegado, pero no se vuelve a preguntar
            const second = await nativeApp({ storage, extraGlobals, ln: { exact: 'denied' } });
            assertEqual(confirms.length, 1, 'sin segundo confirm');
            assertEqual(second.ln.exactChangeCalls, 0);
            inJornada(second.app);
            await second.app.t.startPause('dinar');
            const info = second.app.el('info-message');
            assertEqual(second.ln.scheduled.length, 1, 'se programa igualmente (inexacta)');
            assert(info.textContent.includes('endarrerir'), 'avisa del posible retraso: ' + info.textContent);
            assert(info.classList.contains('alert'));
        });

        // ------------------------------------------------------------ programar al iniciar la pausa
        suite.test('startPause programa UNA alarma id 1001 a +30 min exactos con allowWhileIdle, canal v4, icono monocromo y accion de parar', async () => {
            const { app, ln, clock } = await nativeApp();
            inJornada(app);
            await app.t.startPause('dinar');
            assertEqual(ln.scheduled.length, 1);
            const n = ln.scheduled[0];
            assertEqual(n.id, 1001);
            assertEqual(n.atMs, clock.now + 30 * M);
            assertEqual(n.schedule.allowWhileIdle, true, 'sobrevive a Doze');
            assertEqual(n.channelId, 'pause_alarm_channel_v4');
            assertEqual(n.smallIcon, 'ic_stat_pause_alarm');
            assertEqual(n.sound, 'alarm.wav');
            assertEqual(n.actionTypeId, 'PAUSE_ALARM_ACTIONS');
            assertEqual(app.t.getState().currentState, 'PAUSA');
            // El estado de la pausa ya esta persistido (antes se guardaba al final de varios await)
            assertEqual(JSON.parse(app.storage.getItem(STORAGE_KEY)).currentState, 'PAUSA');
        });

        suite.test('startPause esmorzar programa a +15 min', async () => {
            const { app, ln, clock } = await nativeApp();
            inJornada(app);
            await app.t.startPause('esmorçar');
            assertEqual(ln.scheduled[0].atMs, clock.now + 15 * M);
            assert(ln.scheduled[0].body.includes('15 minuts'));
        });

        suite.test('El mensaje informativo de la pausa NO se borra al regenerar los botones ni en el siguiente tick del intervalo (antes desaparecia a la vez)', async () => {
            const { app } = await nativeApp();
            inJornada(app);
            await app.t.startPause('dinar');
            const info = app.el('info-message');
            assert(info.textContent.includes('Pausa dinar iniciada'), info.textContent);
            app.t.updateUI();
            app.timers.pending().filter(t => t.interval).forEach(t => t.fn()); // un tick de los intervalos de la app
            assert(info.textContent.includes('Pausa dinar iniciada'), 'sigue visible: ' + info.textContent);
            assert(info.classList.contains('success'));
            assert(!info.classList.contains('alert'));
        });

        suite.test('Sin permiso POST_NOTIFICATIONS: la pausa empieza pero el usuario ve un aviso rojo claro (antes solo una linea en el registro)', async () => {
            const { app, ln } = await nativeApp({ ln: { permission: 'denied' } });
            inJornada(app);
            await app.t.startPause('dinar');
            const info = app.el('info-message');
            assertEqual(ln.scheduled.length, 0);
            assertEqual(app.t.getState().currentState, 'PAUSA');
            assert(info.textContent.includes('NO s\'ha pogut programar'), info.textContent);
            assert(info.textContent.includes('permís de notificacions denegat'));
            assert(info.classList.contains('alert'));
            assert(app.logTexts().some(t => t.includes('NO garantida')));
        });

        suite.test('La programacion se VERIFICA con getPending: si Android la descarta en silencio (hora pasada) se detecta', async () => {
            const { app, ln } = await nativeApp();
            const outcome = await app.t.scheduleNotification('dinar', -1000);
            assertEqual(outcome.ok, false);
            assertEqual(outcome.reason, 'not-pending');
            assertEqual(ln.dropped.length, 1);
        });

        suite.test('Si el permiso se revoca despues de abrir la app, scheduleNotification lo detecta y avisa', async () => {
            const { app, ln } = await nativeApp();
            inJornada(app);
            ln.permission = 'denied'; // el usuario lo quita desde Ajustes con la app abierta
            await app.t.startPause('dinar');
            assertEqual(app.t.notificationStatus.permission, 'denied');
            assert(app.el('info-message').textContent.includes('NO s\'ha pogut programar'));
        });

        // ------------------------------------------------------------ cancelar al terminar
        suite.test('endPause cancela la alarma nativa y la notificacion ya entregada, para el audio, borra el temporizador de sesion y el mensaje', async () => {
            const { app, ln } = await nativeApp();
            const spy = spyAudio(app);
            inJornada(app);
            await app.t.startPause('dinar');
            assert(sessionTimerDelays(app).includes(30 * M), 'temporizador de sesion armado a 30 min');
            await app.t.endPause();
            assertEqual(ln.scheduled.length, 0, 'no queda alarma programada');
            assert(ln.removedDelivered.includes(1001), 'ni notificacion en la barra');
            assert(!sessionTimerDelays(app).includes(30 * M), 'temporizador cancelado');
            assert(spy.paused >= 1, 'audio detenido');
            assertEqual(app.t.getState().currentState, 'JORNADA');
            assertEqual(app.el('info-message').textContent, '', 'el aviso de pausa se limpia al volver');
        });

        // ------------------------------------------------------------ reabrir / reinicio
        suite.test('Reabrir a mitad de pausa reprograma con el tiempo RESTANTE (10 min) y arma el temporizador de sesion con ese resto, no con 30 min', async () => {
            const clock = createClock();
            const storage = createMemoryStorage();
            storage.setItem(STORAGE_KEY, savedPauseState(clock.now, 'dinar', 20 * M));
            const { app, ln } = await nativeApp({ clock, storage });
            assertEqual(ln.scheduled.length, 1);
            assertEqual(ln.scheduled[0].atMs, clock.now + 10 * M);
            const delays = sessionTimerDelays(app);
            assert(delays.includes(10 * M), 'temporizador a 10 min: ' + delays);
            assert(!delays.includes(30 * M), 'ya no se rearma con el limite completo (segunda alarma tardia/duplicada)');
            assert(app.el('info-message').textContent.includes('Pausa dinar activa'));
        });

        suite.test('Reabrir y volver al primer plano: no duplica la alarma si sigue programada y la reprograma si ha desaparecido (reinicio del movil, datos borrados)', async () => {
            const clock = createClock();
            const storage = createMemoryStorage();
            storage.setItem(STORAGE_KEY, savedPauseState(clock.now, 'dinar', 20 * M));
            const { app, ln } = await nativeApp({ clock, storage });
            const fire = async () => { (app.fake.document.listeners.visibilitychange || []).forEach(fn => fn()); await flush(10); };
            app.fake.document.hidden = false;

            const before = ln.scheduleCalls;
            await fire();
            assertEqual(ln.scheduleCalls, before, 'sigue pendiente: no se reprograma (sin churn ni duplicados)');
            assertEqual(ln.scheduled.length, 1);

            ln.scheduled = []; // desaparece (p. ej. restauracion tras reinicio que no la recupero)
            await fire();
            assertEqual(ln.scheduled.length, 1, 'reprogramada');
            assertEqual(ln.scheduled[0].atMs, clock.now + 10 * M);
            await fire();
            assertEqual(ln.scheduled.length, 1, 'nunca duplicada (mismo id)');
        });

        suite.test('Reabrir con la pausa ya vencida: SIN sonido retroactivo, sin programar nada y con aviso visible', async () => {
            const clock = createClock();
            const storage = createMemoryStorage();
            storage.setItem(STORAGE_KEY, savedPauseState(clock.now, 'esmorçar', 45 * M));
            const { app, ln } = await nativeApp({ clock, storage });
            assertEqual(ln.scheduled.length, 0);
            assert(app.fake.audio.src !== 'alarm.wav', 'no suena la alarma');
            assert(app.el('alarm-banner').style.display !== 'flex', 'ni banner de alarma sonando');
            const info = app.el('info-message');
            assert(info.textContent.includes('ja ha superat'), info.textContent);
            assert(info.classList.contains('alert'));
            assertEqual(app.t.getState().isAlarmPlaying, false);
        });

        suite.test('Reabrir mid-pausa con notificaciones denegadas: avisa de que la alarma en segundo plano no se pudo reprogramar', async () => {
            const clock = createClock();
            const storage = createMemoryStorage();
            storage.setItem(STORAGE_KEY, savedPauseState(clock.now, 'dinar', 20 * M));
            const { app, ln } = await nativeApp({ clock, storage, ln: { permission: 'denied' } });
            assertEqual(ln.scheduled.length, 0);
            assert(app.el('info-message').textContent.includes('No s\'ha pogut reprogramar'), app.el('info-message').textContent);
        });

        suite.test('Reiniciar resumeActivePause (reapertura) no duplica la alarma ya programada por startPause', async () => {
            const { app, ln } = await nativeApp();
            inJornada(app);
            await app.t.startPause('dinar');
            await app.t.resumeActivePause();
            assertEqual(ln.scheduled.length, 1);
        });

        // ------------------------------------------------------------ sonar y silenciar
        suite.test('localNotificationReceived hace sonar alarm.wav en bucle con banner; la accion STOP_ALARM la silencia; el estado transitorio no se persiste', async () => {
            const clock = createClock();
            const storage = createMemoryStorage();
            storage.setItem(STORAGE_KEY, savedPauseState(clock.now, 'dinar', 1 * M));
            const { app, ln } = await nativeApp({ clock, storage });
            const spy = spyAudio(app);
            ln.emit('localNotificationReceived', { title: '⏰ Temps de pausa completat!' });
            assertEqual(app.el('alarm-banner').style.display, 'flex');
            assertEqual(app.fake.audio.src, 'alarm.wav');
            assertEqual(app.fake.audio.loop, true);
            assertEqual(spy.alarmPlays, 1);
            assertEqual(app.t.getState().isAlarmPlaying, true);
            const persisted = JSON.parse(storage.getItem(STORAGE_KEY));
            assertEqual(persisted.pauseAlarmTriggered, true, 'la alarma ya disparada si se persiste');
            assert(!persisted.isAlarmPlaying && !persisted.alarmSource, 'lo transitorio no');

            ln.emit('localNotificationActionPerformed', { actionId: 'STOP_ALARM' });
            assertEqual(app.el('alarm-banner').style.display, 'none');
            assertEqual(app.t.getState().isAlarmPlaying, false);
            assert(spy.paused >= 1, 'audio parado');
        });

        suite.test('Tocar la notificacion (sin boton) solo para la alarma si ya esta sonando', async () => {
            const clock = createClock();
            const storage = createMemoryStorage();
            storage.setItem(STORAGE_KEY, savedPauseState(clock.now, 'dinar', 1 * M));
            const { app, ln } = await nativeApp({ clock, storage });
            const cancelsBefore = ln.cancelCalls;
            ln.emit('localNotificationActionPerformed', { actionId: 'tap' });
            assertEqual(ln.cancelCalls, cancelsBefore, 'sin alarma sonando no se toca nada');
            assertEqual(ln.scheduled.length, 1, 'la alarma programada sigue ahi');

            ln.emit('localNotificationReceived', { title: 'x' });
            assertEqual(app.t.getState().isAlarmPlaying, true);
            ln.emit('localNotificationActionPerformed', { actionId: 'tap' });
            assertEqual(app.t.getState().isAlarmPlaying, false);
        });

        suite.test('Disparo duplicado: notificacion nativa + temporizador + ventana del contador de la UI hacen sonar UNA sola vez', async () => {
            const clock = createClock();
            const storage = createMemoryStorage();
            storage.setItem(STORAGE_KEY, savedPauseState(clock.now, 'dinar', 1 * M));
            const { app } = await nativeApp({ clock, storage });
            const spy = spyAudio(app);
            app.t.playPauseAlarm('dinar', 'native-notification');
            app.t.playPauseAlarm('dinar', 'background-timer');
            app.t.playPauseAlarm('dinar', 'timer-limit');
            assertEqual(spy.alarmPlays, 1);
            assertEqual(app.logTexts().filter(t => t.includes('ignorando disparo')).length, 2);
        });

        suite.test('Tras silenciar, un disparo tardio dentro de 5 min no vuelve a sonar; pasados 5 min si (regla de recurrencia documentada)', async () => {
            const clock = createClock();
            const storage = createMemoryStorage();
            storage.setItem(STORAGE_KEY, savedPauseState(clock.now, 'dinar', 1 * M));
            const { app } = await nativeApp({ clock, storage });
            const spy = spyAudio(app);
            app.t.playPauseAlarm('dinar', 'native-notification');
            app.t.stopAlarm();
            app.t.playPauseAlarm('dinar', 'background-timer');
            assertEqual(spy.alarmPlays, 1);
            assert(app.el('alarm-banner').style.display !== 'flex');
            clock.advance(6 * M);
            app.t.playPauseAlarm('dinar', 'background-timer');
            assertEqual(spy.alarmPlays, 2);
        });

        suite.test('Un isAlarmPlaying obsoleto persistido por una version anterior NO silencia las alarmas de la pausa siguiente', async () => {
            const clock = createClock();
            const storage = createMemoryStorage();
            storage.setItem(STORAGE_KEY, JSON.stringify(baseState({
                currentState: 'JORNADA', workStartTime: new Date(clock.now - 3 * H), workDayStandard: 9,
                isAlarmPlaying: true, pauseAlarmTriggered: true, lastAlarmTime: new Date(clock.now - 1 * M), alarmSource: 'native-notification'
            })));
            const { app, ln } = await nativeApp({ clock, storage });
            assertEqual(app.t.getState().isAlarmPlaying, false, 'se descarta al cargar');
            await app.t.startPause('dinar');
            const spy = spyAudio(app);
            ln.emit('localNotificationReceived', { title: 'x' });
            assertEqual(spy.alarmPlays, 1, 'la alarma de ESTA pausa suena');
            assertEqual(app.el('alarm-banner').style.display, 'flex');
        });

        suite.test('El temporizador de sesion (armado al iniciar la pausa) dispara la alarma al cumplirse si la app esta viva', async () => {
            const { app } = await nativeApp();
            inJornada(app);
            await app.t.startPause('dinar');
            const spy = spyAudio(app);
            app.timers.fireMatching(t => !t.interval && t.delay === 30 * M);
            assertEqual(spy.alarmPlays, 1);
            assertEqual(app.t.getState().alarmSource, 'background-timer');
            assertEqual(app.el('alarm-banner').style.display, 'flex');
        });

        suite.test('Una alarma que llega cuando ya no hay pausa (SW o temporizador tardio) se ignora', async () => {
            const { app } = await nativeApp();
            inJornada(app);
            const spy = spyAudio(app);
            app.t.playPauseAlarm('dinar', 'service-worker');
            assertEqual(spy.alarmPlays, 0);
            assertEqual(app.t.getState().isAlarmPlaying, false);
            assert(app.el('alarm-banner').style.display !== 'flex');
        });

        suite.test('Sin elemento <audio> la alarma recurre al pitido de WebAudio en vez de quedar muda', async () => {
            const clock = createClock();
            const storage = createMemoryStorage();
            storage.setItem(STORAGE_KEY, savedPauseState(clock.now, 'dinar', 1 * M));
            let beeps = 0;
            class FakeAudioContext {
                constructor() { beeps++; }
                createOscillator() { return { connect() {}, frequency: {}, start() {}, stop() {} }; }
                createGain() { return { connect() {}, gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} } }; }
                get destination() { return {}; }
                get currentTime() { return 0; }
            }
            const { app } = await nativeApp({ clock, storage, extraGlobals: { AudioContext: FakeAudioContext } });
            delete app.fake.staticById['pause-audio-player'];
            app.t.playPauseAlarm('dinar', 'native-notification');
            assertEqual(beeps, 1);
            assertEqual(app.el('alarm-banner').style.display, 'flex');
        });

        // ------------------------------------------------------------ pausa auto-cerrada
        suite.test('Una pausa auto-cerrada por >1h tambien cancela la alarma nativa pendiente y libera el audio', async () => {
            const clock = createClock();
            const { app, ln } = await nativeApp({ clock });
            inJornada(app);
            await app.t.startPause('dinar');
            assertEqual(ln.scheduled.length, 1);
            clock.advance(2 * H); // el usuario se olvido de la pausa
            assertEqual(app.t.validateAppState(), true);
            await flush(10);
            assertEqual(ln.scheduled.length, 0);
            assert(!sessionTimerDelays(app).includes(30 * M));
        });

        // ------------------------------------------------------------ Web / PWA
        const webNavigator = (serviceWorker) => ({ serviceWorker });
        const grantedNotification = () => {
            const n = function Notification() { throw new TypeError("Failed to construct 'Notification': Illegal constructor. Use ServiceWorkerRegistration.showNotification() instead."); };
            n.permission = 'granted';
            n.requestPermission = async () => 'granted';
            return n;
        };

        suite.test('Web: si el service worker no esta listo (ready nunca se resuelve) startPause NO se cuelga: acaba y avisa de que no hay alarma en segundo plano', async () => {
            const app = await loadScriptApp({
                navigator: webNavigator({ ready: new Promise(() => {}), register: () => Promise.reject(new Error('sin https')), addEventListener() {} }),
                globals: { Notification: grantedNotification() }
            });
            inJornada(app);
            const p = app.t.startPause('dinar');
            for (let i = 0; i < 60 && !app.timers.pending().some(t => !t.interval && t.delay === 3000); i++) await flush(2);
            app.timers.fireMatching(t => !t.interval && t.delay === 3000); // vence el limite de espera del SW
            await p;
            assertEqual(app.t.getState().currentState, 'PAUSA', 'la pausa se inicia y se pinta');
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
            assert(sched, 'mensaje de programacion');
            assertEqual(sched.pauseType, 'dinar');
            assertEqual(sched.delayMs, 30 * M);
            assertEqual(sched.timeLimit, 30);
            await app.t.endPause();
            assert(messages.some(m => m.type === 'CANCEL_NOTIFICATION'), 'cancelada al volver');
        });

        suite.test('Web: Notification con "Illegal constructor" (Chrome para Android) no impide el banner; se usa registration.showNotification cuando existe', async () => {
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
            app.t.playPauseAlarm('dinar', 'service-worker');
            await flush(10);
            assertEqual(app.el('alarm-banner').style.display, 'flex');
            assertEqual(shown.length, 1);
            assertEqual(shown[0].options.tag, 'pause-alarm');

            // Sin showNotification: el constructor lanza, se captura y el banner sigue visible
            const reg2 = { active: { postMessage() {} } };
            const storage2 = createMemoryStorage(); // otra sesion limpia (la 1a ya persistio la alarma disparada)
            storage2.setItem(STORAGE_KEY, savedPauseState(clock.now, 'dinar', 1 * M));
            const app2 = await loadScriptApp({
                clock, storage: storage2,
                navigator: webNavigator({ ready: Promise.resolve(reg2), register: () => Promise.resolve(reg2), addEventListener() {} }),
                globals: { Notification: grantedNotification() }
            });
            app2.t.playPauseAlarm('dinar', 'service-worker');
            await flush(10);
            assertEqual(app2.el('alarm-banner').style.display, 'flex');
        });

        suite.test('Web sin API Notification (p. ej. Safari iOS): la alarma suena y el banner sale sin lanzar ReferenceError', async () => {
            const clock = createClock();
            const storage = createMemoryStorage();
            storage.setItem(STORAGE_KEY, savedPauseState(clock.now, 'dinar', 1 * M));
            const app = await loadScriptApp({ clock, storage, globals: { Notification: undefined } });
            const spy = spyAudio(app);
            app.t.playPauseAlarm('dinar', 'background-timer');
            await flush(5);
            assertEqual(spy.alarmPlays, 1);
            assertEqual(app.el('alarm-banner').style.display, 'flex');
        });

        suite.test('Web: permiso de notificaciones denegado -> no se vuelve a pedir y se avisa de que solo sonara con la pestana abierta', async () => {
            let requests = 0;
            const registration = { active: { postMessage() {} } };
            const app = await loadScriptApp({
                navigator: webNavigator({ ready: Promise.resolve(registration), register: () => Promise.resolve(registration), addEventListener() {} }),
                globals: { Notification: { permission: 'denied', requestPermission: async () => { requests++; return 'denied'; } } }
            });
            assertEqual(requests, 0, 'no insiste');
            inJornada(app);
            await app.t.startPause('dinar');
            assertEqual(requests, 0);
            const info = app.el('info-message');
            assert(info.textContent.includes('Notificacions denegades'), info.textContent);
            assert(info.classList.contains('alert'));
        });
    });
};
