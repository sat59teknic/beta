/**
 * scripts/tests/test-fixes-platform.js
 * Tests de los arreglos de plataforma y UI:
 *  - service-worker.js REAL en vm (M13): cache completa, instalacion tolerante, red primero, offline;
 *  - scripts/prepare-android.js (A6, L12, L13) sobre un proyecto Android falso en un directorio temporal;
 *  - capacitor.config.json (L13, L12) y build-www.js;
 *  - db-ui.js REAL (M12, A4, A5, L11, A2) y auth.js (M11).
 *
 * Cero red real: fetch/caches/Capacitor simulados; los ficheros temporales viven en os.tmpdir().
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { assert, assertEqual, assertDeepEqual, assertThrowsAsync } = require('../test-harness.js');
const { createFakeDom, loadDbUi, flush } = require('../test-fake-app.js');
const prepare = require('../prepare-android.js');

const ROOT = path.join(__dirname, '..', '..');
const ORIGIN = 'https://app.test';

module.exports = function registerFixesPlatformTests(runner) {
    // ======================================================================
    // Service worker
    // ======================================================================
    runner.suite('Service worker real (vm): cache completa, red primero, offline y control inmediato', async (suite) => {
        class FakeResponse {
            constructor(body, init = {}) {
                this.body = body;
                this.status = init.status === undefined ? 200 : init.status;
                this.type = init.type || 'basic';
            }
            get ok() { return this.status >= 200 && this.status < 300; }
            clone() { return new FakeResponse(this.body, { status: this.status, type: this.type }); }
        }

        const norm = (u) => new URL(typeof u === 'string' ? u : u.url, ORIGIN).href;

        function loadServiceWorker(env = {}) {
            const handlers = {};
            const cacheStore = env.cacheStore || new Map();
            const fetchLog = [];
            const self = {
                location: { origin: ORIGIN },
                addEventListener: (type, fn) => { handlers[type] = fn; },
                skipWaiting: () => { self.skipped = true; },
                clients: { claim: async () => { self.claimed = true; }, matchAll: async () => [] },
                registration: { showNotification: async () => {} }
            };
            const getCache = (name) => {
                if (!cacheStore.has(name)) cacheStore.set(name, new Map());
                return cacheStore.get(name);
            };
            const fetchImpl = async (req) => {
                fetchLog.push(norm(req));
                return env.fetch(req);
            };
            const caches = {
                open: async (name) => {
                    const c = getCache(name);
                    return {
                        add: async (url) => {
                            const res = await fetchImpl(url);
                            if (!res.ok) throw new TypeError('Request failed ' + res.status);
                            c.set(norm(url), res);
                        },
                        put: async (req, res) => { c.set(norm(req), res); }
                    };
                },
                match: async (req, opts = {}) => {
                    const strip = (u) => (opts.ignoreSearch ? u.split('?')[0] : u);
                    const key = strip(norm(req));
                    for (const c of cacheStore.values()) {
                        for (const [k, v] of c) if (strip(k) === key) return v;
                    }
                    return undefined;
                },
                keys: async () => Array.from(cacheStore.keys()),
                delete: async (name) => cacheStore.delete(name)
            };
            const sandbox = {
                self, caches, fetch: fetchImpl, Response: FakeResponse, URL, Promise,
                console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout
            };
            const ctx = vm.createContext(sandbox);
            new vm.Script(fs.readFileSync(path.join(ROOT, 'service-worker.js'), 'utf8'), { filename: 'service-worker.js' }).runInContext(ctx);

            async function lifecycle(type) {
                const waits = [];
                handlers[type]({ waitUntil: (p) => waits.push(p) });
                await Promise.all(waits);
            }
            async function request(url, over = {}) {
                let responded;
                const req = { url: ORIGIN + url, method: 'GET', mode: 'no-cors', ...over };
                if (/^https?:/.test(url)) req.url = url;
                handlers.fetch({ request: req, respondWith: (p) => { responded = Promise.resolve(p); } });
                return responded === undefined ? undefined : await responded;
            }
            return {
                self, cacheStore, fetchLog, handlers, getCache, lifecycle, request,
                urlsToCache: vm.runInContext('urlsToCache', ctx),
                cacheName: vm.runInContext('CACHE_NAME', ctx)
            };
        }

        const ok = (body) => new FakeResponse(body);

        suite.test('M13 urlsToCache incluye TODO lo local que carga index.html (scripts, estilos, iconos, manifest) y todo existe en disco', async () => {
            const sw = loadServiceWorker({ fetch: async () => ok('x') });
            const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
            const refs = Array.from(html.matchAll(/(?:src|href)="([^"#]+)"/g)).map(m => m[1]).filter(u => !/^(?:https?:)?\/\//.test(u));
            assert(refs.length >= 10, 'se han leido las referencias de index.html: ' + refs.join(','));
            const missing = refs.filter(r => !sw.urlsToCache.includes('/' + r.replace(/^\.?\//, '')));
            assertDeepEqual(missing, [], 'sin cachear (la app no arrancaria offline)');
            const absent = sw.urlsToCache.filter(u => u !== '/' && !fs.existsSync(path.join(ROOT, u)));
            assertDeepEqual(absent, [], 'entradas de la cache que no existen en disco');
            for (const must of ['/pause_end.wav', '/silence.wav', '/sql-wasm.wasm', '/auth.js', '/beta10-direct.js']) {
                assert(sw.urlsToCache.includes(must), must);
            }
        });

        suite.test('M13 install: un 404 no impide instalar el SW (antes addAll fallaba entero), cachea el resto y hace skipWaiting', async () => {
            const sw = loadServiceWorker({ fetch: async (req) => (norm(req).endsWith('/error-manager.js') ? new FakeResponse('no', { status: 404 }) : ok('x')) });
            await sw.lifecycle('install');
            assertEqual(sw.getCache(sw.cacheName).size, sw.urlsToCache.length - 1);
            assertEqual(sw.self.skipped, true);
        });

        suite.test('M13 activate: borra caches antiguas (incluida la v6) y reclama los clientes abiertos', async () => {
            const cacheStore = new Map([['beta10-v6-pause-alarm-fix', new Map()], ['otra', new Map()]]);
            const sw = loadServiceWorker({ cacheStore, fetch: async () => ok('x') });
            cacheStore.set(sw.cacheName, new Map());
            assert(sw.cacheName !== 'beta10-v6-pause-alarm-fix', 'CACHE_NAME renovado');
            await sw.lifecycle('activate');
            assertDeepEqual(Array.from(cacheStore.keys()), [sw.cacheName]);
            assertEqual(sw.self.claimed, true);
        });

        suite.test('M13 script.js/HTML/CSS: RED PRIMERO. Con una version vieja en cache se sirve la nueva y se actualiza la cache (antes se servia el script viejo para siempre)', async () => {
            const sw = loadServiceWorker({ fetch: async () => ok('NUEVO') });
            sw.getCache(sw.cacheName).set(ORIGIN + '/script.js', ok('VIEJO'));
            const res = await sw.request('/script.js');
            assertEqual(res.body, 'NUEVO');
            await flush(5);
            assertEqual(sw.getCache(sw.cacheName).get(ORIGIN + '/script.js').body, 'NUEVO', 'cache actualizada');
            const css = await sw.request('/style.css?v=3');
            assertEqual(css.body, 'NUEVO');
        });

        suite.test('M13 offline: devuelve la copia en cache; navegacion sin copia -> index.html; sin nada -> 503 controlado (sin excepcion no capturada)', async () => {
            const sw = loadServiceWorker({ fetch: async () => { throw new TypeError('Failed to fetch'); } });
            const cache = sw.getCache(sw.cacheName);
            cache.set(ORIGIN + '/script.js', ok('EN CACHE'));
            cache.set(ORIGIN + '/index.html', ok('SHELL'));
            assertEqual((await sw.request('/script.js')).body, 'EN CACHE');
            assertEqual((await sw.request('/script.js?v=9')).body, 'EN CACHE', 'ignora la query');
            assertEqual((await sw.request('/ruta-spa', { mode: 'navigate' })).body, 'SHELL');
            const miss = await sw.request('/no-existe.js');
            assertEqual(miss.status, 503);
            const audioMiss = await sw.request('/otra.wav');
            assertEqual(audioMiss.status, 503);
        });

        suite.test('M13 audio/wasm/iconos: CACHE PRIMERO (no se descargan de nuevo) y se guardan al primer uso', async () => {
            const sw = loadServiceWorker({ fetch: async () => ok('DE RED') });
            sw.getCache(sw.cacheName).set(ORIGIN + '/pause_end.wav', ok('CACHEADO'));
            assertEqual((await sw.request('/pause_end.wav')).body, 'CACHEADO');
            assertEqual(sw.fetchLog.length, 0, 'sin ir a la red');
            assertEqual((await sw.request('/silence.wav')).body, 'DE RED');
            await flush(5);
            assert(sw.getCache(sw.cacheName).has(ORIGIN + '/silence.wav'), 'guardado');
        });

        suite.test('M13 no intercepta POST, /api/ ni otros origenes (fuentes de Google); respuestas no validas no se guardan en cache', async () => {
            const sw = loadServiceWorker({ fetch: async () => new FakeResponse('err', { status: 500 }) });
            assertEqual(await sw.request('/api/beta10', { method: 'POST' }), undefined);
            assertEqual(await sw.request('/api/health'), undefined);
            assertEqual(await sw.request('https://fonts.googleapis.com/css2?family=X'), undefined);
            const res = await sw.request('/script.js');
            assertEqual(res.status, 500);
            await flush(5);
            assertEqual(sw.getCache(sw.cacheName).has(ORIGIN + '/script.js'), false, 'un 500 no envenena la cache');
        });
    });

    // ======================================================================
    // Android: prepare-android.js, capacitor.config.json, build-www.js
    // ======================================================================
    runner.suite('Android: prepare-android.js (permisos, sonido, icono, firma), capacitor.config.json y build-www.js', async (suite) => {
        const quietLog = { log() {}, warn() {}, error() {} };

        const MANIFEST = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <application
        android:allowBackup="true"
        android:usesCleartextTraffic="true"
        android:theme="@style/AppTheme">
    </application>

    <!-- Permissions -->

    <uses-permission android:name="android.permission.INTERNET" />
</manifest>
`;
        const GRADLE = `apply plugin: 'com.android.application'

android {
    namespace "es.teknic.beta10"
    compileSdk rootProject.ext.compileSdkVersion
    defaultConfig {
        applicationId "es.teknic.beta10"
    }
    buildTypes {
        release {
            minifyEnabled false
            proguardFiles getDefaultProguardFile('proguard-android.txt'), 'proguard-rules.pro'
        }
    }
}
`;

        function makeProject({ keystore = true, alarm = true, gradle = GRADLE, manifest = MANIFEST } = {}) {
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'beta10-android-'));
            fs.mkdirSync(path.join(dir, 'android/app/src/main'), { recursive: true });
            fs.writeFileSync(path.join(dir, 'android/app/src/main/AndroidManifest.xml'), manifest);
            fs.writeFileSync(path.join(dir, 'android/app/build.gradle'), gradle);
            if (keystore) fs.copyFileSync(path.join(ROOT, 'debug.keystore'), path.join(dir, 'debug.keystore'));
            if (alarm) fs.copyFileSync(path.join(ROOT, 'pause_end.wav'), path.join(dir, 'pause_end.wav'));
            return dir;
        }
        const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');

        suite.test('A6 falla (lanza) si falta debug.keystore y no toca el manifest ni el gradle (antes: APK con firma aleatoria en silencio)', async () => {
            const dir = makeProject({ keystore: false });
            try {
                const before = [read(dir, 'android/app/src/main/AndroidManifest.xml'), read(dir, 'android/app/build.gradle')];
                let msg = '';
                try { prepare.prepareAndroid(dir, quietLog); } catch (e) { msg = e.message; }
                assert(msg.includes('debug.keystore'), msg);
                assertDeepEqual([read(dir, 'android/app/src/main/AndroidManifest.xml'), read(dir, 'android/app/build.gradle')], before);
            } finally { fs.rmSync(dir, { recursive: true, force: true }); }
        });

        suite.test('prepare-android falla si falta pause_end.wav (el canal sonaria con el sonido por defecto) o el manifest/gradle', async () => {
            let dir = makeProject({ alarm: false });
            try { assert(/pause_end\.wav/.test((() => { try { prepare.prepareAndroid(dir, quietLog); } catch (e) { return e.message; } return ''; })())); }
            finally { fs.rmSync(dir, { recursive: true, force: true }); }
            dir = fs.mkdtempSync(path.join(os.tmpdir(), 'beta10-android-'));
            try {
                let msg = '';
                try { prepare.prepareAndroid(dir, quietLog); } catch (e) { msg = e.message; }
                assert(msg.includes('AndroidManifest.xml'), msg);
            } finally { fs.rmSync(dir, { recursive: true, force: true }); }
        });

        suite.test('Permisos: se anaden los que faltan (POST_NOTIFICATIONS, SCHEDULE/USE_EXACT_ALARM, BOOT...) sin duplicar INTERNET y de forma idempotente', async () => {
            const dir = makeProject();
            try {
                const first = prepare.prepareAndroid(dir, quietLog);
                const manifest = read(dir, 'android/app/src/main/AndroidManifest.xml');
                for (const p of prepare.REQUIRED_PERMISSIONS) {
                    assertEqual(manifest.split(`"${p}"`).length - 1, 1, p + ' exactamente una vez');
                }
                assert(!first.permissionsAdded.includes('android.permission.INTERNET'), 'INTERNET ya estaba');
                assert(first.permissionsAdded.includes('android.permission.POST_NOTIFICATIONS'));
                const second = prepare.prepareAndroid(dir, quietLog);
                assertDeepEqual(second.permissionsAdded, []);
                assertEqual(read(dir, 'android/app/src/main/AndroidManifest.xml'), manifest, 'segunda ejecucion no cambia nada');
            } finally { fs.rmSync(dir, { recursive: true, force: true }); }
        });

        suite.test('L13 usesCleartextTraffic="true" heredado se desactiva y el script ya no lo activa', async () => {
            const dir = makeProject();
            try {
                const res = prepare.prepareAndroid(dir, quietLog);
                assertEqual(res.cleartextDisabled, true);
                const manifest = read(dir, 'android/app/src/main/AndroidManifest.xml');
                assert(!manifest.includes('usesCleartextTraffic="true"'));
                assert(manifest.includes('usesCleartextTraffic="false"'));
                const clean = makeProject({ manifest: MANIFEST.replace('android:usesCleartextTraffic="true"\n        ', '') });
                try {
                    prepare.prepareAndroid(clean, quietLog);
                    assert(!read(clean, 'android/app/src/main/AndroidManifest.xml').includes('usesCleartextTraffic'), 'no se anade si no estaba');
                } finally { fs.rmSync(clean, { recursive: true, force: true }); }
            } finally { fs.rmSync(dir, { recursive: true, force: true }); }
        });

        suite.test('Sonido e icono: pause_end.wav va a res/raw (identico), se borra el alarm.wav antiguo y se crea el drawable monocromo ic_stat_pause_alarm', async () => {
            const dir = makeProject();
            try {
                fs.mkdirSync(path.join(dir, 'android/app/src/main/res/raw'), { recursive: true });
                fs.writeFileSync(path.join(dir, 'android/app/src/main/res/raw/alarm.wav'), 'viejo');
                prepare.prepareAndroid(dir, quietLog);
                const raw = fs.readFileSync(path.join(dir, 'android/app/src/main/res/raw/pause_end.wav'));
                assert(Buffer.compare(raw, fs.readFileSync(path.join(ROOT, 'pause_end.wav'))) === 0, 'mismo fichero');
                assert(!fs.existsSync(path.join(dir, 'android/app/src/main/res/raw/alarm.wav')), 'alarm.wav antiguo eliminado');
                assertEqual(prepare.PAUSE_END_SOUND, 'pause_end.wav');
                const xml = read(dir, `android/app/src/main/res/drawable/${prepare.NOTIFICATION_ICON_NAME}.xml`);
                assert(xml.includes('<vector') && xml.includes('#FFFFFFFF'), 'vector blanco (monocromo)');
                assertEqual(prepare.NOTIFICATION_ICON_NAME, 'ic_stat_pause_alarm');
            } finally { fs.rmSync(dir, { recursive: true, force: true }); }
        });

        suite.test('A6 firma debug Y release con el keystore fijo; es idempotente (2a ejecucion sin cambios)', async () => {
            const dir = makeProject();
            try {
                const first = prepare.prepareAndroid(dir, quietLog);
                assertEqual(first.gradleChanged, true);
                const gradle = read(dir, 'android/app/build.gradle');
                assert(/signingConfigs\s*\{[\s\S]*debug\s*\{[\s\S]*storeFile file\('debug\.keystore'\)/.test(gradle), 'signingConfigs.debug');
                assert(/signingConfigs\s*\{[\s\S]*release\s*\{[\s\S]*storeFile file\('debug\.keystore'\)/.test(gradle), 'signingConfigs.release');
                const releaseBlock = /buildTypes\s*\{[\s\S]*?release\s*\{([\s\S]*?)\}/.exec(gradle)[1];
                assert(releaseBlock.includes('signingConfig signingConfigs.release'), 'buildTypes.release firmado: ' + releaseBlock);
                assert(releaseBlock.includes('minifyEnabled false'), 'se conserva la configuracion existente de release');
                assert(/debug\s*\{\s*signingConfig signingConfigs\.debug/.test(gradle), 'buildTypes.debug firmado');
                assert(fs.existsSync(path.join(dir, 'android/app/debug.keystore')), 'keystore copiado');

                const second = prepare.prepareAndroid(dir, quietLog);
                assertEqual(second.gradleChanged, false);
                assertEqual(read(dir, 'android/app/build.gradle'), gradle);
            } finally { fs.rmSync(dir, { recursive: true, force: true }); }
        });

        suite.test('A6 gradle con una config antigua (solo signingConfigs.debug): se anade release sin duplicar debug', async () => {
            const OLD = GRADLE.replace('android {\n', `android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
`).replace('buildTypes {\n', 'buildTypes {\n        debug {\n            signingConfig signingConfigs.debug\n        }\n');
            const res = prepare.ensureSigningInGradle(OLD);
            assertEqual(res.changed, true);
            assertEqual(res.gradle.split('signingConfig signingConfigs.debug').length - 1, 1, 'debug no se duplica');
            assert(res.gradle.includes('signingConfig signingConfigs.release'));
            const signing = /signingConfigs\s*\{([\s\S]*?)\n    \}/.exec(res.gradle)[1];
            assertEqual((signing.match(/\bdebug\s*\{/g) || []).length, 1);
            assertEqual((signing.match(/\brelease\s*\{/g) || []).length, 1);
            assertEqual(prepare.ensureSigningInGradle(res.gradle).changed, false, 'idempotente');
        });

        suite.test('L12/L13 capacitor.config.json: smallIcon = el drawable monocromo que crea prepare-android, sin cleartext ni mixed content', async () => {
            const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'capacitor.config.json'), 'utf8'));
            assertEqual(cfg.plugins.LocalNotifications.smallIcon, prepare.NOTIFICATION_ICON_NAME);
            assertEqual(cfg.server.androidScheme, 'https');
            assert(!cfg.server.cleartext, 'server.cleartext');
            assert(!(cfg.android && cfg.android.allowMixedContent), 'android.allowMixedContent');
            const script = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
            assert(script.includes(`'${prepare.NOTIFICATION_ICON_NAME}'`), 'script.js usa el mismo icono en schedule()');
            assert(!script.includes("smallIcon: 'ic_launcher_round'"), 'ya no se usa el mipmap a color');
        });

        suite.test('L13 la app solo habla HTTPS (Beta10Direct y proxy): el trafico en claro no hace falta', async () => {
            const direct = fs.readFileSync(path.join(ROOT, 'beta10-direct.js'), 'utf8');
            assert(/BASE_URL = 'https:\/\//.test(direct), 'BASE_URL https');
            const sources = direct + fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
            // el namespace XML del SVG (www.w3.org) no es una peticion de red
            const plain = (sources.match(/['"`]http:\/\/(?!localhost)[^'"`]+['"`]/g) || []).filter(u => !u.includes('www.w3.org'));
            assertDeepEqual(plain, [], 'sin URLs http:// en claro');
        });

        suite.test('build-www.js copia todos los ficheros locales que carga index.html (si no, el APK arranca roto)', async () => {
            const build = fs.readFileSync(path.join(ROOT, 'scripts/build-www.js'), 'utf8');
            const listed = Array.from(/filesToCopy = \[([\s\S]*?)\];/.exec(build)[1].matchAll(/'([^']+)'/g)).map(m => m[1]);
            const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
            const refs = Array.from(html.matchAll(/(?:src|href)="([^"#]+)"/g)).map(m => m[1]).filter(u => !/^(?:https?:)?\/\//.test(u));
            assertDeepEqual(refs.filter(r => !listed.includes(r)), []);
            for (const f of ['pause_end.wav', 'silence.wav']) assert(listed.includes(f), f);
        });

        suite.test('El proyecto trae debug.keystore y pause_end.wav (requisitos duros de prepare-android)', async () => {
            assert(fs.statSync(path.join(ROOT, 'debug.keystore')).size > 0);
            assert(fs.statSync(path.join(ROOT, 'pause_end.wav')).size > 1000);
        });
    });

    // ======================================================================
    // db-ui.js y auth.js
    // ======================================================================
    runner.suite('db-ui.js real: backup/restauracion (M12, A4, A5), formato de horas (L11) y errores de guardado (A2); auth.js (M11)', async (suite) => {
        const dbMock = (over = {}) => ({
            init: async () => true,
            getDatabaseStats: async () => ({ jornadasCount: 1, pausasCount: 2, fichajesCount: 3, sizeKb: 4 }),
            exportDatabaseAsBase64: async () => 'QUJD',
            hasRestoreSnapshot: async () => false,
            ...over
        });

        async function renderDbTab(beta10DB, opts = {}) {
            const env = loadDbUi({ beta10DB, ...opts });
            const container = new env.fake.FakeEl('div');
            await env.ui.renderDatabaseTab(container);
            return { ...env, container, byId: (id) => env.fake.document.getElementById(id) };
        }

        suite.test('M12 "Restaurar des de text" usa un modal con textarea (nunca prompt) y pide confirmacion antes de importar (A4)', async () => {
            const imported = [];
            let confirms = 0;
            let confirmAnswer = false;
            const env = await renderDbTab(dbMock({ importDatabaseFromBase64: async (t) => { imported.push(t); return true; } }), {
                prompt: () => { throw new Error('prompt() no debe usarse'); },
                confirm: () => { confirms++; return confirmAnswer; }
            });
            env.byId('db-restore-text-btn').onclick();
            const modal = env.fake.document.body.lastChild;
            assert(modal.innerHTML.includes('restore-text-area'), 'textarea');
            env.byId('restore-text-area').value = '   QUJDREVG  ';

            env.byId('btn-restore-text-confirm').onclick();
            await flush(5);
            assertEqual(confirms, 1, 'pide confirmacion');
            assertEqual(imported.length, 0, 'sin confirmar no se importa');
            assert(env.fake.document.body.children.includes(modal), 'el modal sigue abierto');

            confirmAnswer = true;
            env.byId('btn-restore-text-confirm').onclick();
            await flush(5);
            assertDeepEqual(imported, ['QUJDREVG']);
            assert(!env.fake.document.body.children.includes(modal), 'modal cerrado');
            assert(env.alerts.some(a => a.includes('restaurada correctament')));
        });

        suite.test('M12 restaurar con el texto vacio avisa y no importa; un error de importacion se muestra y el modal se mantiene', async () => {
            let calls = 0;
            const env = await renderDbTab(dbMock({ importDatabaseFromBase64: async () => { calls++; throw new Error('El fitxer no és una còpia vàlida'); } }));
            env.byId('db-restore-text-btn').onclick();
            env.byId('btn-restore-text-confirm').onclick();
            await flush(3);
            assertEqual(calls, 0);
            assert(env.alerts.some(a => a.includes('Enganxa primer')));
            env.byId('restore-text-area').value = 'xxxx';
            env.byId('btn-restore-text-confirm').onclick();
            await flush(5);
            assertEqual(calls, 1);
            assert(env.alerts.some(a => a.includes('Error restaurant des de text') && a.includes('no és una còpia vàlida')));
        });

        suite.test('M12 "Copiar copia (text)" sin portapapeles abre un modal con el texto en un textarea de solo lectura (no prompt)', async () => {
            const env = await renderDbTab(dbMock(), {
                navigator: {},
                prompt: () => { throw new Error('prompt() no debe usarse'); }
            });
            await env.byId('db-copy-base64-btn').onclick();
            await flush(5);
            const modal = env.fake.document.body.lastChild;
            assert(modal.innerHTML.includes('backup-text-area'));
            assertEqual(env.byId('backup-text-area').value, 'QUJD');
            assertEqual(env.alerts.length, 0);
        });

        suite.test('M12 con portapapeles disponible se copia y se avisa; si el portapapeles falla se cae al modal', async () => {
            const copied = [];
            const ok = await renderDbTab(dbMock(), { navigator: { clipboard: { writeText: async (t) => { copied.push(t); } } } });
            await ok.byId('db-copy-base64-btn').onclick();
            assertDeepEqual(copied, ['QUJD']);
            assert(ok.alerts.some(a => a.includes('copiada al portapapers')));

            const ko = await renderDbTab(dbMock(), { navigator: { clipboard: { writeText: async () => { throw new Error('denied'); } } } });
            await ko.byId('db-copy-base64-btn').onclick();
            await flush(5);
            assert(ko.fake.document.body.lastChild.innerHTML.includes('backup-text-area'), 'modal de respaldo');
        });

        suite.test('A5 descarga imposible en el APK: NO se muestra el aviso de exito, se explica y se abre la copia en texto', async () => {
            const env = await renderDbTab(dbMock({
                downloadDatabaseFile: async () => ({ success: false, needsBase64: true, method: 'native_download_unsupported', error: 'Aquest dispositiu no permet desar el fitxer directament.' })
            }));
            await env.byId('db-download-file-btn').onclick();
            await flush(5);
            assert(env.alerts.some(a => a.includes('Aquest dispositiu no permet desar')), JSON.stringify(env.alerts));
            assert(!env.alerts.some(a => a.includes('✅')), 'ningun exito falso');
            assert(env.fake.document.body.lastChild.innerHTML.includes('backup-text-area'), 'alternativa Base64 ofrecida');
        });

        suite.test('A5 descarga: share/cancelacion no muestran alert; navegador web avisa de que la descarga se ha iniciado; fallo generico muestra el error', async () => {
            for (const method of ['share', 'capacitor_share', 'cancelled_by_user']) {
                const env = await renderDbTab(dbMock({ downloadDatabaseFile: async () => ({ success: true, method }) }));
                await env.byId('db-download-file-btn').onclick();
                assertEqual(env.alerts.length, 0, method);
            }
            const web = await renderDbTab(dbMock({ downloadDatabaseFile: async () => ({ success: true, method: 'download_anchor' }) }));
            await web.byId('db-download-file-btn').onclick();
            assert(web.alerts[0].includes('S\'ha iniciat la descàrrega'), web.alerts[0]);
            const bad = await renderDbTab(dbMock({ downloadDatabaseFile: async () => ({ success: false, error: 'sense espai' }) }));
            await bad.byId('db-download-file-btn').onclick();
            assert(bad.alerts[0].includes('sense espai'));
            const thrown = await renderDbTab(dbMock({ downloadDatabaseFile: async () => { throw new Error('boom'); } }));
            await thrown.byId('db-download-file-btn').onclick();
            assert(thrown.alerts[0].includes('boom'));
        });

        suite.test('A4 el boton "Desfer l\'ultima restauracio" solo aparece si hay copia previa y la restauracio se deshace tras confirmar', async () => {
            const without = await renderDbTab(dbMock());
            assert(!without.container.innerHTML.includes('db-undo-restore-btn'));
            let undone = 0;
            const withSnap = await renderDbTab(dbMock({ hasRestoreSnapshot: async () => true, undoLastRestore: async () => { undone++; } }));
            assert(withSnap.container.innerHTML.includes('db-undo-restore-btn'));
            await withSnap.byId('db-undo-restore-btn').onclick();
            assertEqual(undone, 1);
            assert(withSnap.alerts.some(a => a.includes('recuperat')));
        });

        suite.test('L11 db-ui no muestra "60min": 1.9999 h se ve como 2h y 0.999 h como 1h', async () => {
            const env = loadDbUi({
                beta10DB: {
                    init: async () => true,
                    getMonthlyOvertimeSummary: async () => [{ month: '2026-10', total_worked_extra_hours: 1.9999, total_remunerated_extra_hours: 1.5, days_with_extra: 1 }],
                    getOvertimeDaysForMonth: async () => [{ id: 1, date: '2026-10-05', worked_hours: 8.9999, extra_hours: 0.9999, remunerated_extra_hours: 0.5, standard_hours: 9, pause_minutes: 0, observations: '' }]
                }
            });
            const c = new env.fake.FakeEl('div');
            await env.ui.renderOvertimeTab(c);
            assert(!c.innerHTML.includes('60min'), 'sin 60min');
            assert(c.innerHTML.includes('+2h'), 'total mensual 2h');
            assert(c.innerHTML.includes('+1h'), 'extra del dia 1h');
            assert(c.innerHTML.includes('<b>9h</b>'), 'trabajado 9h');
        });

        suite.test('A2 alta manual: si guardar en SQLite falla se avisa con el error y el modal NO se cierra (no se pierde lo escrito)', async () => {
            const env = loadDbUi({ beta10DB: { init: async () => true, recordJornada: async () => { throw new Error('QuotaExceededError'); } } });
            env.ui.openAddManualJornadaModal();
            const modal = env.fake.document.body.lastChild;
            env.fake.document.getElementById('man-date').value = '2026-10-02';
            await modal.querySelector('#btn-save-man').onclick();
            assert(env.alerts.some(a => a.includes('No s\'ha pogut desar') && a.includes('QuotaExceededError')), JSON.stringify(env.alerts));
            assert(!env.alerts.some(a => a.includes('desada correctament')), 'sin exito falso');
            assert(env.fake.document.body.children.includes(modal), 'modal abierto');
        });

        suite.test('M11 auth.js: el nombre de usuario se escapa en el modal de la cuenta', async () => {
            const fake = createFakeDom();
            const sandbox = { document: fake.document, localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, console: { log() {}, warn() {}, error() {} }, btoa, atob, unescape, escape };
            sandbox.window = sandbox;
            vm.runInContext(fs.readFileSync(path.join(ROOT, 'auth.js'), 'utf8'), vm.createContext(sandbox));
            const mgr = sandbox.authManager;
            mgr.credentials = { username: '<img src=x onerror=alert(1)>', password: 'p' };
            mgr.isAuthenticated = true;
            mgr.showAccountModal();
            const html = fake.document.body.lastChild.innerHTML;
            assert(html.includes('&lt;img src=x'), 'escapado');
            assert(!html.includes('<img src=x'), 'sin etiqueta');
        });
    });
};
