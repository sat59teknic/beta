document.addEventListener('DOMContentLoaded', async () => {
    //
    // --- CONFIGURACIÓN ---
    // URL automática para Vercel
    const PROXY_URL = '/api/beta10'; 
    //
    // --- FIN DE LA CONFIGURACIÓN ---
    //

    // 🔐 VERIFICAR AUTENTICACIÓN AL INICIO
    console.log('🔐 Verificant autenticació...');
    
    // Probar conectividad con el backend primero
    try {
        const healthResponse = await fetch('/api/health');
        const healthData = await healthResponse.json();
        console.log('✅ Backend connectat:', healthData.message);
    } catch (error) {
        console.error('❌ Error de connectivitat backend:', error);
        alert('Error: No es pot connectar amb el servidor. Comprova la connexió.');
        return;
    }
    
    if (!authManager.hasValidCredentials()) {
        console.log('🔐 No hi ha credencials. Mostrant login...');
        try {
            await authManager.showLoginScreen();
            console.log('✅ Usuari autenticat correctament');
        } catch (error) {
            console.error('❌ Error en autenticació:', error);
            alert('Error d\'autenticació. Recarrega la pàgina.');
            return;
        }
    } else {
        console.log('✅ Credencials trobades. Usuari ja autenticat.');
    }

    // Añadir botón de cuenta al header
    addAccountButton();

    const PAUSE_LIMITS = {
        desayuno: 15 * 60 * 1000,
        comida: 30 * 60 * 1000
    };
    const PAUSE_ALARM_THRESHOLD = 14 * 60 * 1000; // 14 minutos
    const MIN_PAUSE_TIME = 10 * 60 * 1000; // 10 minutos
    const MIN_PAUSE_ALARM_TIME = 10 * 60 * 1000; // Alarma a los 10 minutos

    const dom = {
        connectionStatus: document.getElementById('connection-status'),
        gpsStatus: document.getElementById('gps-status'),
        currentStateText: document.getElementById('current-state-text'),
        workTimer: document.getElementById('work-timer'),
        pauseTimer: document.getElementById('pause-timer'),
        buttonContainer: document.getElementById('button-container'),
        logContainer: document.getElementById('log-container'),
        loadingOverlay: document.getElementById('loading-overlay'),
        loadingText: document.getElementById('loading-text'),
        infoMessage: document.getElementById('info-message'),
    };

    let appState = {
        currentState: 'FUERA', // FUERA, JORNADA, PAUSA, ALMACEN
        workStartTime: null,
        currentPauseStart: null,
        totalPauseTimeToday: 0,
        currentLocation: null,
        isAlarmPlaying: false,
        isMinPauseAlarmPlaying: false,
        minPauseAlarmTriggered: false
    };

    function saveState() {
        localStorage.setItem('beta10AppState', JSON.stringify(appState));
    }

    function loadState() {
        const savedState = localStorage.getItem('beta10AppState');
        if (savedState) {
            const parsedState = JSON.parse(savedState);
            // Convertir strings de fecha a objetos Date
            appState = {
                ...parsedState,
                workStartTime: parsedState.workStartTime ? new Date(parsedState.workStartTime) : null,
                currentPauseStart: parsedState.currentPauseStart ? new Date(parsedState.currentPauseStart) : null,
            };
            logActivity("Estat recuperat de la sessió anterior.");
        }
    }
    
    function logActivity(message) {
        const now = new Date().toLocaleTimeString('es-ES');
        const p = document.createElement('p');
        p.textContent = `[${now}] ${message}`;
        dom.logContainer.prepend(p);
        
        // Limitar a 50 entradas en el log
        while (dom.logContainer.children.length > 50) {
            dom.logContainer.removeChild(dom.logContainer.lastChild);
        }
    }

    function showLoading(visible, text = 'Processant...') {
        dom.loadingText.textContent = text;
        dom.loadingOverlay.classList.toggle('visible', visible);
    }

    async function getCurrentLocation() {
        showLoading(true, 'Obtenint GPS...');
        dom.gpsStatus.className = 'status-indicator yellow';
        return new Promise((resolve, reject) => {
            if (!navigator.geolocation) {
                dom.gpsStatus.className = 'status-indicator red';
                return reject(new Error('GPS no suportat pel navegador.'));
            }
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    appState.currentLocation = {
                        latitude: position.coords.latitude,
                        longitude: position.coords.longitude,
                        accuracy: position.coords.accuracy,
                        timestamp: new Date().toISOString()
                    };
                    if (isNaN(appState.currentLocation.latitude)) {
                        dom.gpsStatus.className = 'status-indicator red';
                        return reject(new Error('Coordenades GPS invàlides.'));
                    }
                    dom.gpsStatus.className = 'status-indicator green';
                    logActivity(`GPS OK: ${appState.currentLocation.latitude.toFixed(4)}, ${appState.currentLocation.longitude.toFixed(4)}`);
                    resolve(appState.currentLocation);
                },
                (error) => {
                    let errorMsg = 'Error GPS desconegut.';
                    if (error.code === 1) errorMsg = 'Permís GPS denegat. Habilita\'l a configuració.';
                    if (error.code === 2) errorMsg = 'Senyal GPS no disponible. Vés a un lloc obert.';
                    if (error.code === 3) errorMsg = 'Timeout de GPS. Reintenta.';
                    dom.gpsStatus.className = 'status-indicator red';
                    reject(new Error(errorMsg));
                },
                { enableHighAccuracy: true, timeout: 20000, maximumAge: 30000 }
            );
        });
    }

    // Función para mostrar modal de observaciones
    function showObservationsModal(extraText = '') {
        return new Promise((resolve) => {
            const modal = document.createElement('div');
            modal.className = 'modal-overlay';
            const placeholder = extraText ? `${extraText} Client (ex: +30min Joan Molina)` : "Introdueix observacions";
            modal.innerHTML = `
                <div class="modal-content">
                    <h3>Observacions</h3>
                    <textarea id="observations-input" placeholder="${placeholder}" maxlength="200"></textarea>
                    <div class="modal-buttons">
                        <button class="btn btn-secondary" onclick="closeModal(false)">Cancel·lar</button>
                        <button class="btn btn-start" onclick="closeModal(true)">Confirmar</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
            
            // Enfocar en el textarea
            setTimeout(() => {
                document.getElementById('observations-input').focus();
            }, 100);
            
            window.closeModal = (confirmed) => {
                const observations = confirmed ? document.getElementById('observations-input').value : '';
                document.body.removeChild(modal);
                resolve(observations);
                delete window.closeModal;
            };
        });
    }

    // Detectar si son horas extra
    function calculateExtraHours() {
        if (!appState.workStartTime) return { extraHours: 0, totalHours: 0, extraBlocks: 0 };
        
        const now = new Date();
        const workDuration = now - appState.workStartTime - appState.totalPauseTimeToday;
        let currentPauseDuration = 0;
        
        if (appState.currentState === 'PAUSA' && appState.currentPauseStart) {
            currentPauseDuration = now - appState.currentPauseStart;
        }
        
        // Tiempo total de jornada = tiempo trabajado + tiempo de pausa
        const totalWorkTime = workDuration / (1000 * 60 * 60); // Solo tiempo trabajado
        const totalPauseTime = (appState.totalPauseTimeToday + currentPauseDuration) / (1000 * 60 * 60);
        const totalJourneyTime = totalWorkTime + totalPauseTime; // Jornada completa
        
        const standardWorkDay = 9; // 9 horas estándar (trabajo + pausa)
        const extraTime = Math.max(0, totalJourneyTime - standardWorkDay);
        
        // Solo contar como extra si es >= 30 minutos
        const extraHours = extraTime >= 0.5 ? extraTime : 0;
        const extraBlocks = Math.floor(extraHours / 0.5); // Bloques de 30min
        
        return { 
            extraHours: extraHours, 
            totalHours: totalJourneyTime,
            extraBlocks: extraBlocks
        };
    }

    // --- FUNCIONES DE AUTENTICACIÓN ---
    
    function addAccountButton() {
        // Crear botón de cuenta en el header
        const header = document.querySelector('.header');
        const accountBtn = document.createElement('button');
        accountBtn.className = 'account-btn';
        accountBtn.innerHTML = '👤';
        accountBtn.title = 'Mi cuenta';
        accountBtn.onclick = () => authManager.showAccountModal();
        
        // Insertar antes del indicador GPS
        const gpsStatus = document.getElementById('gps-status');
        header.insertBefore(accountBtn, gpsStatus);
    }

    async function sendToProxy(action, point, observations = '') {
        if (!appState.currentLocation) {
            throw new Error("Ubicació GPS no disponible.");
        }
        
        // 🔐 OBTENER CREDENCIALES DEL USUARIO ACTUAL
        const credentials = authManager.getCredentials();
        if (!credentials) {
            throw new Error("No hay credenciales de usuario. Inicia sesión.");
        }
        
        const startTime = performance.now();
        showLoading(true, `Registrando ${action} (${point})...`);
        dom.connectionStatus.className = 'status-indicator yellow';
        
        try {
            const response = await fetch(PROXY_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: action,
                    point: point,
                    location: appState.currentLocation,
                    observations: observations,
                    // 🔐 ENVIAR CREDENCIALES DINÁMICAS
                    credentials: credentials
                })
            });

            const result = await response.json();

            if (!response.ok || !result.success) {
                throw new Error(result.error || `Error en el servidor (HTTP ${response.status})`);
            }
            
            const duration = Math.round(performance.now() - startTime);
            dom.connectionStatus.className = 'status-indicator green';
            const obsText = observations ? ` - Obs: ${observations.substring(0, 30)}...` : '';
            const userText = credentials.username ? ` [${credentials.username}]` : '';
            logActivity(`✅ Beta10 OK (${duration}ms): ${action} con punto '${point}' registrado${obsText}${userText}`);
            return result;

        } catch (error) {
            dom.connectionStatus.className = 'status-indicator red';
            logActivity(`❌ ERROR: ${error.message}`);
            throw error;
        } finally {
            showLoading(false);
        }
    }

    // --- FUNCIONES DE TRANSICIÓN DE ESTADO ---

    async function handleAction(actions) {
        try {
            await getCurrentLocation();
            
            // Si es finalizar jornada y hay horas extra, pedir observaciones
            let observations = '';
            const isEndingWorkday = actions.some(a => a.newState === 'FUERA');
            if (isEndingWorkday) {
                const extraInfo = calculateExtraHours();
                if (extraInfo.extraHours >= 0.5) { // 30 minutos o más
                    const extraBlocks = extraInfo.extraBlocks;
                    let extraText = '';
                    if (extraBlocks === 1) {
                        extraText = '+30min';
                    } else if (extraBlocks === 2) {
                        extraText = '+1h';
                    } else {
                        const hours = Math.floor(extraBlocks / 2);
                        const mins = (extraBlocks % 2) * 30;
                        if (mins === 0) {
                            extraText = `+${hours}h`;
                        } else {
                            extraText = `+${hours}h${mins}min`;
                        }
                    }
                    const shouldAddObs = confirm(`Detectades ${extraText} d'hores extra. Vols afegir observacions?`);
                    if (shouldAddObs) {
                        observations = await showObservationsModal(extraText);
                    }
                }
            }
            
            for (const { action, point, newState, onComplete } of actions) {
                await sendToProxy(action, point, observations);
                if (newState) appState.currentState = newState;
                if (onComplete) onComplete();
                saveState();
                updateUI();
            }
        } catch (error) {
            alert(`Error: ${error.message}`);
            showLoading(false);
        }
    }

    // Función para añadir observaciones manualmente
    async function addObservationsManually() {
        const observations = await showObservationsModal();
        if (observations.trim()) {
            logActivity(`📝 Observacions afegides: ${observations}`);
            // Aquí podrías enviar las observaciones a un endpoint específico si fuera necesario
        }
    }

    function startWorkday() {
        handleAction([
            {
                action: 'entrada', point: 'J', newState: 'JORNADA',
                onComplete: () => { appState.workStartTime = new Date(); }
            }
        ]);
    }
    
    function startAlmacen() {
        handleAction([
            {
                action: 'entrada', point: '9', newState: 'ALMACEN',
                onComplete: () => { appState.workStartTime = new Date(); }
            }
        ]);
    }

    function endAlmacenAndStartWorkday() {
        handleAction([
            { action: 'salida', point: '9' },
            { action: 'entrada', point: 'J', newState: 'JORNADA' }
        ]);
    }

    function startPause() {
        handleAction([
            { action: 'salida', point: 'J' },
            {
                action: 'entrada', point: 'P', newState: 'PAUSA',
                onComplete: () => { 
                    appState.currentPauseStart = new Date();
                    // Resetear alarmas para nueva pausa
                    appState.minPauseAlarmTriggered = false;
                    appState.isMinPauseAlarmPlaying = false;
                }
            }
        ]);
    }

    function endPause() {
        handleAction([
            { action: 'salida', point: 'P' },
            {
                action: 'entrada', point: 'J', newState: 'JORNADA',
                onComplete: () => {
                    if (appState.currentPauseStart) {
                        const pauseDuration = new Date() - appState.currentPauseStart;
                        appState.totalPauseTimeToday += pauseDuration;
                        appState.currentPauseStart = null;
                        // Resetear todas las alarmas
                        stopAlarm();
                        appState.minPauseAlarmTriggered = false;
                        appState.isMinPauseAlarmPlaying = false;
                    }
                }
            }
        ]);
    }

    function endWorkday() {
        const actions = [];
        if (appState.currentState === 'PAUSA') {
            actions.push({ action: 'salida', point: 'P' });
        }
        if (appState.currentState === 'ALMACEN') {
            actions.push({ action: 'salida', point: '9' });
        } else {
             actions.push({ action: 'salida', point: 'J' });
        }
       
        actions[actions.length - 1].newState = 'FUERA';
        actions[actions.length - 1].onComplete = () => {
             // Reset para el día siguiente
            appState.workStartTime = null;
            appState.currentPauseStart = null;
            appState.totalPauseTimeToday = 0;
            stopAlarm();
        };

        handleAction(actions);
    }

    // --- SISTEMA DE ALARMAS ---
    
    function createBeepSound(type = 'normal') {
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            
            // Diferentes sonidos según el tipo
            if (type === 'minpause') {
                // Sonido suave para pausa mínima completada
                oscillator.frequency.value = 600;
                oscillator.type = 'sine';
                gainNode.gain.setValueAtTime(0.2, audioContext.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 1.0);
                oscillator.start(audioContext.currentTime);
                oscillator.stop(audioContext.currentTime + 1.0);
            } else {
                // Sonido normal para pausas excesivas
                oscillator.frequency.value = 800;
                oscillator.type = 'sine';
                gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
                oscillator.start(audioContext.currentTime);
                oscillator.stop(audioContext.currentTime + 0.5);
            }
        } catch (e) {
            console.log('No se pudo reproducir el sonido');
        }
    }

    function playMinPauseAlarm() {
        if (!appState.isMinPauseAlarmPlaying && !appState.minPauseAlarmTriggered) {
            appState.isMinPauseAlarmPlaying = true;
            appState.minPauseAlarmTriggered = true;
            
            // Vibrar el móvil si está disponible
            if ('vibrate' in navigator) {
                navigator.vibrate([500, 200, 500, 200, 500]);
            }
            
            // Sonido suave de notificación
            createBeepSound('minpause');
            
            // Mostrar notificación
            dom.infoMessage.textContent = "✅ Pausa mínima completada. Ya puedes volver.";
            dom.infoMessage.classList.add('success');
            
            // Ocultar mensaje después de 5 segundos
            setTimeout(() => {
                dom.infoMessage.classList.remove('success');
                dom.infoMessage.textContent = "";
                appState.isMinPauseAlarmPlaying = false;
            }, 5000);
            
            logActivity('✅ Pausa mínima de 10 min completada');
        }
    }

    function playAlarm() {
        if (!appState.isAlarmPlaying) {
            appState.isAlarmPlaying = true;
            dom.infoMessage.textContent = "¡Tiempo de pausa excedido! 🚨";
            dom.infoMessage.classList.add('alert');
            
            // Reproducir sonido cada 10 segundos
            const alarmInterval = setInterval(() => {
                if (appState.isAlarmPlaying) {
                    createBeepSound();
                } else {
                    clearInterval(alarmInterval);
                }
            }, 10000);
            
            createBeepSound(); // Primer sonido inmediato
        }
    }

    function stopAlarm() {
        appState.isAlarmPlaying = false;
        dom.infoMessage.classList.remove('alert');
        dom.infoMessage.textContent = "";
    }

    // --- ACTUALIZACIÓN DE UI Y TIMERS ---
    
    function formatTime(ms) {
        if (ms < 0) ms = 0;
        const totalSeconds = Math.floor(ms / 1000);
        const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
        const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
        const seconds = String(totalSeconds % 60).padStart(2, '0');
        return `${hours}:${minutes}:${seconds}`;
    }

    function updateTimers() {
        if (appState.currentState === 'FUERA') {
            dom.workTimer.textContent = '00:00:00';
            dom.pauseTimer.textContent = '00:00:00';
            return;
        }

        if (appState.workStartTime) {
            const now = new Date();
            let workDuration = now - appState.workStartTime - appState.totalPauseTimeToday;
            
            if (appState.currentState === 'PAUSA' && appState.currentPauseStart) {
                const currentPauseDuration = now - appState.currentPauseStart;
                workDuration -= currentPauseDuration; // Restar la pausa actual que aún no está en el total
                dom.pauseTimer.textContent = formatTime(currentPauseDuration);

                // Control de alarma de pausa mínima (10 minutos)
                if (currentPauseDuration >= MIN_PAUSE_ALARM_TIME) {
                    playMinPauseAlarm();
                }

                // Control de alarma de pausa excesiva (14 minutos)
                if (currentPauseDuration > PAUSE_ALARM_THRESHOLD) {
                    playAlarm();
                }

            } else {
                dom.pauseTimer.textContent = formatTime(appState.totalPauseTimeToday);
            }
            dom.workTimer.textContent = formatTime(workDuration);
        }
    }
    
    function generateDynamicButtons() {
        dom.buttonContainer.innerHTML = ''; // Limpiar botones
        
        const createButton = (text, className, action, disabled = false) => {
            const btn = document.createElement('button');
            btn.textContent = text;
            btn.className = `btn ${className}`;
            btn.onclick = action;
            btn.disabled = disabled;
            dom.buttonContainer.appendChild(btn);
        };

        switch (appState.currentState) {
            case 'FUERA':
                createButton('▶️ Iniciar Jornada (J)', 'btn-start', startWorkday);
                createButton('📦 Iniciar Magatzem (9)', 'btn-secondary', startAlmacen);
                break;
            case 'ALMACEN':
                 createButton('▶️ Sortir Magatzem i Iniciar Jornada (9 → J)', 'btn-start', endAlmacenAndStartWorkday);
                 createButton('⛔ Finalitzar Jornada', 'btn-stop', endWorkday);
                 createButton('📝 Afegir Observacions', 'btn-secondary', addObservationsManually);
                break;
            case 'JORNADA':
                createButton('⏸️ Iniciar Pausa (P)', 'btn-pause', startPause);
                createButton('⛔ Finalitzar Jornada (J)', 'btn-stop', endWorkday);
                createButton('📝 Afegir Observacions', 'btn-secondary', addObservationsManually);
                break;
            case 'PAUSA':
                const inPauseFor = appState.currentPauseStart ? new Date() - appState.currentPauseStart : 0;
                const canEndPause = inPauseFor > MIN_PAUSE_TIME;
                createButton(
                    `▶️ Tornar de Pausa (P → J)`, 
                    'btn-start', 
                    endPause, 
                    !canEndPause
                );
                if(!canEndPause){
                   const remaining = formatTime(MIN_PAUSE_TIME - inPauseFor);
                   dom.infoMessage.textContent = `Pausa mínima de 10 min. Falten ${remaining}`;
                   dom.infoMessage.classList.add('alert');
                } else if(!appState.isAlarmPlaying) {
                   dom.infoMessage.classList.remove('alert');
                }
                createButton('⛔ Finalitzar Jornada', 'btn-stop', endWorkday);
                createButton('📝 Afegir Observacions', 'btn-secondary', addObservationsManually);
                break;
        }
    }
    
    function updateUI() {
        let stateText = '--';
        switch (appState.currentState) {
            case 'FUERA': stateText = 'Fora de Jornada'; break;
            case 'JORNADA': stateText = 'En Jornada'; break;
            case 'PAUSA': stateText = 'En Pausa'; break;
            case 'ALMACEN': stateText = 'En Magatzem'; break;
        }
        dom.currentStateText.textContent = stateText;
        generateDynamicButtons();
    }
    
    // --- INICIALIZACIÓN OPTIMIZADA PARA VERCEL ---
    function init() {
        loadState();
        updateUI();
        
        // Actualizar timers cada segundo
        setInterval(() => {
            updateTimers();
            generateDynamicButtons(); // Para actualizar el estado del botón de pausa
        }, 1000);
        
        // Petición inicial para calentar GPS
        getCurrentLocation().catch(err => {
            logActivity(`⚠️ Error inicial GPS: ${err.message}`);
            // No mostrar alert en inicialización automática
        }).finally(() => {
            showLoading(false);
        });
        
        // Registrar el Service Worker para PWA
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('/service-worker.js')
                .then(reg => logActivity('✅ Service Worker registrat amb èxit.'))
                .catch(err => logActivity(`❌ Error en registrar Service Worker: ${err}`));
        }
        
        logActivity('🚀 Beta10 Control iniciat');
        logActivity('✅ Sistema operatiu');
    }

    init();
});
