// Canviar CACHE_NAME en cada release que toqui fitxers de la llista: força el reinici del cache.
const CACHE_NAME = 'beta10-v7-network-first';

// TOTS els fitxers locals que carrega index.html (i els recursos de l'app) han d'estar aquí perquè
// l'app arrenqui sense connexió (M13). Hi ha un test que ho comprova contra index.html i el disc.
const urlsToCache = [
    '/',
    '/index.html',
    '/style.css',
    '/auth.css',
    '/error-styles.css',
    '/script.js',
    '/auth.js',
    '/beta10-direct.js',
    '/error-manager.js',
    '/db.js',
    '/db-ui.js',
    '/sql-wasm.js',
    '/sql-wasm.wasm',
    '/alarm.wav',
    '/silence.wav',
    '/manifest.json',
    '/icon-192.svg',
    '/icon-512.svg'
];

// Variables para manejar alarmas programadas
let scheduledNotification = null;
let alarmTimeout = null;

self.addEventListener('install', event => {
    console.log('🚀 Service Worker: Instal·lant...');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                // add() un a un: amb addAll() UN sol 404 feia fallar tota la instal·lació del SW
                return Promise.all(urlsToCache.map(url =>
                    cache.add(url).catch(err => console.warn("⚠️ No s'ha pogut cachejar", url, err))
                ));
            })
            // El SW nou pren el control sense esperar que es tanquin totes les pestanyes
            .then(() => self.skipWaiting())
    );
});

function isCodeRequest(request, url) {
    return request.mode === 'navigate'
        || url.pathname === '/'
        || /\.(?:html|js|css|json)$/.test(url.pathname);
}

function isCacheable(response) {
    return response && response.status === 200 && response.type === 'basic';
}

// Codi i pàgines: XARXA PRIMER. Amb cache-first, un script.js vell quedava servit per sempre
// (el navegador no tornava a demanar-lo) i els fixos no arribaven mai a l'usuari.
async function networkFirst(request) {
    try {
        const response = await fetch(request);
        if (isCacheable(response)) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, copy)).catch(() => {});
        }
        return response;
    } catch (error) {
        const cached = await caches.match(request, { ignoreSearch: true });
        if (cached) return cached;
        if (request.mode === 'navigate') {
            const shell = await caches.match('/index.html');
            if (shell) return shell;
        }
        return new Response('Sense connexió i recurs no disponible a la memòria cau', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
    }
}

// Recursos pesats i estables (àudio, wasm, icones): CACHE PRIMER
async function cacheFirst(request) {
    const cached = await caches.match(request);
    if (cached) return cached;
    try {
        const response = await fetch(request);
        if (isCacheable(response)) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, copy)).catch(() => {});
        }
        return response;
    } catch (error) {
        return new Response('Sense connexió i recurs no disponible', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
    }
}

self.addEventListener('fetch', event => {
    const request = event.request;
    // Només GET del mateix origen; res de l'API (sempre xarxa) ni de tercers (fonts, etc.)
    if (request.method !== 'GET') return;
    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;
    if (url.pathname.startsWith('/api/')) return;

    event.respondWith(isCodeRequest(request, url) ? networkFirst(request) : cacheFirst(request));
});

self.addEventListener('activate', event => {
    console.log('🔄 Service Worker: Activant...');
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('🗑️ Eliminant cache antiga:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// 🔔 NUEVO: Manejar mensajes para programar notificaciones
self.addEventListener('message', event => {
    console.log('📨 Service Worker: Mensaje recibido', event.data);

    if (event.data && event.data.type === 'SCHEDULE_NOTIFICATION') {
        scheduleNotification(event.data.pauseType, event.data.delayMs, event.data.timeLimit);
    }

    if (event.data && event.data.type === 'CANCEL_NOTIFICATION') {
        cancelNotification();
    }

    // 🐛 FIX #4: Cancelar alarma del SW si la app principal ya la activó
    if (event.data && event.data.type === 'ALARM_ALREADY_TRIGGERED') {
        console.log('🔕 Alarma ya activada localmente, cancelando timeout del SW');
        cancelNotification();
    }

    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

// 🔔 Programar notificación
// LIMITACIÓ (plataforma, no corregible aquí): aquest setTimeout viu només mentre el navegador
// mantingui viu el service worker. Amb el navegador tancat o la pantalla apagada Chrome/Android
// pot aturar el SW i l'alarma NO sonarà. L'alarma fiable és la de l'APK (AlarmManager nadiu).
function scheduleNotification(pauseType, delayMs, timeLimit) {
    console.log(`🔔 Programando notificación: ${pauseType} en ${delayMs}ms (${timeLimit}min)`);
    
    // Cancelar alarma anterior si existe
    if (alarmTimeout) {
        clearTimeout(alarmTimeout);
    }
    
    // Programar nueva alarma
    alarmTimeout = setTimeout(() => {
        console.log(`🚨 Activando alarma: ${pauseType} (${timeLimit}min)`);
        
        // Enviar notificación del sistema
        showNotification(pauseType, timeLimit);
        
        // Enviar mensaje a la app principal si está disponible
        self.clients.matchAll().then(clients => {
            clients.forEach(client => {
                client.postMessage({
                    type: 'PAUSE_ALARM',
                    pauseType: pauseType,
                    timeLimit: timeLimit
                });
            });
        });
        
    }, delayMs);
}

// 🔔 Cancelar notificación programada
function cancelNotification() {
    console.log('🔕 Cancelando notificación programada');
    if (alarmTimeout) {
        clearTimeout(alarmTimeout);
        alarmTimeout = null;
    }
}

// 🔔 Mostrar notificación del sistema
function showNotification(pauseType, timeLimit) {
    const title = '⏰ Temps de pausa completat!';
    const body = `Has completat els ${timeLimit} minuts de ${pauseType}. Torna a la jornada laboral.`;
    
    const options = {
        body: body,
        icon: '/icon-192.svg',
        badge: '/icon-192.svg',
        tag: 'pause-alarm',
        requireInteraction: true,
        renotify: true,
        silent: false,
        sound: '/alarm.wav',
        vibrate: [800, 200, 800, 200, 800, 200, 1200, 300, 1200],
        actions: [
            {
                action: 'silence',
                title: '🔕 Silenciar Alarma',
                icon: '/icon-192.svg'
            },
            {
                action: 'return-to-work',
                title: '▶️ Tornar a la jornada',
                icon: '/icon-192.svg'
            }
        ],
        data: {
            pauseType: pauseType,
            timeLimit: timeLimit,
            url: '/'
        }
    };
    
    self.registration.showNotification(title, options);
}

// 🔔 Manejar clics en notificaciones
self.addEventListener('notificationclick', event => {
    console.log('🔔 Notificación clickeada:', event.notification.tag, 'Acción:', event.action);
    
    event.notification.close();
    
    // Si l'usuari clica expressament a "Silenciar Alarma"
    if (event.action === 'silence') {
        self.clients.matchAll().then(clients => {
            clients.forEach(client => {
                client.postMessage({ type: 'STOP_ALARM' });
            });
        });
        return;
    }
    
    // Abrir o enfocar la app
    event.waitUntil(
        self.clients.matchAll().then(clients => {
            // Si ya hay una ventana abierta, enfocarla
            for (const client of clients) {
                if (client.url === self.location.origin + '/' && 'focus' in client) {
                    return client.focus();
                }
            }
            
            // Si no hay ventana abierta, abrir una nueva
            if (self.clients.openWindow) {
                return self.clients.openWindow('/');
            }
        })
    );
});

// 🔔 Manejar cierre de notificaciones (lliscament/descartat)
self.addEventListener('notificationclose', event => {
    console.log('🔕 Notificación cerrada o descartada:', event.notification.tag);
    // Quan l'usuari descarta la notificació, silenciar l'alarma
    self.clients.matchAll().then(clients => {
        clients.forEach(client => {
            client.postMessage({ type: 'STOP_ALARM' });
        });
    });
});

console.log('✅ Service Worker: Cargado con soporte para alarmas');
