/**
 * scripts/test-fake-app.js
 * Helpers para ejecutar el CODIGO REAL de script.js y db-ui.js dentro de un contexto `vm`
 * con un DOM minimo simulado, reloj controlado y timers falsos. 100% offline.
 *
 * - script.js vive entero dentro de un listener DOMContentLoaded; para poder invocar sus funciones
 *   internas se inyecta (solo en memoria, en el test) un objeto `window.__t` justo antes del `init();`
 *   final. El codigo de produccion en disco NO se modifica.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

// ---------------------------------------------------------------------------
// Reloj controlado
// ---------------------------------------------------------------------------
function createClock(initial) {
    const clock = { now: initial instanceof Date ? initial.getTime() : (initial ?? new Date(2026, 9, 5, 12, 0, 0).getTime()) };
    class FakeDate extends Date {
        constructor(...args) {
            if (args.length === 0) super(clock.now);
            else super(...args);
        }
        static now() { return clock.now; }
    }
    clock.FakeDate = FakeDate;
    clock.advance = (ms) => { clock.now += ms; };
    return clock;
}

// ---------------------------------------------------------------------------
// DOM falso
// ---------------------------------------------------------------------------
function createFakeDom() {
    const staticById = {};
    const modalById = {};
    const bodyListeners = [];

    class FakeEl {
        constructor(tag, id) {
            this.tagName = String(tag || 'div').toUpperCase();
            this.id = id || '';
            this.className = '';
            this.style = {};
            this.children = [];
            this._inner = '';
            this.textContent = '';
            this.value = '';
            this.title = '';
            this.disabled = false;
            this.onclick = null;
            this.parentNode = null;
            this.attrs = {};
            this.listeners = {};
            const set = new Set();
            this.classList = {
                add: (...c) => c.forEach(x => set.add(x)),
                remove: (...c) => c.forEach(x => set.delete(x)),
                contains: (c) => set.has(c),
                toggle: (c, force) => {
                    const on = force === undefined ? !set.has(c) : !!force;
                    if (on) set.add(c); else set.delete(c);
                    return on;
                },
                _set: set
            };
        }
        get innerHTML() { return this._inner; }
        set innerHTML(v) {
            this._inner = String(v);
            if (this._inner === '') this.children = [];
            else registerModalIds(this);
        }
        appendChild(c) { this.children.push(c); c.parentNode = this; return c; }
        prepend(c) { this.children.unshift(c); c.parentNode = this; }
        insertBefore(c) { this.children.unshift(c); c.parentNode = this; return c; }
        removeChild(c) {
            const i = this.children.indexOf(c);
            if (i >= 0) this.children.splice(i, 1);
            return c;
        }
        get lastChild() { return this.children.length ? this.children[this.children.length - 1] : null; }
        remove() { if (this.parentNode) this.parentNode.removeChild(this); }
        setAttribute(k, v) { this.attrs[k] = String(v); }
        getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
        addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
        querySelector(sel) {
            if (typeof sel === 'string' && sel[0] === '#') return document.getElementById(sel.slice(1));
            return null;
        }
        querySelectorAll() { return []; }
        focus() {}
        click() { if (typeof this.onclick === 'function') return this.onclick({ stopPropagation() {}, preventDefault() {}, target: this }); }
        setSelectionRange() {}
        scrollIntoView() {}
    }

    function registerModalIds(el) {
        const html = el._inner || '';
        const re = /\bid="([^"]+)"/g;
        let m;
        while ((m = re.exec(html))) {
            if (!staticById[m[1]]) modalById[m[1]] = new FakeEl('div', m[1]);
        }
    }
    function unregisterModalIds(el) {
        const html = el._inner || '';
        const re = /\bid="([^"]+)"/g;
        let m;
        while ((m = re.exec(html))) delete modalById[m[1]];
    }

    const body = new FakeEl('body');
    const origAppend = body.appendChild.bind(body);
    const origRemove = body.removeChild.bind(body);
    body.appendChild = (c) => { registerModalIds(c); return origAppend(c); };
    body.removeChild = (c) => { unregisterModalIds(c); return origRemove(c); };
    body.contains = (c) => body.children.includes(c);
    body.setAttribute = () => {};

    const header = new FakeEl('header');
    header.className = 'header';

    const mainContent = new FakeEl('main');
    mainContent.className = 'main-content';
    mainContent.insertBefore = (c) => {
        mainContent.children.unshift(c);
        c.parentNode = mainContent;
        if (c.id) modalById[c.id] = c;
        return c;
    };

    const document = {
        hidden: false,
        body,
        listeners: {},
        getElementById(id) { return staticById[id] || modalById[id] || null; },
        createElement(tag) { return new FakeEl(tag); },
        querySelector(sel) {
            if (sel === '.header') return header;
            if (sel === '.main-content') return mainContent;
            return null;
        },
        querySelectorAll() { return []; },
        addEventListener(type, fn) { (document.listeners[type] = document.listeners[type] || []).push(fn); }
    };

    function addStatic(id, extra) {
        const el = new FakeEl('div', id);
        if (extra) Object.assign(el, extra);
        staticById[id] = el;
        return el;
    }

    [
        'connection-status', 'gps-status', 'current-state-text', 'work-timer', 'pause-timer', 'total-timer',
        'button-container', 'log-container', 'loading-overlay', 'loading-text', 'info-message',
        'status-card', 'status-live-badge', 'work-timer-box', 'pause-timer-box', 'total-timer-box',
        'pause-timer-label', 'alarm-banner', 'alarm-banner-sub', 'btn-stop-alarm-banner'
    ].forEach(id => addStatic(id));

    const audio = addStatic('pause-audio-player', {
        src: null,
        loop: false,
        volume: 1,
        play: async () => {},
        pause: () => {},
        removeAttribute: () => {},
        load: () => {}
    });

    return { document, FakeEl, header, mainContent, audio, staticById, modalById, bodyListeners };
}

// ---------------------------------------------------------------------------
// Timers falsos (no se ejecutan solos; el test decide cuando disparar)
// ---------------------------------------------------------------------------
function createFakeTimers() {
    let nextId = 1;
    const timers = new Map();
    return {
        setTimeout: (fn, delay) => { const id = nextId++; timers.set(id, { fn, delay, interval: false }); return id; },
        setInterval: (fn, delay) => { const id = nextId++; timers.set(id, { fn, delay, interval: true }); return id; },
        clearTimeout: (id) => { timers.delete(id); },
        clearInterval: (id) => { timers.delete(id); },
        pending: () => Array.from(timers.values()),
        fireAll: () => { for (const [id, t] of Array.from(timers.entries())) { if (!t.interval) timers.delete(id); t.fn(); } },
        // Dispara solo los timers que cumplan el predicado (p. ej. un timeout concreto)
        fireMatching: (pred) => {
            for (const [id, t] of Array.from(timers.entries())) {
                if (!pred(t)) continue;
                if (!t.interval) timers.delete(id);
                t.fn();
            }
        }
    };
}

function createMemoryStorage() {
    const store = {};
    return {
        _store: store,
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: (k) => { delete store[k]; },
        clear: () => { Object.keys(store).forEach(k => delete store[k]); }
    };
}

const flush = async (n = 5) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };

// ---------------------------------------------------------------------------
// Carga del script.js REAL
// ---------------------------------------------------------------------------
const HOOK = `
    window.__t = {
        calculateExtraHours, loadState, saveState, validateAppState, updateUI, updateTimers,
        endWorkday, startWorkday, startPause, endPause, handleAction, playPauseAlarm, stopAlarm,
        getPendingSync, getStandardWorkDay, getDayTypeName,
        savePendingSync, executePendingSync, getCurrentLocation, flushDbQueue, recordDb, runActions,
        scheduleNotification, cancelScheduledNotification, ensurePauseAlarmScheduled, resumeActivePause,
        initNotifications, requestNotificationPermission, checkExactAlarmSetting, setupNativeNotificationListeners,
        startBackgroundAudioKeepAlive, stopAlarmAudio, showPauseOverrunNotice, buildPauseInfoMessage,
        getServiceWorkerRegistration, showTranslatedError, escapeHtml, formatHoursMinutes,
        startAlmacen, endAlmacenAndStartWorkday,
        notificationStatus,
        getState: () => appState,
        setState: (s) => { appState = s; }
    };
    window.__t.initPromise = init();
});`;

/**
 * @param {object} opts
 *   - storage: localStorage simulado (por defecto vacio)
 *   - clock: reloj (createClock)
 *   - beta10DB: objeto simulado para window.beta10DB (null = ausente)
 *   - fetchCalls: array donde se registran las peticiones al proxy simulado
 *   - globals: objeto con globals extra para el sandbox (Beta10Direct, Capacitor, Notification, ...)
 *   - navigator: propiedades extra para navigator (serviceWorker, wakeLock, geolocation, ...)
 *   - fetchImpl: sustituye el fetch simulado (debe seguir sin tocar la red)
 *   - awaitInit: false = no esperar a que termine init() (para probar que la UI no queda bloqueada)
 */
async function loadScriptApp(opts = {}) {
    const clock = opts.clock || createClock();
    const storage = opts.storage || createMemoryStorage();
    const fake = createFakeDom();
    const timers = createFakeTimers();
    const alerts = [];
    const fetchCalls = opts.fetchCalls || [];

    const sandbox = {
        console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
        Date: clock.FakeDate,
        document: fake.document,
        localStorage: storage,
        navigator: {
            geolocation: {
                getCurrentPosition: (ok) => ok({ coords: { latitude: 41.79, longitude: 2.77, accuracy: 5 } })
            },
            vibrate: () => true
        },
        Notification: { permission: 'denied', requestPermission: async () => 'denied' },
        performance: { now: () => 0 },
        alert: (m) => { alerts.push(String(m)); },
        confirm: () => true,
        prompt: () => null,
        setTimeout: timers.setTimeout,
        setInterval: timers.setInterval,
        clearTimeout: timers.clearTimeout,
        clearInterval: timers.clearInterval,
        authManager: {
            hasValidCredentials: () => true,
            getCredentials: () => ({ username: 'tester', password: 'x' }),
            showLoginScreen: async () => {},
            showAccountModal: () => {}
        },
        fetch: async (url, init) => {
            if (url === '/api/health') return { ok: true, json: async () => ({ message: 'ok' }) };
            if (url === '/api/beta10') {
                fetchCalls.push(JSON.parse(init.body));
                return { ok: true, status: 200, json: async () => ({ success: true }) };
            }
            throw new Error('SECURITY VIOLATION: unexpected network call to ' + url);
        }
    };
    if (opts.navigator) Object.assign(sandbox.navigator, opts.navigator);
    if (opts.fetchImpl) sandbox.fetch = opts.fetchImpl;
    if (opts.globals) Object.assign(sandbox, opts.globals);
    sandbox.window = sandbox;
    sandbox.addEventListener = () => {};
    sandbox.open = () => {};
    if (opts.beta10DB !== null) {
        sandbox.beta10DB = opts.beta10DB || {
            init: async () => true,
            recordJornada: async () => {},
            recordPausa: async () => {},
            recordFichaje: async () => {}
        };
    }

    const ctx = vm.createContext(sandbox);

    let src = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
    const endRe = /\n\s*init\(\);\s*\n\}\);\s*$/;
    if (!endRe.test(src)) {
        throw new Error('script.js: no se encuentra el cierre `init(); });` esperado para inyectar el hook de test');
    }
    src = src.replace(endRe, '\n' + HOOK);

    new vm.Script(src, { filename: 'script.js' }).runInContext(ctx);

    const handlers = fake.document.listeners['DOMContentLoaded'] || [];
    if (handlers.length !== 1) throw new Error('script.js deberia registrar exactamente un listener DOMContentLoaded');
    await handlers[0]();
    if (opts.awaitInit !== false) {
        await sandbox.__t.initPromise;
        await flush();
    }

    const logTexts = () => fake.staticById['log-container'].children.map(c => c.textContent);

    return {
        t: sandbox.__t,
        sandbox,
        clock,
        storage,
        fake,
        timers,
        alerts,
        fetchCalls,
        logTexts,
        el: (id) => fake.document.getElementById(id),
        flush
    };
}

// ---------------------------------------------------------------------------
// Carga del db-ui.js REAL
// ---------------------------------------------------------------------------
function loadDbUi({ beta10DB, clock, confirm, prompt, navigator } = {}) {
    const fake = createFakeDom();
    const alerts = [];
    const sandbox = {
        console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
        document: fake.document,
        navigator: navigator || {},
        alert: (m) => { alerts.push(String(m)); },
        confirm: confirm || (() => true),
        prompt: prompt || (() => null),
        setTimeout: () => 0,
        Date: clock ? clock.FakeDate : Date
    };
    sandbox.window = sandbox;
    sandbox.beta10DB = beta10DB;
    const ctx = vm.createContext(sandbox);
    new vm.Script(fs.readFileSync(path.join(ROOT, 'db-ui.js'), 'utf8'), { filename: 'db-ui.js' }).runInContext(ctx);
    return { ui: sandbox.beta10DBUI, fake, alerts, sandbox };
}

// ---------------------------------------------------------------------------
// Simulacion del entorno nativo (APK Capacitor) para probar alarmas y notificaciones
// ---------------------------------------------------------------------------
/**
 * LocalNotifications simulado con el comportamiento relevante del plugin real
 * (@capacitor/local-notifications 6.x, Android):
 *  - schedule() rechaza si las notificaciones estan desactivadas ("Notifications not enabled");
 *  - una programacion con hora pasada se DESCARTA EN SILENCIO (el plugin solo hace Logger.error);
 *  - mismo id => reemplaza la anterior (nunca hay duplicados);
 *  - checkExactNotificationSetting / changeExactNotificationSetting (Android 12+).
 */
function createLocalNotificationsMock(clock, opts = {}) {
    const st = {
        permission: opts.permission || 'granted',
        permissionAfterRequest: opts.permissionAfterRequest || null,
        exact: opts.exact || 'granted',
        exactAfterChange: opts.exactAfterChange || null,
        scheduled: [], dropped: [], channels: [], deleted: [], actionTypes: [], removedDelivered: [],
        scheduleCalls: 0, requestCalls: 0, exactChangeCalls: 0, cancelCalls: 0, listeners: {}
    };
    const plugin = {
        checkPermissions: async () => ({ display: st.permission }),
        requestPermissions: async () => {
            st.requestCalls++;
            if (opts.gateRequest) {
                await new Promise(resolve => { st.release = (value) => { st.permission = value; resolve(); }; });
            } else if (st.permissionAfterRequest) {
                st.permission = st.permissionAfterRequest;
            }
            return { display: st.permission };
        },
        schedule: async ({ notifications }) => {
            st.scheduleCalls++;
            if (st.permission !== 'granted') throw new Error('Notifications not enabled on this device');
            for (const n of notifications) {
                const atMs = new Date(n.schedule.at).getTime();
                st.scheduled = st.scheduled.filter(x => x.id !== n.id);
                if (atMs < clock.now) { st.dropped.push(n); continue; }
                st.scheduled.push({ ...n, atMs });
            }
            return { notifications: notifications.map(n => ({ id: n.id })) };
        },
        getPending: async () => ({ notifications: st.scheduled.map(n => ({ id: n.id })) }),
        cancel: async ({ notifications }) => {
            st.cancelCalls++;
            const ids = notifications.map(n => n.id);
            st.scheduled = st.scheduled.filter(n => !ids.includes(n.id));
            return {};
        },
        removeDeliveredNotifications: async ({ notifications }) => { st.removedDelivered.push(...notifications.map(n => n.id)); return {}; },
        createChannel: async (c) => { st.channels.push(c); return {}; },
        deleteChannel: async ({ id }) => { st.deleted.push(id); return {}; },
        listChannels: async () => ({ channels: st.channels.map(c => ({ ...c, importance: opts.channelImportance !== undefined ? opts.channelImportance : c.importance })) }),
        registerActionTypes: async ({ types }) => { st.actionTypes.push(...types); return {}; },
        checkExactNotificationSetting: async () => ({ exact_alarm: st.exact }),
        changeExactNotificationSetting: async () => {
            st.exactChangeCalls++;
            if (st.exactAfterChange) st.exact = st.exactAfterChange;
            return { exact_alarm: st.exact };
        },
        addListener: (event, fn) => { (st.listeners[event] = st.listeners[event] || []).push(fn); return Promise.resolve({ remove() {} }); }
    };
    st.emit = (event, data) => (st.listeners[event] || []).forEach(fn => fn(data));
    return { plugin, state: st };
}

/** Globals de sandbox que convierten script.js en "app nativa" (Beta10Direct + Capacitor). */
function nativeGlobals(clock, notifOpts = {}, extra = {}) {
    const ln = createLocalNotificationsMock(clock, notifOpts);
    const punches = [];
    return {
        ln: ln.state,
        punches,
        globals: {
            Beta10Direct: {
                isNative: () => true,
                executeFichaje: async (action, point, location, observations) => {
                    punches.push({ action, point, observations });
                    return { success: true, user: 'tester' };
                }
            },
            Capacitor: { isNativePlatform: () => true, Plugins: { LocalNotifications: ln.plugin } },
            ...extra
        }
    };
}

module.exports = {
    createClock,
    createFakeDom,
    createFakeTimers,
    createMemoryStorage,
    loadScriptApp,
    loadDbUi,
    createLocalNotificationsMock,
    nativeGlobals,
    flush
};
