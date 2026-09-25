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
        esmorçar: 15 * 60 * 1000, // 15 minutos (desayuno)
        dinar: 30 * 60 * 1000     // 30 minutos (comida)
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
                    <p class="modal-subtitle">Selecciona el tipus de pausa que vols iniciar:</p>
                    <div class="pause-type-buttons">
                        <button class="btn btn-secondary pause-type-btn" id="btn-pause-esmorzar">
                            🥐 Esmorzar
                            <small>15 minuts (avís d'alarma en acabar)</small>
                        </button>
                        <button class="btn btn-secondary pause-type-btn" id="btn-pause-dinar">
                            🍽️ Dinar
                            <small>30 minuts (avís d'alarma en acabar)</small>
                        </button>
                    </div>
                    <div class="modal-buttons">
                        <button class="btn btn-secondary" id="btn-pause-cancel">Cancel·lar</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);

            const cleanup = () => {
                if (document.body.contains(modal)) {
                    document.body.removeChild(modal);
                }
            };

            document.getElementById('btn-pause-esmorzar').onclick = () => {
                cleanup();
                resolve('esmorçar');
            };

            document.getElementById('btn-pause-dinar').onclick = () => {
                cleanup();
                resolve('dinar');
            };

            document.getElementById('btn-pause-cancel').onclick = () => {
                cleanup();
                resolve(null);
            };
        });
    }

    // 🆕 Modal versàtil d'observacions i pantalla d'hores extra
    function showObservationsModal({
        title = 'Observacions',
        subtitle = '',
        placeholder = 'Introdueix comentari o observacions...',
        isOvertime = false,
        overtimeDetails = null,
        defaultValue = '',
        required = false,
        confirmText = 'Confirmar',
        cancelText = 'Cancel·lar'
    } = {}) {
        return new Promise((resolve) => {
            const modal = document.createElement('div');
            modal.className = 'modal-overlay';

            let overtimeHtml = '';
            if (isOvertime && overtimeDetails) {
                overtimeHtml = `
                    <div class="overtime-card">
                        <div class="overtime-header">
                            <span class="overtime-badge">💰 HORES EXTRA DETECTADES</span>
                        </div>
                        <div class="overtime-grid">
                            <div class="overtime-item">
                                <span class="ot-label">Total Treballat</span>
                                <span class="ot-value">${overtimeDetails.totalHoursFormatted}</span>
                            </div>
                            <div class="overtime-item">
                                <span class="ot-label">Estàndard</span>
                                <span class="ot-value">${overtimeDetails.standardFormatted}</span>
                            </div>
                            <div class="overtime-item highlight">
                                <span class="ot-label">Hores Extra</span>
                                <span class="ot-value extra">${overtimeDetails.extraText}</span>
                            </div>
                        </div>
                        <p class="overtime-note">Has superat la jornada habitual en més de 30 minuts. Si us plau, especifica el motiu o client a les observacions.</p>
                    </div>
                `;
            }

            modal.innerHTML = `
                <div class="modal-content">
                    <h3>${title}</h3>
                    ${subtitle ? `<p class="modal-subtitle">${subtitle}</p>` : ''}
                    ${overtimeHtml}
                    <textarea id="observations-input" placeholder="${placeholder}" maxlength="250">${defaultValue}</textarea>
                    <div class="modal-buttons">
                        <button type="button" class="btn btn-secondary" id="modal-cancel-btn">${cancelText}</button>
                        <button type="button" class="btn btn-start" id="modal-confirm-btn">${confirmText}</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);

            const input = document.getElementById('observations-input');
            const cancelBtn = document.getElementById('modal-cancel-btn');
            const confirmBtn = document.getElementById('modal-confirm-btn');

            setTimeout(() => {
                if (input) {
                    input.focus();
                    if (defaultValue) {
                        input.setSelectionRange(defaultValue.length, defaultValue.length);
                    }
                }
            }, 120);

            const cleanup = () => {
                if (document.body.contains(modal)) {
                    document.body.removeChild(modal);
                }
            };

            cancelBtn.onclick = () => {
                cleanup();
                resolve(null);
            };

            confirmBtn.onclick = () => {
                const text = input ? input.value.trim() : '';
                if (required && !text) {
                    alert('Has d\'indicar observacions obligatòriament.');
                    if (input) input.focus();
                    return;
                }
                cleanup();
                resolve(text);
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

    async function handleAction(actions, defaultObservations = '') {
        try {
            await getCurrentLocation();
            
            let observations = defaultObservations || '';
            const isEndingWorkday = actions.some(a => a.newState === 'FUERA');

            // Si es finalitzar jornada i no s'han passat observacions prèviament, comprovar hores extra (>30 min)
            if (isEndingWorkday && !defaultObservations) {
                const extraInfo = calculateExtraHours();
                const standardWorkDay = extraInfo.standardWorkDay;
                const dayType = appState.workDayType || getDayTypeName(new Date());
                const totalHoursFormatted = `${Math.floor(extraInfo.totalHours)}h ${Math.round((extraInfo.totalHours % 1) * 60)}min`;
                const standardFormatted = getStandardWorkDayFormatted(standardWorkDay);

                let extraText = '';
                let hasOvertime = false;

                if (standardWorkDay === 0) {
                    if (extraInfo.totalHours >= 0.5) {
                        hasOvertime = true;
                        const totalBlocks = Math.floor(extraInfo.totalHours / 0.5);
                        const hours = Math.floor(totalBlocks / 2);
                        const mins = (totalBlocks % 2) * 30;
                        extraText = mins === 0 ? `+${hours}h` : (hours === 0 ? `+${mins}min` : `+${hours}h ${mins}min`);
                    }
                } else if (extraInfo.extraHours >= 0.5) {
                    hasOvertime = true;
                    const extraBlocks = extraInfo.extraBlocks;
                    const hours = Math.floor(extraBlocks / 2);
                    const mins = (extraBlocks % 2) * 30;
                    extraText = mins === 0 ? `+${hours}h` : (hours === 0 ? `+${mins}min` : `+${hours}h ${mins}min`);
                }

                // Si hi ha hores extra detectades (>30 minuts), obrir la pantalla d'hores extra
                if (hasOvertime) {
                    const isMandatory = standardWorkDay === 0;
                    logActivity(`💰 ${dayType}: Detectades ${extraText} d'hores extra`);

                    const obsResult = await showObservationsModal({
                        title: `💰 Hores Extra Detectades (${extraText})`,
                        subtitle: `Has superat la jornada estàndard de ${standardFormatted}.`,
                        isOvertime: true,
                        overtimeDetails: {
                            totalHoursFormatted,
                            standardFormatted,
                            dayType,
                            extraText
                        },
                        placeholder: `Ex: ${extraText} Feina allargada per incidència client XYZ...`,
                        defaultValue: `${extraText} `,
                        required: isMandatory,
                        confirmText: 'Confirmar i Finalitzar',
                        cancelText: isMandatory ? 'Cancel·lar' : 'Finalitzar sense comentari'
                    });

                    if (obsResult === null) {
                        if (isMandatory) {
                            logActivity('⚠️ Finalització cancel·lada (observacions obligatòries)');
                            return;
                        }
                    } else {
                        observations = obsResult;
                    }
                } else if (extraInfo.totalHours > standardWorkDay) {
                    const extraMinutes = Math.round((extraInfo.totalHours - standardWorkDay) * 60);
                    logActivity(`ℹ️ Jornada amb ${extraMinutes} minuts extra (menys de 30min, no es considera hora extra)`);
                } else {
                    logActivity(`✅ Jornada completada dins del temps estàndard`);
                }
            }
            
            for (const { action, point, newState, onComplete, observations: actionObs } of actions) {
                const finalObs = actionObs || observations;
                await sendToProxy(action, point, finalObs);
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


    async function startWorkday(withObs = false) {
        let obs = '';
        if (withObs) {
            obs = await showObservationsModal({
                title: '💬 Comentari d\'Inici de Jornada',
                subtitle: 'Afegeix una observació o comentari per a l\'entrada:',
                placeholder: 'Ex: Inici a obra client XYZ, guàrdia, etc.',
                confirmText: '▶️ Iniciar Jornada',
                cancelText: 'Cancel·lar'
            });
            if (obs === null) return; // Usuari ha cancel·lat
        }

        handleAction([
            {
                action: 'entrada', point: 'J', newState: 'JORNADA', observations: obs,
                onComplete: () => { 
                    const now = new Date();
                    appState.workStartTime = now;
                    appState.workStartDay = now.getDay();
                    appState.workDayStandard = getStandardWorkDay(now);
                    appState.workDayType = getDayTypeName(now);
                    const obsInfo = obs ? ` [Obs: ${obs}]` : '';
                    logActivity(`📅 Jornada iniciada: ${appState.workDayType} (${getStandardWorkDayFormatted(appState.workDayStandard)} estàndard)${obsInfo}`);
                }
            }
        ], obs);
    }
    
    async function startAlmacen(withObs = false) {
        let obs = '';
        if (withObs) {
            obs = await showObservationsModal({
                title: '💬 Comentari d\'Inici a 9teknic',
                subtitle: 'Afegeix una observació o comentari per a 9teknic:',
                placeholder: 'Ex: Preparació de comandes, càrrega de vehicle...',
                confirmText: '📦 Iniciar 9teknic',
                cancelText: 'Cancel·lar'
            });
            if (obs === null) return; // Usuari ha cancel·lat
        }

        handleAction([
            {
                action: 'entrada', point: '9', newState: 'ALMACEN', observations: obs,
                onComplete: () => { 
                    const now = new Date();
                    appState.workStartTime = now;
                    appState.workStartDay = now.getDay();
                    appState.workDayStandard = getStandardWorkDay(now);
                    appState.workDayType = getDayTypeName(now);
                    const obsInfo = obs ? ` [Obs: ${obs}]` : '';
                    logActivity(`📅 9teknic iniciat: ${appState.workDayType} (${getStandardWorkDayFormatted(appState.workDayStandard)} estàndard)${obsInfo}`);
                }
            }
        ], obs);
    }

    async function endAlmacenAndStartWorkday(withObs = false) {
        let obs = '';
        if (withObs) {
            obs = await showObservationsModal({
                title: '💬 Transició Magatzem → Jornada',
                subtitle: 'Afegeix una observació per al canvi:',
                placeholder: 'Ex: Sortida de magatzem cap a client XYZ...',
                confirmText: 'Confirmar Canvi',
                cancelText: 'Cancel·lar'
            });
            if (obs === null) return;
        }

        handleAction([
            { action: 'salida', point: '9', observations: obs },
            { action: 'entrada', point: 'J', newState: 'JORNADA', observations: obs }
        ], obs);
    }

    // Funció modificada per iniciar pausa (Esmorzar 15 min / Dinar 30 min)
    async function startPause() {
        try {
            const pauseType = await showPauseTypeModal();
            if (!pauseType) return; // Usuari cancel·la
            
            await getCurrentLocation();
            
            // Primer fitxatge: Sortida de jornada
            await sendToProxy('salida', 'J', '');
            
            // Segon fitxatge: Entrada a pausa amb observacions del tipus
            await sendToProxy('entrada', 'P', pauseType);
            
            // Actualitzar estat
            appState.currentState = 'PAUSA';
            appState.currentPauseStart = new Date();
            appState.currentPauseType = pauseType;
            appState.pauseAlarmTriggered = false;
            
            // 1. Mantenir pantalla activa durant la pausa
            await requestWakeLock();
            
            // 2. Programar notificació del sistema
            const pauseLimit = PAUSE_LIMITS[pauseType];
            await scheduleNotification(pauseType, pauseLimit);
            
            // 3. Mostrar instruccions a l'usuari (15 min o 30 min)
            const timeText = pauseType === 'esmorçar' ? '15 minuts' : '30 minuts';
            dom.infoMessage.textContent = `⏰ Pausa ${pauseType} iniciada. Alarma en ${timeText}. Mantingues l'app oberta.`;
            dom.infoMessage.classList.add('success');
            
            saveState();
            updateUI();
            
            logActivity(`🍽️ Pausa iniciada: ${pauseType} (${timeText})`);
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

    async function endWorkday(withObs = false) {
        let customObservations = '';

        if (withObs) {
            const extraInfo = calculateExtraHours();
            const standardWorkDay = extraInfo.standardWorkDay;
            const dayType = appState.workDayType || getDayTypeName(new Date());
            const totalHoursFormatted = `${Math.floor(extraInfo.totalHours)}h ${Math.round((extraInfo.totalHours % 1) * 60)}min`;
            const standardFormatted = getStandardWorkDayFormatted(standardWorkDay);

            let extraText = '';
            let hasOvertime = false;
            if (standardWorkDay === 0) {
                if (extraInfo.totalHours >= 0.5) {
                    hasOvertime = true;
                    const totalBlocks = Math.floor(extraInfo.totalHours / 0.5);
                    const hours = Math.floor(totalBlocks / 2);
                    const mins = (totalBlocks % 2) * 30;
                    extraText = mins === 0 ? `+${hours}h` : (hours === 0 ? `+${mins}min` : `+${hours}h ${mins}min`);
                }
            } else if (extraInfo.extraHours >= 0.5) {
                hasOvertime = true;
                const extraBlocks = extraInfo.extraBlocks;
                const hours = Math.floor(extraBlocks / 2);
                const mins = (extraBlocks % 2) * 30;
                extraText = mins === 0 ? `+${hours}h` : (hours === 0 ? `+${mins}min` : `+${hours}h ${mins}min`);
            }

            const obsResult = await showObservationsModal({
                title: hasOvertime ? `💰 Hores Extra (${extraText}) + Comentari` : '💬 Observacions de Sortida',
                subtitle: hasOvertime 
                    ? `Has superat la jornada habitual en més de 30 minuts.` 
                    : `Finalització de jornada (${totalHoursFormatted} totals).`,
                isOvertime: hasOvertime,
                overtimeDetails: hasOvertime ? {
                    totalHoursFormatted,
                    standardFormatted,
                    dayType,
                    extraText
                } : null,
                placeholder: hasOvertime 
                    ? `Ex: ${extraText} Feina allargada per incidència client XYZ...` 
                    : 'Introdueix observacions de sortida...',
                defaultValue: hasOvertime ? `${extraText} ` : '',
                confirmText: '⛔ Finalitzar Jornada',
                cancelText: 'Cancel·lar'
            });

            if (obsResult === null) return; // Cancel·lat per l'usuari
            customObservations = obsResult;
        }

        const actions = [];
        
        // Secuencia correcta según el estado actual
        if (appState.currentState === 'PAUSA') {
            actions.push({ action: 'salida', point: 'P' });
            actions.push({ action: 'entrada', point: 'J' });
            actions.push({ action: 'salida', point: 'J' });
        } else if (appState.currentState === 'ALMACEN') {
            actions.push({ action: 'salida', point: '9' });
        } else if (appState.currentState === 'JORNADA') {
            actions.push({ action: 'salida', point: 'J' });
        }
       
        // El último action cambia el estado a FUERA
        if (actions.length > 0) {
            actions[actions.length - 1].newState = 'FUERA';
            actions[actions.length - 1].onComplete = () => {
                appState.workStartTime = null;
                appState.currentPauseStart = null;
                appState.currentPauseType = null;
                appState.totalPauseTimeToday = 0;
                appState.pauseAlarmTriggered = false;
                appState.workDayStandard = null;
                appState.workDayType = null;
                appState.workStartDay = null;
                stopAlarm();
            };
        }

        handleAction(actions, customObservations);
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
                const timeText = pauseType === 'esmorçar' ? '15 minutos' : '30 minutos';
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
            const timeText = pauseType === 'esmorçar' ? '15 minuts' : '30 minuts';
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
        if (!appState.currentState ||
            !['FUERA', 'JORNADA', 'PAUSA', 'ALMACEN'].includes(appState.currentState)) {
            logActivity(`⚠️ generateDynamicButtons: Estado inválido "${appState.currentState}" - NO limpiar botones`);
            return;
        }

        dom.buttonContainer.innerHTML = ''; // Limpiar botones

        const createButton = (text, className, action, disabled = false) => {
            const btn = document.createElement('button');
            btn.innerHTML = text;
            btn.className = `btn ${className}`;
            btn.onclick = action;
            btn.disabled = disabled;
            return btn;
        };

        const createPair = (btn1, btn2) => {
            const row = document.createElement('div');
            row.className = 'btn-pair';
            row.appendChild(btn1);
            row.appendChild(btn2);
            dom.buttonContainer.appendChild(row);
        };

        switch (appState.currentState) {
            case 'FUERA':
                // 2 botons d'iniciar jornada (habitual i amb comentari)
                createPair(
                    createButton('▶️ Iniciar Jornada', 'btn-start', () => startWorkday(false)),
                    createButton('💬 Jornada + Obs', 'btn-start-obs', () => startWorkday(true))
                );
                // 2 botons d'iniciar 9teknic / magatzem (habitual i amb comentari)
                createPair(
                    createButton('📦 Iniciar 9teknic', 'btn-secondary', () => startAlmacen(false)),
                    createButton('💬 9teknic + Obs', 'btn-secondary-obs', () => startAlmacen(true))
                );
                break;

            case 'ALMACEN':
                // 2 botons per sortir de magatzem i passar a jornada
                createPair(
                    createButton('▶️ Sortir a Jornada', 'btn-start', () => endAlmacenAndStartWorkday(false)),
                    createButton('💬 Canvi + Obs', 'btn-start-obs', () => endAlmacenAndStartWorkday(true))
                );
                // 2 botons per finalitzar jornada des de magatzem
                createPair(
                    createButton('⛔ Finalitzar', 'btn-stop', () => endWorkday(false)),
                    createButton('💬 Finalitzar + Obs', 'btn-stop-obs', () => endWorkday(true))
                );
                break;

            case 'JORNADA':
                // Botó de Pausa
                dom.buttonContainer.appendChild(
                    createButton('⏸️ Iniciar Pausa', 'btn-pause', startPause)
                );
                // 2 botons per finalitzar jornada (habitual i amb comentari)
                createPair(
                    createButton('⛔ Finalitzar Jornada', 'btn-stop', () => endWorkday(false)),
                    createButton('💬 Finalitzar + Obs', 'btn-stop-obs', () => endWorkday(true))
                );
                break;

            case 'PAUSA':
                const pauseTypeText = appState.currentPauseType === 'esmorçar' ? ' (15 min)' : (appState.currentPauseType === 'dinar' ? ' (30 min)' : '');
                
                dom.buttonContainer.appendChild(
                    createButton(`▶️ Tornar de Pausa${pauseTypeText}`, 'btn-start', endPause, false)
                );

                if (!appState.isAlarmPlaying) {
                   dom.infoMessage.classList.remove('alert');
                   dom.infoMessage.textContent = "";
                }

                dom.buttonContainer.appendChild(
                    createButton('⛔ Finalitzar Jornada', 'btn-stop', () => {
                        alert('Has de tornar de la pausa abans de finalitzar la jornada.');
                    }, true)
                );
                break;
        }
    }
    
    function updateUI() {
        let stateText = '--';

        // 🚨 BUG FIX #3: VALIDAR currentState antes de usar
        if (!appState.currentState ||
            !['FUERA', 'JORNADA', 'PAUSA', 'ALMACEN'].includes(appState.currentState)) {
            logActivity(`⚠️ Estado inválido detectado: "${appState.currentState}" - Resetejant a FUERA`);
            appState.currentState = 'FUERA';
            appState.workStartTime = null;
            appState.currentPauseStart = null;
            appState.currentPauseType = null;
            appState.isAlarmPlaying = false;
            appState.pauseAlarmTriggered = false;
            saveState();
        }

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
                const pauseTypeText = appState.currentPauseType === 'esmorçar' ? ' (15 min)' : (appState.currentPauseType === 'dinar' ? ' (30 min)' : '');
                stateText = `En Pausa${pauseTypeText}${dayInfo}`;
                break;
            case 'ALMACEN':
                stateText = `En 9teknic${dayInfo}${standardInfo}`;
                break;
            default:
                logActivity(`❌ Estado desconocido en switch: "${appState.currentState}"`);
                stateText = 'Error de Estado';
        }

        dom.currentStateText.textContent = stateText;

        const pauseLabelElem = document.getElementById('pause-timer-label');
        if (pauseLabelElem) {
            if (appState.currentState === 'PAUSA') {
                pauseLabelElem.textContent = appState.currentPauseType === 'esmorçar' ? 'Pausa (15m)' : 'Pausa (30m)';
            } else {
                pauseLabelElem.textContent = 'Pausa';
            }
        }

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
