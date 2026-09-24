document.addEventListener('DOMContentLoaded', async () => {
    //
    // --- CONFIGURACIÓN ---
    // URL automática para Vercel
    const PROXY_URL = '/api/beta10'; 
    //
    // --- FIN DE LA CONFIGURACIÓN ---
    //

    // 🎯 ELEMENTS DEL DOM (declarats al principi per evitar ReferenceError)
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

    // 🔐 VERIFICAR AUTENTICACIÓN AL INICIO
    console.log('🔐 Verificant autenticació...');
    
    let hasServerAuth = false;
    let serverAuthSource = null;
    const isNativeApp = typeof Beta10Direct !== 'undefined' && Beta10Direct.isNative();

    if (isNativeApp) {
        console.log('📱 Mode App Nativa Android detectat (connexió directa)');
        if (dom.connectionStatus) dom.connectionStatus.className = 'status-indicator green';
    } else {
        // Probar conectividad con el backend primero en entorno web
        try {
            const healthResponse = await fetch('/api/health');
            const healthData = await healthResponse.json();
            console.log('✅ Backend connectat:', healthData.message);
            if (healthData.hasServerCredentials) {
                hasServerAuth = true;
                serverAuthSource = healthData.credentialsSource;
                console.log('🛡️ Credencials segures detectades al servidor (origen:', serverAuthSource, ')');
            }
            if (dom.connectionStatus) dom.connectionStatus.className = 'status-indicator green';
        } catch (error) {
            console.warn('⚠️ No s\'ha pogut connectar amb el backend (mode offline o error de xarxa):', error);
            if (dom.connectionStatus) dom.connectionStatus.className = 'status-indicator red';
        }
    }
    
    if (!hasServerAuth && !authManager.hasValidCredentials()) {
        console.log('🔐 No hi ha credencials al servidor ni locals. Mostrant login...');
        try {
            await authManager.showLoginScreen();
            console.log('✅ Usuari autenticat correctament');
        } catch (error) {
            console.error('❌ Error en autenticació:', error);
            alert('Error d\'autenticació. Recarrega la pàgina.');
            return;
        }
    } else {
        if (hasServerAuth) {
            console.log('✅ Autenticació del servidor llesta (credencials xifrades).');
        } else {
            console.log('✅ Credencials trobades a local. Usuari ja autenticat.');
        }
    }

    // Añadir botón de cuenta al header
    addAccountButton();

    const PAUSE_LIMITS = {
        esmorçar: 10 * 60 * 1000, // 10 minutos
        dinar: 30 * 60 * 1000     // 30 minutos
    };

    let appState = {
        currentState: 'FUERA', // FUERA, JORNADA, PAUSA, ALMACEN
        workStartTime: null,
        currentPauseStart: null,
        currentPauseType: null, // 'esmorçar' o 'dinar'
        totalPauseTimeToday: 0,
        currentLocation: null,
        isAlarmPlaying: false,
        pauseAlarmTriggered: false,
        lastAlarmTime: null, // 🔧 Para permitir alarmas recurrentes
        alarmSource: null, // 🐛 FIX: Tracking de fuente de alarma ('local' o 'service-worker')
        wakeLock: null, // Para mantener pantalla activa
        wakeLockLost: false, // 🐛 FIX: Flag para detectar si se perdió el wake lock
        // 🆕 NUEVOS CAMPOS PARA HORARIOS DINÁMICOS
        workDayStandard: null, // 8 o 9 según el día
        workDayType: null,     // "Divendres", "Dilluns-Dijous", "Dissabte"
        workStartDay: null     // Día de inicio de jornada
    };

    // 🔧 Variable para detectar cambios de estado y evitar regeneración innecesaria de botones
    let lastKnownState = null;

    // 🚨 BUG FIX #1: Variable global para intervalo de alarma (evita múltiples intervalos simultáneos)
    let alarmIntervalGlobal = null;

    function saveState() {
        localStorage.setItem('beta10AppState', JSON.stringify(appState));
    }

    function loadState() {
        const savedState = localStorage.getItem('beta10AppState');
        if (savedState) {
            const parsedState = JSON.parse(savedState);

            // 🚨 BUG FIX #2: VALIDAR timestamps antes de usar
            const workStartTime = parsedState.workStartTime ? new Date(parsedState.workStartTime) : null;
            const currentPauseStart = parsedState.currentPauseStart ? new Date(parsedState.currentPauseStart) : null;
            const lastAlarmTime = parsedState.lastAlarmTime ? new Date(parsedState.lastAlarmTime) : null;

            // VERIFICAR si las fechas son válidas
            const isValidWorkStart = workStartTime && !isNaN(workStartTime.getTime());
            const isValidPauseStart = currentPauseStart && !isNaN(currentPauseStart.getTime());
            const isValidAlarmTime = lastAlarmTime && !isNaN(lastAlarmTime.getTime());

            // Convertir strings de fecha a objetos Date
            appState = {
                ...parsedState,
                workStartTime: isValidWorkStart ? workStartTime : null,
                currentPauseStart: isValidPauseStart ? currentPauseStart : null,
                currentPauseType: parsedState.currentPauseType || null,
                lastAlarmTime: isValidAlarmTime ? lastAlarmTime : null,
                // 🆕 MANTENER HORARIO DINÁMICO
                workDayStandard: parsedState.workDayStandard || null,
                workDayType: parsedState.workDayType || null,
                workStartDay: parsedState.workStartDay || null
            };

            // LOG si hay timestamps inválidos
            if (!isValidWorkStart && parsedState.workStartTime) {
                logActivity('⚠️ Timestamp de inicio de jornada inválido - resetejat');
            }
            if (!isValidPauseStart && parsedState.currentPauseStart) {
                logActivity('⚠️ Timestamp de inicio de pausa inválido - resetejat');
            }

            if (appState.workDayType) {
                logActivity(`Estat recuperat: ${appState.workDayType} (${getStandardWorkDayFormatted(appState.workDayStandard)})`);
            } else {
                logActivity("Estat recuperat de la sessió anterior.");
            }
        }
        // 🔧 Inicializar lastKnownState después de cargar el estado
        lastKnownState = appState.currentState;
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

    // Función para traducir errores automáticamente
    function translateError(error) {
        const errorMessage = error.message || error.toString();
        const lowerError = errorMessage.toLowerCase();
        
        // Errores GPS con códigos
        if (error.code === 1) {
            return 'Has denegat el permís de localització. Habilita\'l per continuar.';
        }
        if (error.code === 2) {
            return 'No es pot obtenir la ubicació. Vés a un lloc obert.';
        }
        if (error.code === 3) {
            return 'El GPS triga massa temps. Reintenta en uns segons.';
        }
        
        // Errores de red
        if (lowerError.includes('failed to fetch') || 
            lowerError.includes('network error') || 
            lowerError.includes('fetch')) {
            return 'No tens connexió a internet. Comprova la xarxa i torna-ho a intentar.';
        }
        
        if (lowerError.includes('timeout') || 
            lowerError.includes('timed out')) {
            return 'La connexió ha trigat massa temps. Comprova la xarxa.';
        }
        
        if (lowerError.includes('cors') || 
            lowerError.includes('cross-origin')) {
            return 'Error de configuració del servidor. Contacta amb administració.';
        }
        
        // Errores GPS por mensaje
        if (lowerError.includes('gps no suportat') || 
            lowerError.includes('geolocation not supported')) {
            return 'El teu dispositiu no suporta GPS. Canvia de navegador.';
        }
        
        if (lowerError.includes('coordenades gps invàlides')) {
            return 'Les coordenades obtingudes no són vàlides. Reintenta.';
        }
        
        // Errores de autenticación
        if (lowerError.includes('credencials incorrectes') || 
            lowerError.includes('login falló') || 
            lowerError.includes('unauthorized')) {
            return 'Usuari o contrasenya incorrectes. Revisa les credencials.';
        }
        
        // Errores del servidor
        if (lowerError.includes('http 500') || 
            lowerError.includes('internal server error')) {
            return 'El servidor Beta10 té problemes. Prova més tard.';
        }
        
        if (lowerError.includes('http 404') || 
            lowerError.includes('not found')) {
            return 'La pàgina Beta10 no existeix. Comprova la configuració.';
        }
        
        // Si no es puede traducir, devolver el original
        return errorMessage;
    }
    
    // Función para mostrar errores traducidos
    function showTranslatedError(error) {
        const translatedMessage = translateError(error);
        alert(translatedMessage);
        logActivity(`❌ ERROR: ${translatedMessage}`);
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
                const error = new Error('GPS no suportat pel navegador.');
                showTranslatedError(error);
                return reject(error);
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
                        const error = new Error('Coordenades GPS invàlides.');
                        showTranslatedError(error);
                        return reject(error);
                    }
                    dom.gpsStatus.className = 'status-indicator green';
                    logActivity(`GPS OK: ${appState.currentLocation.latitude.toFixed(4)}, ${appState.currentLocation.longitude.toFixed(4)}`);
                    resolve(appState.currentLocation);
                },
                (error) => {
                    dom.gpsStatus.className = 'status-indicator red';
                    showTranslatedError(error);
                    reject(error);
                },
                { enableHighAccuracy: true, timeout: 20000, maximumAge: 30000 }
            );
        });
    }

    // Función para mostrar modal de selección de tipo de pausa
    function showPauseTypeModal() {
        return new Promise((resolve) => {
            const modal = document.createElement('div');
            modal.className = 'modal-overlay';
            modal.innerHTML = `
                <div class="modal-content">
                    <h3>Tipus de Pausa</h3>
                    <p>Selecciona el tipus de pausa que vols iniciar:</p>
                    <div class="pause-type-buttons">
                        <button class="btn btn-secondary pause-type-btn" onclick="selectPauseType('esmorçar')">
                            🥐 Esmorçar
                            <small>10 minuts</small>
                        </button>
                        <button class="btn btn-secondary pause-type-btn" onclick="selectPauseType('dinar')">
                            🍽️ Dinar
                            <small>30 minuts</small>
                        </button>
                    </div>
                    <div class="modal-buttons">
                        <button class="btn btn-secondary" onclick="cancelPauseType()">Cancel·lar</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
            
            window.selectPauseType = (type) => {
                document.body.removeChild(modal);
                resolve(type);
                delete window.selectPauseType;
                delete window.cancelPauseType;
            };
            
            window.cancelPauseType = () => {
                document.body.removeChild(modal);
                resolve(null);
                delete window.selectPauseType;
                delete window.cancelPauseType;
            };
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

    // 🆕 FUNCIONES PARA HORARIOS DINÁMICOS
    function getStandardWorkDay(date = new Date()) {
        const dayOfWeek = date.getDay(); // 0=Domingo, 1=Lunes, 5=Viernes, 6=Sábado
        
        if (dayOfWeek === 5) { // Viernes
            return 8;
        } else if (dayOfWeek >= 1 && dayOfWeek <= 4) { // Lunes-Jueves
            return 9;
        } else if (dayOfWeek === 6 || dayOfWeek === 0) { // Sábado o Domingo
            return 0; // Todo son horas extra
        }
        // Por defecto
        return 9;
    }
    
    function getDayTypeName(date = new Date()) {
        const dayOfWeek = date.getDay();
        
        if (dayOfWeek === 5) {
            return "Divendres";
        } else if (dayOfWeek >= 1 && dayOfWeek <= 4) {
            return "Dilluns-Dijous";
        } else if (dayOfWeek === 6) {
            return "Dissabte";
        } else if (dayOfWeek === 0) {
            return "Diumenge";
        }
        return "Desconegut";
    }
    
    function getStandardWorkDayFormatted(standard) {
        if (standard === 0) return "0h (tot extra)";
        return `${standard}h`;
    }
    
    // Detectar si son horas extra con horario dinámico
    function calculateExtraHours() {
        if (!appState.workStartTime) return { extraHours: 0, totalHours: 0, extraBlocks: 0, standardWorkDay: 9 };
        
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
        
        // 🆕 USAR HORARIO DINÁMICO (CORREGIDO: nullish coalescing para soportar 0)
        const standardWorkDay = appState.workDayStandard ?? 9;
        const extraTime = Math.max(0, totalJourneyTime - standardWorkDay);
        
        // 🔍 DEBUG: Log para diagnosticar problemas
        console.log('🔍 DEBUG CALCULATE EXTRA HOURS:');
        console.log('- workStartTime:', appState.workStartTime);
        console.log('- totalJourneyTime:', totalJourneyTime);
        console.log('- standardWorkDay:', standardWorkDay);
        console.log('- workDayType:', appState.workDayType);
        console.log('- workDayStandard:', appState.workDayStandard);
        
        // Solo contar como extra si es >= 30 minutos (excepto sábados)
        let extraHours = 0;
        if (standardWorkDay === 0) {
            // Sábado/Domingo: todo son horas extra
            extraHours = totalJourneyTime;
            console.log('- Es fin de semana: extraHours =', extraHours);
        } else {
            extraHours = extraTime >= 0.5 ? extraTime : 0;
            console.log('- Día laboral: extraTime =', extraTime, ', extraHours =', extraHours);
        }
        
        const extraBlocks = Math.floor(extraHours / 0.5); // Bloques de 30min
        
        return { 
            extraHours: extraHours, 
            totalHours: totalJourneyTime,
            extraBlocks: extraBlocks,
            standardWorkDay: standardWorkDay
        };
    }

    // --- FUNCIONES DE AUTENTICACIÓN ---
    
    function addAccountButton() {
        // Crear botó de compte al header
        const header = document.querySelector('.header');
        const accountBtn = document.createElement('button');
        accountBtn.className = 'account-btn';
        accountBtn.innerHTML = '👤';
        accountBtn.title = 'El meu compte';
        accountBtn.onclick = () => authManager.showAccountModal();
        
        // Inserir abans de l'indicador GPS
        const gpsStatus = document.getElementById('gps-status');
        header.insertBefore(accountBtn, gpsStatus);
    }

    async function sendToProxy(action, point, observations = '') {
        if (!appState.currentLocation) {
            const error = new Error('Ubicació GPS no disponible.');
            showTranslatedError(error);
            throw error;
        }
        
        // 🔐 OBTENER CREDENCIALES DEL USUARIO (LOCAL O SERVIDOR)
        const credentials = authManager.getCredentials();
        if (!credentials && !hasServerAuth) {
            const error = new Error('Has de fer login primer.');
            showTranslatedError(error);
            throw error;
        }
        
        const startTime = performance.now();
        showLoading(true, `Registrant ${action} (${point})...`);
        dom.connectionStatus.className = 'status-indicator yellow';
        
        try {
            let result;
            if (typeof Beta10Direct !== 'undefined' && Beta10Direct.isNative()) {
                console.log(`[App Nativa] Executant fitxatge directe a Beta10...`);
                result = await Beta10Direct.executeFichaje(action, point, appState.currentLocation, observations, credentials);
            } else {
                const response = await fetch(PROXY_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        action: action,
                        point: point,
                        location: appState.currentLocation,
                        observations: observations,
                        // 🔐 ENVIAR CREDENCIALES DINÁMICAS (OPCIONAL SI EL SERVIDOR YA LAS TIENE)
                        credentials: credentials || null
                    })
                });

                result = await response.json();

                if (!response.ok || !result.success) {
                    const error = new Error(result.error || `Error en el servidor (HTTP ${response.status})`);
                    showTranslatedError(error);
                    throw error;
                }
            }
            
            const duration = Math.round(performance.now() - startTime);
            dom.connectionStatus.className = 'status-indicator green';
            const obsText = observations ? ` - Obs: ${observations.substring(0, 30)}...` : '';
            const activeUser = credentials?.username || result.user || 'servidor';
            const userText = ` [${activeUser}]`;
            logActivity(`✅ Beta10 OK (${duration}ms): ${action} con punto '${point}' registrado${obsText}${userText}`);
            
            return result;

        } catch (error) {
            dom.connectionStatus.className = 'status-indicator red';
            // Si es un error de fetch, traducirlo
            if (error.message && error.message.includes('fetch')) {
                showTranslatedError(error);
            }
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
                const standardWorkDay = extraInfo.standardWorkDay;
                const dayType = appState.workDayType || 'Desconegut';
                
                // 🔍 DEBUG: Mostrar información de tiempo en el log
                const totalHoursFormatted = `${Math.floor(extraInfo.totalHours)}h ${Math.round((extraInfo.totalHours % 1) * 60)}min`;
                const standardFormatted = getStandardWorkDayFormatted(standardWorkDay);
                logActivity(`⏰ Jornada total: ${totalHoursFormatted} (estàndard ${dayType}: ${standardFormatted})`);
                
                // 🆕 LÓGICA CORREGIDA PARA TODOS LOS DÍAS
                if (standardWorkDay === 0) {
                    // Sábado/Domingo: TODO es hora extra si >= 30 minutos
                    if (extraInfo.totalHours >= 0.5) {
                        const totalBlocks = Math.floor(extraInfo.totalHours / 0.5);
                        let extraText = '';
                        if (totalBlocks === 1) {
                            extraText = '+30min';
                        } else if (totalBlocks === 2) {
                            extraText = '+1h';
                        } else {
                            const hours = Math.floor(totalBlocks / 2);
                            const mins = (totalBlocks % 2) * 30;
                            if (mins === 0) {
                                extraText = `+${hours}h`;
                            } else {
                                extraText = `+${hours}h${mins}min`;
                            }
                        }
                        logActivity(`💰 ${dayType}: ${extraText} d'hores extra (tot és extra)`);
                        alert(`💰 ${dayType}: ${extraText} d'hores extra detectades.\n\nHas d'afegir observacions obligatòriament.`);
                        observations = await showObservationsModal(extraText);
                    } else {
                        // Menos de 30 minutos en sábado/domingo
                        const extraMinutes = Math.round(extraInfo.totalHours * 60);
                        logActivity(`ℹ️ ${dayType}: ${extraMinutes} minuts treballats (menys de 30min, no cal observacions)`);
                    }
                } else if (extraInfo.extraHours >= 0.5) {
                    // Lunes-Jueves (9h) o Viernes (8h) con horas extra >= 30min
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
                    logActivity(`💰 Detectades ${extraText} d'hores extra (estàndard ${dayType}: ${standardFormatted})`);
                    const shouldAddObs = confirm(`Detectades ${extraText} d'hores extra. Vols afegir observacions?`);
                    if (shouldAddObs) {
                        observations = await showObservationsModal(extraText);
                    }
                } else if (extraInfo.totalHours > standardWorkDay) {
                    // Tiempo extra pero menos de 30 minutos
                    const extraMinutes = Math.round((extraInfo.totalHours - standardWorkDay) * 60);
                    logActivity(`ℹ️ Jornada amb ${extraMinutes} minuts extra (menys de 30min, no es considera hora extra)`);
                } else {
                    logActivity(`✅ Jornada completada dins del temps estàndard`);
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
            showTranslatedError(error);
            showLoading(false);
        }
    }


    function startWorkday() {
        handleAction([
            {
                action: 'entrada', point: 'J', newState: 'JORNADA',
                onComplete: () => { 
                    const now = new Date();
                    appState.workStartTime = now;
                    // 🆕 ESTABLECER HORARIO DINÁMICO
                    appState.workStartDay = now.getDay();
                    appState.workDayStandard = getStandardWorkDay(now);
                    appState.workDayType = getDayTypeName(now);
                    logActivity(`📅 Jornada iniciada: ${appState.workDayType} (${getStandardWorkDayFormatted(appState.workDayStandard)} estàndard)`);
                }
            }
        ]);
    }
    
    function startAlmacen() {
        handleAction([
            {
                action: 'entrada', point: '9', newState: 'ALMACEN',
                onComplete: () => { 
                    const now = new Date();
                    appState.workStartTime = now;
                    // 🆕 ESTABLECER HORARIO DINÁMICO
                    appState.workStartDay = now.getDay();
                    appState.workDayStandard = getStandardWorkDay(now);
                    appState.workDayType = getDayTypeName(now);
                    logActivity(`📅 Magatzem iniciat: ${appState.workDayType} (${getStandardWorkDayFormatted(appState.workDayStandard)} estàndard)`);
                }
            }
        ]);
    }

    function endAlmacenAndStartWorkday() {
        handleAction([
            { action: 'salida', point: '9' },
            { action: 'entrada', point: 'J', newState: 'JORNADA' }
        ]);
    }

    // Función modificada para iniciar pausa con selección de tipo
    async function startPause() {
        try {
            const pauseType = await showPauseTypeModal();
            if (!pauseType) return; // Usuario canceló
            
            await getCurrentLocation();
            
            // Primer fichaje: Salida de jornada
            await sendToProxy('salida', 'J', '');
            
            // Segundo fichaje: Entrada a pausa con observaciones del tipo
            await sendToProxy('entrada', 'P', pauseType);
            
            // Actualizar estado
            appState.currentState = 'PAUSA';
            appState.currentPauseStart = new Date();
            appState.currentPauseType = pauseType;
            appState.pauseAlarmTriggered = false;
            
            // 🔥 NUEVAS FUNCIONALIDADES PARA GARANTIZAR ALARMAS
            
            // 1. Mantener pantalla activa durante pausa
            await requestWakeLock();
            
            // 2. Programar notificación del sistema
            const pauseLimit = PAUSE_LIMITS[pauseType];
            await scheduleNotification(pauseType, pauseLimit);
            
            // 3. Mostrar instruccions a l'usuari
            const timeText = pauseType === 'esmorçar' ? '10 minuts' : '30 minuts';
            dom.infoMessage.textContent = `⏰ Pausa ${pauseType} iniciada. Alarma en ${timeText}. Mantingues l'app oberta.`;
            dom.infoMessage.classList.add('success');
            
            saveState();
            updateUI();
            
            logActivity(`🍽️ Pausa iniciada: ${pauseType} (${pauseType === 'esmorçar' ? '10min' : '30min'})`);
            logActivity(`🔔 Alarma programada per ${timeText} - NO tanquis l'app`);
            
        } catch (error) {
            logActivity(`❌ Error iniciant pausa: ${error.message}`);
            showTranslatedError(error);
        }
    }

    function endPause() {
        // Cancelar notificación programada
        cancelScheduledNotification();

        // Liberar wake lock
        releaseWakeLock();

        handleAction([
            { action: 'salida', point: 'P' },
            {
                action: 'entrada', point: 'J', newState: 'JORNADA',
                onComplete: () => {
                    if (appState.currentPauseStart) {
                        const pauseDuration = new Date() - appState.currentPauseStart;
                        appState.totalPauseTimeToday += pauseDuration;
                        appState.currentPauseStart = null;
                        appState.currentPauseType = null;
                        appState.pauseAlarmTriggered = false;
                        appState.lastAlarmTime = null; // 🔧 Resetear tiempo de última alarma
                        appState.alarmSource = null; // 🐛 FIX: Resetear fuente de alarma
                        appState.wakeLockLost = false; // 🐛 FIX: Resetear flag de wake lock perdido
                        stopAlarm();

                        // Limpiar mensaje de pausa
                        dom.infoMessage.classList.remove('success');
                        dom.infoMessage.textContent = "";
                    }
                }
            }
        ]);
    }

    function endWorkday() {
        const actions = [];
        
        // Secuencia correcta según el estado actual
        if (appState.currentState === 'PAUSA') {
            // Si estamos en pausa, primero salir de pausa y luego de jornada
            actions.push({ action: 'salida', point: 'P' });
            actions.push({ action: 'entrada', point: 'J' });
            actions.push({ action: 'salida', point: 'J' });
        } else if (appState.currentState === 'ALMACEN') {
            // Si estamos en almacén, salir directamente
            actions.push({ action: 'salida', point: '9' });
        } else if (appState.currentState === 'JORNADA') {
            // Si estamos en jornada, salir directamente
            actions.push({ action: 'salida', point: 'J' });
        }
       
        // El último action cambia el estado a FUERA
        if (actions.length > 0) {
            actions[actions.length - 1].newState = 'FUERA';
            actions[actions.length - 1].onComplete = () => {
                // Reset para el día siguiente
                appState.workStartTime = null;
                appState.currentPauseStart = null;
                appState.currentPauseType = null;
                appState.totalPauseTimeToday = 0;
                appState.pauseAlarmTriggered = false;
                // 🆕 LIMPIAR HORARIO DINÁMICO
                appState.workDayStandard = null;
                appState.workDayType = null;
                appState.workStartDay = null;
                stopAlarm();
            };
        }

        handleAction(actions);
    }

    // --- SISTEMA DE NOTIFICACIONES Y WAKE LOCK ---
    
    // Solicitar permisos de notificación
    async function requestNotificationPermission() {
        if (!isNativeApp && 'Notification' in window && 'serviceWorker' in navigator) {
            try {
                const permission = await Notification.requestPermission();
                if (permission === 'granted') {
                    logActivity('✅ Permisos de notificació concedits');
                    return true;
                } else {
                    logActivity('⚠️ Permisos de notificació denegats');
                    return false;
                }
            } catch (error) {
                logActivity(`❌ Error permisos notificació: ${error.message}`);
                return false;
            }
        }
        return false;
    }
    
    // Wake Lock para mantener pantalla activa durante pausa
    async function requestWakeLock() {
        try {
            if ('wakeLock' in navigator) {
                appState.wakeLock = await navigator.wakeLock.request('screen');
                appState.wakeLockLost = false; // 🐛 FIX: Resetear flag
                logActivity('🔆 Pantalla mantinguda activa durant la pausa');

                appState.wakeLock.addEventListener('release', () => {
                    logActivity('🔅 Wake lock alliberat');

                    // 🐛 FIX #3: Detectar si se perdió durante una pausa activa
                    if (appState.currentState === 'PAUSA' && !appState.wakeLockLost) {
                        appState.wakeLockLost = true;
                        logActivity('⚠️ Wake Lock perdido durante pausa - Intentando recuperar...');

                        // Intentar recuperar wake lock después de 1 segundo
                        setTimeout(async () => {
                            if (appState.currentState === 'PAUSA') {
                                const recovered = await requestWakeLock();
                                if (recovered) {
                                    logActivity('✅ Wake Lock recuperado');

                                    // Cancelar y reprogramar notificación del Service Worker
                                    if (appState.currentPauseStart && appState.currentPauseType) {
                                        const elapsed = new Date() - appState.currentPauseStart;
                                        const pauseLimit = PAUSE_LIMITS[appState.currentPauseType];
                                        const remaining = pauseLimit - elapsed;

                                        if (remaining > 0) {
                                            await cancelScheduledNotification();
                                            await scheduleNotification(appState.currentPauseType, remaining);
                                            logActivity('🔔 Notificació reprogramada després de recuperar Wake Lock');
                                        }
                                    }
                                } else {
                                    logActivity('❌ No se pudo recuperar Wake Lock');
                                }
                            }
                        }, 1000);
                    }
                });

                return true;
            }
        } catch (error) {
            logActivity(`⚠️ Wake lock no disponible: ${error.message}`);
        }
        return false;
    }
    
    // Liberar wake lock
    async function releaseWakeLock() {
        if (appState.wakeLock) {
            try {
                await appState.wakeLock.release();
                appState.wakeLock = null;
                logActivity('🔅 Pantalla pot apagar-se normalment');
            } catch (error) {
                logActivity(`⚠️ Error alliberant wake lock: ${error.message}`);
            }
        }
    }
    
    // Programar notificación usando Service Worker
    async function scheduleNotification(pauseType, delayMs) {
        try {
            if (!isNativeApp && 'serviceWorker' in navigator) {
                const registration = await navigator.serviceWorker.ready;
                const timeLimit = pauseType === 'esmorçar' ? 10 : 30;
                
                // Enviar mensaje al service worker para programar notificación
                registration.active.postMessage({
                    type: 'SCHEDULE_NOTIFICATION',
                    pauseType: pauseType,
                    delayMs: delayMs,
                    timeLimit: timeLimit
                });
                
                logActivity(`🔔 Notificació programada: ${pauseType} en ${Math.round(delayMs/1000/60)} min`);
            }
        } catch (error) {
            logActivity(`❌ Error programando notificació: ${error.message}`);
        }
    }
    
    // Cancelar notificación programada
    async function cancelScheduledNotification() {
        try {
            if (!isNativeApp && 'serviceWorker' in navigator) {
                const registration = await navigator.serviceWorker.ready;
                registration.active.postMessage({
                    type: 'CANCEL_NOTIFICATION'
                });
                logActivity('🔕 Notificació cancelada');
            }
        } catch (error) {
            logActivity(`❌ Error cancelando notificació: ${error.message}`);
        }
    }
    
    function createBeepSound(intensity = 'normal') {
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            
            // Sonido fuerte para alertas de pausa
            oscillator.frequency.value = 1000;
            oscillator.type = 'sine';
            gainNode.gain.setValueAtTime(0.5, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 1.5);
            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 1.5);
            
        } catch (e) {
            console.log('No se pudo reproducir el sonido');
        }
    }

    function playPauseAlarm(pauseType, source = 'local') {
        const now = new Date();
        const timeSinceLastAlarm = appState.lastAlarmTime ? now - appState.lastAlarmTime : Infinity;

        // 🐛 FIX #1: Prevenir doble disparo desde diferentes fuentes
        if (appState.isAlarmPlaying && appState.alarmSource) {
            logActivity(`⚠️ Alarma ya activa (fuente: ${appState.alarmSource}), ignorando disparo desde ${source}`);
            return;
        }

        // 🔧 Permitir alarma si es la primera vez O han pasado al menos 2 minutos desde la última
        if (!appState.pauseAlarmTriggered || timeSinceLastAlarm > 2 * 60 * 1000) {
            // 🐛 FIX #2: Marcar flags DENTRO del check, después de validar
            appState.pauseAlarmTriggered = true;
            appState.isAlarmPlaying = true;
            appState.lastAlarmTime = now;
            appState.alarmSource = source;

            logActivity(`🔔 Alarma activada desde: ${source}`);

            // 🐛 FIX #4: Si la alarma local se activa, cancelar timeout del Service Worker
            if (source === 'local' || source === 'init') {
                cancelScheduledNotification();
                // Notificar al Service Worker para que cancele su timeout también
                if (!isNativeApp && 'serviceWorker' in navigator) {
                    navigator.serviceWorker.ready.then(registration => {
                        registration.active.postMessage({
                            type: 'ALARM_ALREADY_TRIGGERED'
                        });
                    });
                }
            }

            // 🚨 ALARMA MEJORADA - MÁS PERSISTENTE

            // 1. Vibración más fuerte y más larga
            if ('vibrate' in navigator) {
                navigator.vibrate([1000, 300, 1000, 300, 1000, 300, 1000]);
            }

            // 2. Sonido fuerte múltiple
            for (let i = 0; i < 3; i++) {
                setTimeout(() => {
                    createBeepSound('strong');
                }, i * 1000);
            }

            // 3. Notificación del sistema inmediata
            if (Notification.permission === 'granted') {
                const timeText = pauseType === 'esmorçar' ? '10 minutos' : '30 minutos';
                new Notification('⏰ Temps de pausa completat!', {
                    body: `Has completat els ${timeText} de ${pauseType}. Torna a la jornada laboral.`,
                    icon: '/icon-192.svg',
                    badge: '/icon-192.svg',
                    tag: 'pause-alarm',
                    requireInteraction: true,
                    silent: false
                });
            }

            // 4. Mostrar notificación visual persistente
            const timeText = pauseType === 'esmorçar' ? '10 minuts' : '30 minuts';
            dom.infoMessage.textContent = `🚨 TEMPS DE ${pauseType.toUpperCase()} COMPLETAT (${timeText}) - TORNA A LA JORNADA!`;
            dom.infoMessage.classList.remove('success');
            dom.infoMessage.classList.add('alert');

            logActivity(`🚨 ALARMA ${pauseType.toUpperCase()}: ${timeText} completats - TORNA A LA JORNADA`);

            // 🚨 BUG FIX #1: Limpiar intervalo anterior ANTES de crear uno nuevo
            if (alarmIntervalGlobal) {
                clearInterval(alarmIntervalGlobal);
                alarmIntervalGlobal = null;
            }

            // 5. Repetir alarma cada 30 segundos hasta que vuelva
            alarmIntervalGlobal = setInterval(() => {
                if (appState.currentState === 'PAUSA' && appState.isAlarmPlaying) {
                    createBeepSound('strong');
                    if ('vibrate' in navigator) {
                        navigator.vibrate([500, 200, 500]);
                    }
                    logActivity(`🔔 Recordatori: Temps de ${pauseType} completat`);
                } else {
                    clearInterval(alarmIntervalGlobal);
                    alarmIntervalGlobal = null;
                }
            }, 30000); // Cada 30 segundos
        } else {
            logActivity(`⚠️ Alarma throttled: Solo ${Math.round(timeSinceLastAlarm/1000)}s desde última alarma`);
        }
    }

    function stopAlarm() {
        appState.isAlarmPlaying = false;
        appState.alarmSource = null; // 🐛 FIX: Resetear fuente de alarma

        // 🚨 BUG FIX #1: Limpiar intervalo global de alarma
        if (alarmIntervalGlobal) {
            clearInterval(alarmIntervalGlobal);
            alarmIntervalGlobal = null;
        }

        dom.infoMessage.classList.remove('alert');
        dom.infoMessage.classList.remove('success');
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

                // Control de alarma según el tipo de pausa
                if (appState.currentPauseType && PAUSE_LIMITS[appState.currentPauseType]) {
                    const pauseLimit = PAUSE_LIMITS[appState.currentPauseType];
                    if (currentPauseDuration >= pauseLimit) {
                        // 🚨 BUG FIX #5: Solo llamar alarma si NO está sonando ya
                        if (!appState.isAlarmPlaying) {
                            playPauseAlarm(appState.currentPauseType);
                        }
                    }
                }

            } else {
                dom.pauseTimer.textContent = formatTime(appState.totalPauseTimeToday);
            }
            dom.workTimer.textContent = formatTime(workDuration);
        }
    }
    
    function generateDynamicButtons() {
        // 🚨 BUG FIX #4: VALIDAR estado antes de limpiar botones
        if (!appState.currentState ||
            !['FUERA', 'JORNADA', 'PAUSA', 'ALMACEN'].includes(appState.currentState)) {
            logActivity(`⚠️ generateDynamicButtons: Estado inválido "${appState.currentState}" - NO limpiar botones`);
            return; // No borrar botones si el estado es inválido
        }

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
                break;
            case 'JORNADA':
                createButton('⏸️ Iniciar Pausa', 'btn-pause', startPause);
                createButton('⛔ Finalitzar Jornada (J)', 'btn-stop', endWorkday);
                break;
            case 'PAUSA':
                // Mostrar tipo de pausa actual
                const pauseTypeText = appState.currentPauseType ? ` (${appState.currentPauseType})` : '';
                
                // Botón para salir de pausa - siempre habilitado
                createButton(
                    `▶️ Tornar de Pausa${pauseTypeText}`, 
                    'btn-start', 
                    endPause, 
                    false // Siempre habilitado
                );
                
                // Limpiar mensaje si no hay alarma
                if(!appState.isAlarmPlaying) {
                   dom.infoMessage.classList.remove('alert');
                   dom.infoMessage.textContent = "";
                }
                
                // Botón Finalizar Jornada DESHABILITADO en pausa para evitar confusión
                createButton('⛔ Finalitzar Jornada', 'btn-stop', () => {
                    alert('Has de sortir de la pausa abans de finalitzar la jornada.');
                }, true);
                
                break;
        }
    }
    
    function updateUI() {
        let stateText = '--';

        // 🚨 BUG FIX #3: VALIDAR currentState antes de usar
        if (!appState.currentState ||
            !['FUERA', 'JORNADA', 'PAUSA', 'ALMACEN'].includes(appState.currentState)) {
            // Estado inválido detectado - resetear a FUERA
            logActivity(`⚠️ Estado inválido detectado: "${appState.currentState}" - Resetejant a FUERA`);
            appState.currentState = 'FUERA';
            appState.workStartTime = null;
            appState.currentPauseStart = null;
            appState.currentPauseType = null;
            appState.isAlarmPlaying = false;
            appState.pauseAlarmTriggered = false;
            saveState();
        }

        // 🆕 INCLUIR TIPO DE DÍA EN EL ESTADO
        const dayInfo = appState.workDayType ? ` - ${appState.workDayType}` : '';
        const standardInfo = appState.workDayStandard !== null ? ` (${getStandardWorkDayFormatted(appState.workDayStandard)})` : '';

        switch (appState.currentState) {
            case 'FUERA':
                stateText = 'Fora de Jornada';
                break;
            case 'JORNADA':
                stateText = `En Jornada${dayInfo}${standardInfo}`;
                break;
            case 'PAUSA':
                const pauseTypeText = appState.currentPauseType ? ` (${appState.currentPauseType})` : '';
                stateText = `En Pausa${pauseTypeText}${dayInfo}`;
                break;
            case 'ALMACEN':
                stateText = `En Magatzem${dayInfo}${standardInfo}`;
                break;
            default:
                // Fallback adicional (no debería llegar aquí)
                logActivity(`❌ Estado desconocido en switch: "${appState.currentState}"`);
                stateText = 'Error de Estado';
        }

        dom.currentStateText.textContent = stateText;
        generateDynamicButtons();
    }
    
    // 🔍 VALIDACIÓ AUTOMÀTICA D'ESTAT (Anti-bloquejos)
    function validateAppState() {
        try {
            // Detectar estat inconsistent de pausa
            if (appState.currentState === 'PAUSA') {
                // Si estem en pausa però no tenim temps d'inici, és inconsistent
                if (!appState.currentPauseStart) {
                    logActivity('⚠️ Estat inconsistent detectat: Pausa sense temps d\'inici');
                    appState.currentState = 'JORNADA';
                    appState.currentPauseType = null;
                    appState.isAlarmPlaying = false;
                    appState.pauseAlarmTriggered = false;
                    saveState();
                    updateUI();
                    logActivity('🔧 Auto-correcció: Tornat a jornada normal');
                    return true;
                }
                
                // Si la pausa porta més de 2 hores (probable error)
                const pauseStart = new Date(appState.currentPauseStart);
                const pauseDuration = new Date() - pauseStart;
                if (pauseDuration > 2 * 60 * 60 * 1000) { // 2 hores
                    logActivity('⚠️ Pausa excessivament llarga detectada (>2h)');
                    // Afegir pausa al total i resetar
                    appState.totalPauseTimeToday += pauseDuration;
                    appState.currentState = 'JORNADA';
                    appState.currentPauseStart = null;
                    appState.currentPauseType = null;
                    appState.isAlarmPlaying = false;
                    appState.pauseAlarmTriggered = false;
                    saveState();
                    updateUI();
                    logActivity('🔧 Auto-correcció: Pausa de 2h afegida al total');
                    return true;
                }
            }
            
            // Detectar jornada sense temps d'inici
            if ((appState.currentState === 'JORNADA' || appState.currentState === 'PAUSA') && !appState.workStartTime) {
                logActivity('⚠️ Estat inconsistent: Jornada sense temps d\'inici');
                appState.currentState = 'FUERA';
                appState.currentPauseStart = null;
                appState.currentPauseType = null;
                saveState();
                updateUI();
                logActivity('🔧 Auto-correcció: Reset a estat inicial');
                return true;
            }
            
            return false; // No hi ha hagut correccions
        } catch (error) {
            console.error('Error en validació d\'estat:', error);
            logActivity(`❌ Error en validació automàtica: ${error.message}`);
            return false;
        }
    }
    
    // --- INICIALIZACIÓN OPTIMIZADA PARA VERCEL ---
    async function init() {
        loadState();
        
        // 🔍 VALIDACIÓ INICIAL D'ESTAT
        const wasFixed = validateAppState();
        if (wasFixed) {
            logActivity('✅ Estat de l\'app validat i corregit automàticament');
        }
        
        // 🔔 SOLICITAR PERMISOS IMPORTANTES AL INICIO
        
        // 1. Permisos de notificación
        await requestNotificationPermission();
        
        // 2. Mostrar instrucción importante si está en pausa
        if (appState.currentState === 'PAUSA' && appState.currentPauseType) {
            const timeText = appState.currentPauseType === 'esmorçar' ? '10 minuts' : '30 minuts';
            dom.infoMessage.textContent = `⏰ Pausa ${appState.currentPauseType} activa. Alarma en ${timeText}. NO tanquis l'app.`;
            dom.infoMessage.classList.add('success');
            
            // Volver a activar wake lock si está en pausa
            await requestWakeLock();
            
            // Volver a programar notificación si está en pausa
            if (appState.currentPauseStart) {
                const elapsed = new Date() - appState.currentPauseStart;
                const pauseLimit = PAUSE_LIMITS[appState.currentPauseType];
                const remaining = pauseLimit - elapsed;
                
                if (remaining > 0) {
                    await scheduleNotification(appState.currentPauseType, remaining);
                    logActivity(`🔔 Notificació reprogramada: ${Math.round(remaining/1000/60)} min restants`);
                } else {
                    // Ya ha pasado el tiempo, activar alarma
                    // 🐛 FIX: NO marcar isAlarmPlaying aquí - playPauseAlarm() lo hace internamente
                    playPauseAlarm(appState.currentPauseType, 'init');
                }
            }
        }
        
        // 🆕 NUEVO: Mostrar información del día al iniciar
        if (appState.currentState !== 'FUERA' && appState.workDayType) {
            const dayInfo = `${appState.workDayType} (${getStandardWorkDayFormatted(appState.workDayStandard)})`;
            logActivity(`📅 Horari d'avui: ${dayInfo}`);
        }
        
        updateUI();
        
        // Actualizar timers cada segundo
        setInterval(() => {
            updateTimers();
            // 🔧 Solo regenerar botones si cambia el estado (evita bug de botones deshabilitados)
            if (lastKnownState !== appState.currentState) {
                generateDynamicButtons();
                lastKnownState = appState.currentState;
            }
        }, 1000);
        
        // 🔍 Validació automàtica cada 30 segons per detectar problemes
        setInterval(() => {
            const wasFixed = validateAppState();
            if (wasFixed) {
                logActivity('🔧 Problema detectat i solucionat automàticament');
            }
        }, 30000); // Cada 30 segons
        
        // Petición inicial para calentar GPS
        getCurrentLocation().catch(err => {
            logActivity(`⚠️ Error inicial GPS: ${err.message}`);
            // No mostrar alert en inicialización automática
        }).finally(() => {
            showLoading(false);
        });
        
        // Registrar el Service Worker para PWA (solo en web, no en APK nativa)
        if (!isNativeApp && 'serviceWorker' in navigator) {
            navigator.serviceWorker.register('/service-worker.js')
                .then(reg => {
                    logActivity('✅ Service Worker registrat amb èxit.');
                    
                    // Escuchar mensajes del service worker
                    navigator.serviceWorker.addEventListener('message', event => {
                        if (event.data && event.data.type === 'PAUSE_ALARM') {
                            logActivity('🔔 Alarma activada pel Service Worker');
                            // 🐛 FIX #4: Pasar 'service-worker' como fuente
                            playPauseAlarm(event.data.pauseType, 'service-worker');
                        }
                    });
                })
                .catch(err => logActivity(`❌ Error en registrar Service Worker: ${err}`));
        } else if (isNativeApp) {
            logActivity('📱 Mode APK Nativa: Recursos integrats localment');
        }
        
        // Detectar quan l'app perd/guanya focus
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                logActivity('⚠️ App en background - Les alarmes poden no funcionar');
                if (appState.currentState === 'PAUSA') {
                    logActivity('🚨 IMPORTANT: Mantingues l\'app oberta per rebre alarmes');
                }
            } else {
                logActivity('✅ App en foreground - Alarmes funcionen correctament');
            }
        });
        
        logActivity('🚀 Beta10 Control iniciat');
        logActivity('✅ Sistema operatiu amb alarmes millorades');
        
        // Mostrar avís important sobre alarmes
        if (appState.currentState === 'FUERA') {
            setTimeout(() => {
                // 🆕 NUEVO: Mostrar información del día actual
                const today = new Date();
                const todayStandard = getStandardWorkDay(today);
                const todayType = getDayTypeName(today);
                
                if (todayStandard === 0) {
                    // Sábado o Domingo
                    dom.infoMessage.textContent = `💰 Avui és ${todayType}: Tot el temps serà hora extra (mínim 30min). Cal afegir observacions.`;
                } else {
                    dom.infoMessage.textContent = `📅 Avui és ${todayType} (${getStandardWorkDayFormatted(todayStandard)} estàndard). Mantingues l'app oberta durant les pauses.`;
                }
                dom.infoMessage.classList.add('success');
                
                setTimeout(() => {
                    if (appState.currentState === 'FUERA') {
                        dom.infoMessage.classList.remove('success');
                        dom.infoMessage.textContent = "";
                    }
                }, 10000); // 10 segundos para leer la información
            }, 2000);
        }
    }

    init();
});
