const CACHE_NAME = 'beta10-v5-design-refresh';
const urlsToCache = [
    '/',
    '/index.html',
    '/style.css',
    '/script.js',
    '/db.js',
    '/db-ui.js',
    '/sql-wasm.js',
    '/sql-wasm.wasm',
    '/alarm.wav',
    '/silence.wav',
    '/manifest.json'
];

// Variables para manejar alarmas programadas
let scheduledNotification = null;
let alarmTimeout = null;

self.addEventListener('install', event => {
    console.log('🚀 Service Worker: Instal·lant...');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('✅ Service Worker: Fitxers cachejats');
                return cache.addAll(urlsToCache);
            })
    );
});

self.addEventListener('fetch', event => {
    // Solo cachear recursos estáticos, no las API calls
    if (event.request.url.includes('/api/')) {
        // Dejar que las API calls pasen directamente (sin cache)
        return;
    }
    
    event.respondWith(
        caches.match(event.request)
            .then(response => {
                // Cache hit - return response
                if (response) {
                    console.log('📦 Servint des de cache:', event.request.url);
                    return response;
                }
                
                // Fetch desde la red
                console.log('🌐 Fetch des de xarxa:', event.request.url);
                return fetch(event.request).then(response => {
                    // Verificar si recibimos una respuesta válida
                    if (!response || response.status !== 200 || response.type !== 'basic') {
                        return response;
                    }
                    
                    // Clonar la respuesta
                    const responseToCache = response.clone();
                    
                    caches.open(CACHE_NAME)
                        .then(cache => {
                            cache.put(event.request, responseToCache);
                        });
                    
                    return response;
                });
            }
        )
    );
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
        })
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
