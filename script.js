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
        totalTimer: document.getElementById('total-timer'),
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

    function getLocalDateString(d = new Date()) {
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    // M11: tot text d'usuari / de la BD que acabi dins d'un innerHTML s'ha d'escapar.
    function escapeHtml(value) {
        return String(value === null || value === undefined ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // L3: arrodonir PRIMER a minuts totals evita sortides com "8h 60min".
    function formatHoursMinutes(decimalHours) {
        const totalMin = Math.max(0, Math.round((Number(decimalHours) || 0) * 60));
        return `${Math.floor(totalMin / 60)}h ${totalMin % 60}min`;
    }

    function createDefaultState() {
        return {
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
            workStartDay: null,    // Día de inicio de jornada
            breakfastDate: null    // Data (YYYY-MM-DD) del darrer esmorzar realitzat avui
        };
    }

    let appState = createDefaultState();

    // M14: camps que descriuen l'estat d'aquesta sessió (so en marxa, wake lock...) i que
    // NO s'han de persistir: si l'app es tanca mentre sona, en reobrir quedaria
    // isAlarmPlaying=true i totes les alarmes següents s'ignorarien.
    const TRANSIENT_STATE_KEYS = ['isAlarmPlaying', 'wakeLock', 'wakeLockLost', 'alarmSource'];
    const STATE_STORAGE_KEY = 'beta10AppState';
    const CORRUPT_STATE_STORAGE_KEY = 'beta10AppState_corrupt';

    // 🔧 Variable para detectar cambios de estado y evitar regeneración innecesaria de botones
    let lastKnownState = null;

    // 🚨 BUG FIX #1: Variable global para intervalo de alarma (evita múltiples intervalos simultáneos)
    let alarmIntervalGlobal = null;

    function saveState() {
        try {
            const persistable = { ...appState };
            TRANSIENT_STATE_KEYS.forEach(key => { delete persistable[key]; });
            localStorage.setItem(STATE_STORAGE_KEY, JSON.stringify(persistable));
        } catch (e) {
            // localStorage ple o bloquejat: no ha de tombar el flux de fitxatge
            console.warn('⚠️ No s\'ha pogut desar l\'estat:', e);
        }
    }

    function loadState() {
        const savedState = localStorage.getItem(STATE_STORAGE_KEY);
        if (savedState) {
            let parsedState = null;
            try {
                parsedState = JSON.parse(savedState);
            } catch (e) {
                parsedState = null;
            }

            // M14: JSON il·legible o amb forma inesperada -> arrencar en FUERA conservant una còpia
            if (!parsedState || typeof parsedState !== 'object' || Array.isArray(parsedState)) {
                try {
                    localStorage.setItem(CORRUPT_STATE_STORAGE_KEY, savedState);
                    localStorage.removeItem(STATE_STORAGE_KEY);
                } catch (e) {}
                appState = createDefaultState();
                logActivity('⚠️ L\'estat desat era il·legible: s\'ha guardat una còpia (beta10AppState_corrupt) i s\'ha reiniciat a Fora de Jornada');
                lastKnownState = appState.currentState;
                return;
            }

            // 🚨 BUG FIX #2: VALIDAR timestamps antes de usar
            const workStartTime = parsedState.workStartTime ? new Date(parsedState.workStartTime) : null;
            const currentPauseStart = parsedState.currentPauseStart ? new Date(parsedState.currentPauseStart) : null;
            const lastAlarmTime = parsedState.lastAlarmTime ? new Date(parsedState.lastAlarmTime) : null;

            // VERIFICAR si las fechas son válidas
            const isValidWorkStart = workStartTime && !isNaN(workStartTime.getTime());
            const isValidPauseStart = currentPauseStart && !isNaN(currentPauseStart.getTime());
            const isValidAlarmTime = lastAlarmTime && !isNaN(lastAlarmTime.getTime());

            const pauseTotal = Number(parsedState.totalPauseTimeToday);

            // Convertir strings de fecha a objetos Date
            appState = {
                ...createDefaultState(),
                ...parsedState,
                workStartTime: isValidWorkStart ? workStartTime : null,
                currentPauseStart: isValidPauseStart ? currentPauseStart : null,
                currentPauseType: parsedState.currentPauseType || null,
                lastAlarmTime: isValidAlarmTime ? lastAlarmTime : null,
                totalPauseTimeToday: Number.isFinite(pauseTotal) && pauseTotal >= 0 ? pauseTotal : 0,
                // 🆕 MANTENER HORARIO DINÁMICO
                workDayStandard: parsedState.workDayStandard ?? null,
                workDayType: parsedState.workDayType || null,
                workStartDay: parsedState.workStartDay ?? null,
                breakfastDate: parsedState.breakfastDate || null,
                // Camps transitoris: sempre net en carregar (versions antigues els persistien)
                isAlarmPlaying: false,
                alarmSource: null,
                wakeLock: null,
                wakeLockLost: false
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
    // M9: un mateix error es mostra UNA sola vegada encara que travessi diverses capes
    // (getCurrentLocation -> sendToProxy -> handleAction -> startPause...).
    function showTranslatedError(error) {
        const translatedMessage = translateError(error);
        if (error && typeof error === 'object') {
            if (error.__shown) return;
            try { error.__shown = true; } catch (e) {}
        }
        alert(translatedMessage);
        logActivity(`❌ ERROR: ${translatedMessage}`);
    }

    function showLoading(visible, text = 'Processant...') {
        dom.loadingText.textContent = text;
        dom.loadingOverlay.classList.toggle('visible', visible);
    }

    // M9: si el GPS falla però tenim una posició recent (< 15 min), es pot fitxar amb ella
    const LAST_LOCATION_MAX_AGE_MS = 15 * 60 * 1000;

    function getRecentLocation() {
        const loc = appState.currentLocation;
        if (!loc) return null;
        const lat = Number(loc.latitude);
        const lon = Number(loc.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
        const ts = loc.timestamp ? new Date(loc.timestamp).getTime() : NaN;
        if (!Number.isFinite(ts)) return null;
        const age = Date.now() - ts;
        return age >= 0 && age <= LAST_LOCATION_MAX_AGE_MS ? loc : null;
    }

    // NOTA: getCurrentLocation ja NO mostra cap alert (abans en mostrava un a cada capa i un
    // més a l'arrencada automàtica). Qui la crida decideix si cal avisar l'usuari.
    async function getCurrentLocation() {
        showLoading(true, 'Obtenint GPS...');
        dom.gpsStatus.className = 'status-indicator yellow';
        return new Promise((resolve, reject) => {
            const fail = (error) => {
                showLoading(false);
                const recent = getRecentLocation();
                if (recent) {
                    const ageMin = Math.max(0, Math.round((Date.now() - new Date(recent.timestamp).getTime()) / 60000));
                    dom.gpsStatus.className = 'status-indicator yellow';
                    logActivity(`⚠️ GPS no disponible (${translateError(error)}). S'usa l'última posició coneguda (fa ${ageMin} min).`);
                    resolve(recent);
                    return;
                }
                dom.gpsStatus.className = 'status-indicator red';
                reject(error);
            };

            if (!navigator.geolocation) {
                fail(new Error('GPS no suportat pel navegador.'));
                return;
            }
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    const location = {
                        latitude: position.coords.latitude,
                        longitude: position.coords.longitude,
                        accuracy: position.coords.accuracy,
                        timestamp: new Date().toISOString()
                    };
                    if (!Number.isFinite(Number(location.latitude)) || !Number.isFinite(Number(location.longitude))) {
                        fail(new Error('Coordenades GPS invàlides.'));
                        return;
                    }
                    appState.currentLocation = location;
                    showLoading(false);
                    dom.gpsStatus.className = 'status-indicator green';
                    logActivity(`GPS OK: ${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}`);
                    resolve(location);
                },
                (error) => fail(error),
                { enableHighAccuracy: true, timeout: 20000, maximumAge: 30000 }
            );
        });
    }

    // Función para mostrar modal de selección de tipo de pausa
    function showPauseTypeModal() {
        return new Promise((resolve) => {
            const todayStr = getLocalDateString(new Date());
            const breakfastDone = appState.breakfastDate === todayStr;

            const modal = document.createElement('div');
            modal.className = 'modal-overlay';
            modal.innerHTML = `
                <div class="modal-content">
                    <h3>Tipus de Pausa</h3>
                    <p class="modal-subtitle">Selecciona el tipus de pausa que vols iniciar:</p>
                    <div class="pause-type-buttons">
                        <button class="btn btn-secondary pause-type-btn ${breakfastDone ? 'disabled-breakfast' : ''}" 
                                id="btn-pause-esmorzar" 
                                ${breakfastDone ? 'disabled' : ''}>
                            🥐 Esmorzar
                            <small>${breakfastDone ? '🔒 Ja realitzat avui (només disponible Dinar)' : '15 minuts (avís curt en acabar)'}</small>
                        </button>
                        <button class="btn btn-secondary pause-type-btn" id="btn-pause-dinar">
                            🍽️ Dinar
                            <small>30 minuts (avís curt en acabar)</small>
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

            const esmorzarBtn = document.getElementById('btn-pause-esmorzar');
            if (esmorzarBtn && !breakfastDone) {
                esmorzarBtn.onclick = () => {
                    cleanup();
                    resolve('esmorçar');
                };
            }

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

            // Si són hores extra, les observacions són SEMPRE estrictament obligatòries
            const isStrictRequired = isOvertime || required;
            const effectiveCancelText = 'Cancel·lar'; // Botó de finalitzar sense comentari ELIMINAT

            let overtimeHtml = '';
            if (isOvertime && overtimeDetails) {
                overtimeHtml = `
                    <div class="overtime-card">
                        <div class="overtime-header">
                            <span class="overtime-badge">💰 HORES EXTRA DETECTADES</span>
                        </div>
                        <div class="overtime-grid">
                            <div class="overtime-item">
                                <span class="ot-label">Total Jornada (amb pauses)</span>
                                <span class="ot-value">${escapeHtml(overtimeDetails.totalHoursFormatted)}</span>
                            </div>
                            <div class="overtime-item">
                                <span class="ot-label">Estàndard</span>
                                <span class="ot-value">${escapeHtml(overtimeDetails.standardFormatted)}</span>
                            </div>
                            <div class="overtime-item highlight">
                                <span class="ot-label">Hores Extra</span>
                                <span class="ot-value extra">${escapeHtml(overtimeDetails.extraText)}</span>
                            </div>
                        </div>
                        <p class="overtime-note">⚠️ Has superat la jornada habitual en més de 30 minuts (el total inclou el temps de pauses). Has d'indicar el motiu o feina realitzada obligatòriament.</p>
                    </div>
                `;
            }

            modal.innerHTML = `
                <div class="modal-content">
                    <h3>${escapeHtml(title)}</h3>
                    ${subtitle ? `<p class="modal-subtitle">${escapeHtml(subtitle)}</p>` : ''}
                    ${overtimeHtml}
                    <textarea id="observations-input" placeholder="${escapeHtml(placeholder)}" maxlength="250">${escapeHtml(defaultValue)}</textarea>
                    <div class="modal-buttons">
                        <button type="button" class="btn btn-secondary" id="modal-cancel-btn">${escapeHtml(effectiveCancelText)}</button>
                        <button type="button" class="btn btn-start" id="modal-confirm-btn">${escapeHtml(confirmText)}</button>
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
                if (isStrictRequired && !text) {
                    alert('⚠️ Per a les hores extra és obligatori indicar un comentari detallant la feina o motiu.');
                    if (input) input.focus();
                    return;
                }
                cleanup();
                resolve(text);
            };
        });
    }

    // 🆕 Modal recordatori de WhatsApp després de finalitzar jornada
    function showWhatsAppReminderModal() {
        const existing = document.getElementById('whatsapp-reminder-modal');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.className = 'modal-overlay whatsapp-modal-overlay';
        modal.id = 'whatsapp-reminder-modal';
        modal.innerHTML = `
            <div class="modal-content whatsapp-modal-content">
                <div class="whatsapp-icon-container">
                    <svg class="whatsapp-modal-svg" viewBox="0 0 448 512" width="62" height="62" fill="#25D366" xmlns="http://www.w3.org/2000/svg">
                        <path d="M380.9 97.1C339 55.1 283.2 32 223.9 32c-122.4 0-222 99.6-222 222 0 39.1 10.2 77.3 29.6 111L0 480l117.7-30.9c32.4 17.7 68.9 27 106.1 27h.1c122.3 0 224.1-99.6 224.1-222 0-59.3-25.2-115-67.1-157zm-157 341.6c-33.2 0-65.7-8.9-94-25.7l-6.7-4-69.8 18.3L72 359.2l-4.4-7c-18.5-29.4-28.2-63.3-28.2-98.2 0-101.7 82.8-184.5 184.6-184.5 49.3 0 95.6 19.2 130.4 54.1 34.8 34.9 56.2 81.2 56.1 130.5 0 101.8-84.9 184.6-186.6 184.6zm101.2-138.2c-5.5-2.8-32.8-16.2-37.9-18-5.1-1.9-8.8-2.8-12.5 2.8-3.7 5.6-14.3 18-17.6 21.8-3.2 3.7-6.5 4.2-12 1.4-32.6-16.3-54-29.1-75.5-66-5.7-9.8 5.7-9.1 16.3-30.3 1.8-3.7.9-6.9-.5-9.7-1.4-2.8-12.5-30.1-17.1-41.2-4.5-10.8-9.1-9.3-12.5-9.5-3.2-.2-6.9-.2-10.6-.2-3.7 0-9.7 1.4-14.8 6.9-5.1 5.6-19.4 19-19.4 46.3 0 27.3 19.9 53.7 22.6 57.4 2.8 3.7 39.1 59.7 94.8 83.8 35.2 15.2 49 16.5 66.6 13.9 10.7-1.6 32.8-13.4 37.4-26.4 4.6-13 4.6-24.1 3.2-26.4-1.3-2.5-5-3.9-10.5-6.6z"/>
                    </svg>
                </div>
                <h3 class="whatsapp-modal-title">Grup de WhatsApp</h3>
                <p class="whatsapp-modal-message">
                    No te olvides de enviar la jornada de hoy al grupo de WhatsApp.
                </p>
                <div class="modal-buttons whatsapp-modal-buttons">
                    <button type="button" class="btn btn-whatsapp" id="btn-open-whatsapp">
                        <span>📲</span> Obrir WhatsApp
                    </button>
                    <button type="button" class="btn btn-secondary" id="btn-close-whatsapp-modal">
                        Entès / Tancar
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        const closeModal = () => {
            if (document.body.contains(modal)) {
                document.body.removeChild(modal);
            }
        };

        const closeBtn = modal.querySelector('#btn-close-whatsapp-modal');
        if (closeBtn) closeBtn.onclick = closeModal;

        modal.onclick = (e) => {
            if (e.target === modal) closeModal();
        };

        const openBtn = modal.querySelector('#btn-open-whatsapp');
        if (openBtn) {
            openBtn.onclick = () => {
                try {
                    window.open('https://api.whatsapp.com/', '_blank');
                } catch (e) {
                    console.warn('No s\'ha pogut obrir WhatsApp directament:', e);
                }
                closeModal();
            };
        }
    }
    window.showWhatsAppReminderModal = showWhatsAppReminderModal;

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
    //
    // FÒRMULA (M1, decisió consolidada - NO canviar sense parlar-ne amb l'usuari):
    //   jornada total = temps transcorregut des de l'inici (INCLOU les pauses, esmorzar/dinar).
    //   extra real    = max(0, jornada total - horari estàndard del dia)   (cap de setmana: tot és extra)
    //   remunerada    = blocs complets de 30 min de l'extra real, PER DIA (floor(extra / 0.5) * 0.5)
    // Les pauses NO es resten de la jornada total a l'hora de calcular l'extra; sí que es resten
    // del "treballat" (workedHours) que es desa a SQLite.
    //
    // M2: en estat PAUSA la pausa en curs ja forma part del temps transcorregut; abans es
    // tornava a sumar i la jornada total sortia inflada.
    // `at` permet calcular amb un instant fix (M4: es calcula una sola vegada en finalitzar).
    function calculateExtraHours(at = null) {
        const empty = {
            extraHours: 0,
            workedExtraHours: 0,
            remuneratedExtraHours: 0,
            totalHours: 0,
            extraBlocks: 0,
            standardWorkDay: 9
        };
        const start = appState.workStartTime ? new Date(appState.workStartTime) : null;
        if (!start || isNaN(start.getTime())) return empty;

        const now = at ? new Date(at) : new Date();
        const elapsedMs = now - start;
        if (!Number.isFinite(elapsedMs)) return empty;

        const totalJourneyTime = Math.max(0, elapsedMs) / (1000 * 60 * 60);

        // 🆕 USAR HORARIO DINÁMICO (0 és un valor vàlid: cap de setmana)
        const rawStandard = appState.workDayStandard;
        const standardWorkDay = (rawStandard === null || rawStandard === undefined || !Number.isFinite(Number(rawStandard)))
            ? 9
            : Number(rawStandard);

        // Horas extra reales trabajadas (efectivas)
        const workedExtraHours = standardWorkDay === 0
            ? totalJourneyTime // Fin de semana: toda la jornada computa como tiempo extra
            : Math.max(0, totalJourneyTime - standardWorkDay);

        // Horas extra remuneradas: solo se computan y pagan bloques completos de 30 minutos (0.5h) por día
        // Si es < 30 min (ej. 23 min) = 0h remuneradas
        // Si es >= 30 min (ej. 45 min) = 0.5h remuneradas (los 15 min restantes no se pagan ni acumulan)
        // Se reinicia cada día de forma independiente
        const extraBlocks = Math.floor((workedExtraHours + 0.0001) / 0.5);
        const remuneratedExtraHours = extraBlocks * 0.5;

        return {
            extraHours: workedExtraHours,
            workedExtraHours: workedExtraHours,
            remuneratedExtraHours: remuneratedExtraHours,
            totalHours: totalJourneyTime,
            extraBlocks: extraBlocks,
            standardWorkDay: standardWorkDay
        };
    }

    // Textos i decisions derivades d'un resultat de calculateExtraHours (una sola font de veritat)
    function buildOvertimeInfo(extraInfo) {
        const standardWorkDay = extraInfo.standardWorkDay;
        const dayType = appState.workDayType || getDayTypeName(new Date());
        const totalHoursFormatted = formatHoursMinutes(extraInfo.totalHours);
        const standardFormatted = getStandardWorkDayFormatted(standardWorkDay);

        let extraText = '';
        let hasOvertime = false;
        if (extraInfo.remuneratedExtraHours >= 0.5) {
            hasOvertime = true;
            const extraBlocks = extraInfo.extraBlocks;
            const hours = Math.floor(extraBlocks / 2);
            const mins = (extraBlocks % 2) * 30;
            extraText = mins === 0 ? `+${hours}h` : (hours === 0 ? `+${mins}min` : `+${hours}h ${mins}min`);
        }
        return { standardWorkDay, dayType, totalHoursFormatted, standardFormatted, extraText, hasOvertime };
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

    // --- COA D'ESCRIPTURES PENDENTS A SQLITE (A3) ---
    // Si guardar a SQLite falla (IndexedDB ple/bloquejat...), l'escriptura es desa aquí
    // (localStorage) i es reintenta quan la BD torna a estar disponible.
    const PENDING_DB_KEY = 'beta10_pending_db_writes';
    const PENDING_DB_MAX = 500;
    const DB_WRITE_METHODS = { jornada: 'recordJornada', pausa: 'recordPausa', fichaje: 'recordFichaje' };
    let dbQueueFlushing = false;

    function readDbQueue() {
        try {
            const raw = localStorage.getItem(PENDING_DB_KEY);
            const parsed = raw ? JSON.parse(raw) : [];
            return Array.isArray(parsed) ? parsed : [];
        } catch (e) {
            return [];
        }
    }

    function writeDbQueue(list) {
        try {
            if (!list || list.length === 0) localStorage.removeItem(PENDING_DB_KEY);
            else localStorage.setItem(PENDING_DB_KEY, JSON.stringify(list.slice(-PENDING_DB_MAX)));
        } catch (e) {
            console.warn('⚠️ No s\'ha pogut desar la coa de pendents a SQLite:', e);
        }
    }

    function queueDbWrite(kind, payload, error) {
        const list = readDbQueue();
        list.push({
            kind,
            payload,
            queuedAt: new Date().toISOString(),
            error: String((error && error.message) || error || '')
        });
        writeDbQueue(list);
    }

    /**
     * Escriu a SQLite. Retorna true si s'ha desat, false si ha fallat i ha quedat a la coa,
     * null si no hi ha base de dades disponible.
     * @param {{notifyUser?: boolean}} options notifyUser: avisar amb un alert (dades que no es poden perdre)
     */
    async function recordDb(kind, payload, options = {}) {
        const db = window.beta10DB;
        const method = DB_WRITE_METHODS[kind];
        if (!db || typeof db[method] !== 'function') return null;
        try {
            await db[method](payload);
            return true;
        } catch (error) {
            queueDbWrite(kind, payload, error);
            logActivity(`❌ Error SQLite (${kind}): ${error.message}. L'escriptura ha quedat en cua i es reintentarà.`);
            if (options.notifyUser) {
                alert(`⚠️ No s'ha pogut desar la ${kind} a la base de dades local (${error.message}).\nHa quedat en cua i es reintentarà automàticament; no tanquis la sessió d'aquest dispositiu fins que es desi.`);
            }
            return false;
        }
    }

    async function flushDbQueue() {
        const db = window.beta10DB;
        if (!db || dbQueueFlushing) return 0;
        dbQueueFlushing = true;
        let done = 0;
        try {
            let list = readDbQueue();
            while (list.length > 0) {
                const item = list[0];
                const method = DB_WRITE_METHODS[item.kind];
                if (typeof db[method] !== 'function') { list.shift(); writeDbQueue(list); continue; }
                try {
                    await db[method](item.payload);
                } catch (error) {
                    logActivity(`⚠️ Reintent SQLite fallit (${item.kind}): ${error.message}`);
                    break;
                }
                list.shift();
                writeDbQueue(list);
                done++;
            }
            if (done > 0) logActivity(`💾 ${done} escriptura(es) pendent(s) desades a SQLite`);
        } finally {
            dbQueueFlushing = false;
        }
        return done;
    }

    // --- GESTIÓ DE SINCRONITZACIÓ PENDENT (OFFLINE RETRY MANAGER) ---
    // M8: la cua admet VARIS pendents (abans el segon sobreescrivia el primer) i cada acció
    // guarda la seva hora original.
    const PENDING_SYNC_KEY = 'beta10_pending_sync';
    let pendingSyncInFlight = false;

    function getPendingSync() {
        try {
            const raw = localStorage.getItem(PENDING_SYNC_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            const list = Array.isArray(parsed) ? parsed : (parsed && typeof parsed === 'object' ? [parsed] : []);
            return list.length > 0 ? list : null;
        } catch (e) {
            return null;
        }
    }

    function writePendingSync(list) {
        try {
            if (!list || list.length === 0) localStorage.removeItem(PENDING_SYNC_KEY);
            else localStorage.setItem(PENDING_SYNC_KEY, JSON.stringify(list));
        } catch (e) {}
        renderPendingSyncBanner();
    }

    function savePendingSync(entry) {
        const list = getPendingSync() || [];
        list.push(entry);
        writePendingSync(list);
    }

    function clearPendingSync() {
        writePendingSync([]);
    }

    function renderPendingSyncBanner() {
        let banner = document.getElementById('pending-sync-banner');
        const pending = getPendingSync();

        if (!pending) {
            if (banner) banner.style.display = 'none';
            return;
        }

        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'pending-sync-banner';
            banner.className = 'pending-sync-banner';
            const mainContent = document.querySelector('.main-content');
            if (mainContent) {
                mainContent.insertBefore(banner, mainContent.firstChild);
            }
        }

        const extraCount = pending.length > 1 ? ` (+${pending.length - 1} més)` : '';
        banner.style.display = 'flex';
        banner.innerHTML = `
            <div class="pending-sync-info">
                <span class="pending-sync-icon">📡</span>
                <div class="pending-sync-text">
                    <strong>Fitxatge pendent de sincronitzar</strong>
                    <span>${escapeHtml(pending[0].title || 'Tornada de Pausa')}${escapeHtml(extraCount)} (sense cobertura quan es va prémer)</span>
                </div>
            </div>
            <button id="btn-retry-pending-sync" class="btn-retry-sync" type="button">
                🔄 Reintentar
            </button>
        `;

        const btnRetry = document.getElementById('btn-retry-pending-sync');
        if (btnRetry) {
            btnRetry.onclick = async (e) => {
                e.stopPropagation();
                await executePendingSync();
            };
        }
    }

    // El servidor Beta10 posa la seva pròpia hora; si el fitxatge es reenvia tard, es deixa
    // constància de l'hora original a les observacions.
    function withOriginalTime(observations, isoTimestamp) {
        const when = isoTimestamp ? new Date(isoTimestamp) : null;
        if (!when || isNaN(when.getTime()) || (Date.now() - when.getTime()) < 2 * 60 * 1000) {
            return observations || '';
        }
        const hh = String(when.getHours()).padStart(2, '0');
        const mm = String(when.getMinutes()).padStart(2, '0');
        const dd = String(when.getDate()).padStart(2, '0');
        const mo = String(when.getMonth() + 1).padStart(2, '0');
        const note = `[Fitxatge fet a les ${hh}:${mm} del ${dd}/${mo}]`;
        return observations ? `${observations} ${note}` : note;
    }

    async function executePendingSync() {
        const list = getPendingSync();
        if (!list || pendingSyncInFlight) return;
        pendingSyncInFlight = true;

        showLoading(true, 'Sincronitzant fitxatges pendents...');
        logActivity('🔄 Intentant sincronitzar fitxatges pendents amb Beta10...');

        try {
            await getCurrentLocation();
            while (list.length > 0) {
                const entry = list[0];
                const actions = Array.isArray(entry.actions) ? entry.actions : [];
                while (actions.length > 0) {
                    const act = actions[0];
                    const when = act.timestamp || entry.timestamp;
                    await sendToProxy(act.action, act.point, withOriginalTime(act.observations || '', when), { timestamp: when });
                    // Cada acció enviada s'esborra de la cua a l'acte: un reintent no la duplica
                    actions.shift();
                    writePendingSync(list);
                }
                list.shift();
                writePendingSync(list);
            }
            logActivity('✅ Fitxatges pendents sincronitzats correctament amb Beta10');
            if (dom.infoMessage) {
                dom.infoMessage.textContent = '✅ Sincronització amb Beta10 completada';
                dom.infoMessage.className = 'info-message success';
                setTimeout(() => {
                    if (dom.infoMessage.textContent.includes('Sincronització')) {
                        dom.infoMessage.textContent = '';
                        dom.infoMessage.className = 'info-message';
                    }
                }, 4000);
            }
        } catch (err) {
            logActivity(`⚠️ Encara sense connexió amb Beta10: ${err.message}`);
            showTranslatedError(err);
        } finally {
            pendingSyncInFlight = false;
            showLoading(false);
        }
    }

    async function sendToProxy(action, point, observations = '', options = {}) {
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

            // 💾 Registrar fitxatge a la base de dades SQLite local (sense bloquejar el fitxatge)
            recordDb('fichaje', {
                user: activeUser,
                timestamp: options.timestamp || new Date().toISOString(),
                action: action,
                point: point,
                observations: observations,
                latitude: appState.currentLocation?.latitude,
                longitude: appState.currentLocation?.longitude
            });

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

    // options.skipOvertimeCheck: endWorkday ja ha calculat les hores extra una vegada i ha demanat
    // el comentari; no s'ha de tornar a calcular (M4) ni obrir un segon modal.
    async function handleAction(actions, defaultObservations = '', options = {}) {
        let completed = 0;
        try {
            await getCurrentLocation();

            let observations = defaultObservations || '';
            const isEndingWorkday = actions.some(a => a.newState === 'FUERA');

            // Si es finalitzar jornada i no s'han passat observacions prèviament, comprovar hores extra (>30 min)
            if (isEndingWorkday && !defaultObservations && !options.skipOvertimeCheck) {
                const extraInfo = calculateExtraHours();
                const info = buildOvertimeInfo(extraInfo);

                // Si hi ha hores extra detectades (>30 minuts), obrir la pantalla d'hores extra
                if (info.hasOvertime) {
                    logActivity(`💰 ${info.dayType}: Detectades ${info.extraText} d'hores extra`);

                    const obsResult = await showObservationsModal({
                        title: `💰 Hores Extra Detectades (${info.extraText})`,
                        subtitle: `Has superat la jornada habitual de ${info.standardFormatted}. Has d'indicar motiu o feina realitzada.`,
                        isOvertime: true,
                        overtimeDetails: {
                            totalHoursFormatted: info.totalHoursFormatted,
                            standardFormatted: info.standardFormatted,
                            dayType: info.dayType,
                            extraText: info.extraText
                        },
                        placeholder: `Ex: ${info.extraText} Feina allargada per incidència client XYZ...`,
                        defaultValue: `${info.extraText} `,
                        required: true,
                        confirmText: 'Confirmar i Finalitzar',
                        cancelText: 'Cancel·lar'
                    });

                    if (obsResult === null) {
                        logActivity('⚠️ Finalització cancel·lada (les hores extra requereixen comentari obligatori)');
                        return;
                    } else {
                        observations = obsResult;
                    }
                } else if (extraInfo.totalHours > info.standardWorkDay) {
                    const extraMinutes = Math.round((extraInfo.totalHours - info.standardWorkDay) * 60);
                    logActivity(`ℹ️ Jornada amb ${extraMinutes} minuts extra (menys de 30min, no es considera hora extra)`);
                } else {
                    logActivity(`✅ Jornada completada dins del temps estàndard`);
                }
            }

            for (const { action, point, newState, onComplete, observations: actionObs } of actions) {
                const finalObs = actionObs || observations;
                await sendToProxy(action, point, finalObs);
                if (newState) appState.currentState = newState;
                if (onComplete) await onComplete();
                saveState();
                updateUI();
                completed++;
            }
        } catch (error) {
            if (error && typeof error === 'object') {
                try { error.completedActions = completed; } catch (e) {}
            }
            showTranslatedError(error);
            showLoading(false);
            throw error;
        }
    }

    // M3: les transicions esperen (await) a handleAction. L'error ja s'ha mostrat a handleAction;
    // aquí només s'evita un "unhandled promise rejection" (abans handleAction es llançava sense await).
    async function runActions(actions, observations = '', options = {}) {
        try {
            await handleAction(actions, observations, options);
            return true;
        } catch (error) {
            return false;
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

        await runActions([
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

        await runActions([
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

        await runActions([
            { action: 'salida', point: '9', observations: obs },
            { action: 'entrada', point: 'J', newState: 'JORNADA', observations: obs }
        ], obs);
    }

    // Funció per iniciar pausa directa (Esmorzar 15 min / Dinar 30 min) o via modal
    async function startPause(type = null) {
        try {
            const pauseType = type || await showPauseTypeModal();
            if (!pauseType) return; // Usuari cancel·la

            // Validar que no es repeteixi l'esmorzar en el mateix dia
            if (pauseType === 'esmorçar') {
                const todayStr = getLocalDateString(new Date());
                if (appState.breakfastDate === todayStr) {
                    dom.infoMessage.textContent = '🔒 L\'esmorzar ja ha estat realitzat avui (només disponible Dinar)';
                    dom.infoMessage.classList.add('alert');
                    logActivity('⚠️ Intent d\'iniciar un segon esmorzar rebutjat');
                    return;
                }
            }

            await getCurrentLocation();

            // Primer fitxatge: Sortida de jornada
            await sendToProxy('salida', 'J', '');

            // Segon fitxatge: Entrada a pausa amb observacions del tipus
            await sendToProxy('entrada', 'P', pauseType);

            // Actualitzar estat
            const pauseStartedAt = new Date();
            appState.currentState = 'PAUSA';
            appState.currentPauseStart = pauseStartedAt;
            appState.currentPauseType = pauseType;
            appState.pauseAlarmTriggered = false;
            // Estat net d'alarma: un valor obsolet d'una sessió anterior no ha de silenciar aquesta pausa
            appState.isAlarmPlaying = false;
            appState.lastAlarmTime = null;
            appState.alarmSource = null;
            if (pauseType === 'esmorçar') {
                appState.breakfastDate = getLocalDateString(new Date());
            }
            // Desar JA: si l'app es tanca durant els passos següents, la pausa no es perd
            saveState();
            updateUI();

            // 1. Mantenir pantalla activa durant la pausa
            await requestWakeLock();

            // 2. Iniciar àudio keep-alive en segon pla i el temporitzador de sessió de fi de pausa
            const pauseLimit = PAUSE_LIMITS[pauseType];
            const remaining = Math.max(1000, pauseLimit - (Date.now() - pauseStartedAt.getTime()));
            startBackgroundAudioKeepAlive(pauseType, remaining);

            // 3. Programar l'avís de fi de pausa (i comprovar que realment queda programat) i
            //    mostrar la notificació persistent "En pausa" amb el botó "Finalitzar pausa"
            if (!isNativeApp) await requestNotificationPermission();
            const scheduled = await scheduleNotification(pauseType, remaining);
            if (isNativeApp) await showPauseStatusNotification();

            // 4. Mostrar instruccions a l'usuari (15 min o 30 min)
            const timeText = pauseType === 'esmorçar' ? '15 minuts' : '30 minuts';
            const info = buildPauseInfoMessage(pauseType, timeText, scheduled);
            dom.infoMessage.textContent = info.text;
            dom.infoMessage.classList.remove('success', 'alert');
            dom.infoMessage.classList.add(info.isWarning ? 'alert' : 'success');

            logActivity(`🍽️ Pausa iniciada: ${pauseType} (${timeText})`);
            logActivity(scheduled.ok
                ? `🔔 Avís de fi de pausa programat per a ${timeText} (actiu amb pantalla bloquejada)`
                : `⚠️ Avís de fi de pausa en segon pla NO garantit: ${scheduled.reason || 'motiu desconegut'}`);

        } catch (error) {
            logActivity(`❌ Error iniciant pausa: ${error.message}`);
            showTranslatedError(error);
        }
    }

    function buildPauseInfoMessage(pauseType, timeText, scheduled) {
        let text = isNativeApp
            ? `⏰ Pausa ${pauseType} iniciada (${timeText}). La tens a les notificacions (pots finalitzar-la des d'allà); en acabar el temps sonarà un avís curt.`
            : `⏰ Pausa ${pauseType} iniciada (${timeText}). En acabar el temps sonarà un avís curt.`;
        let isWarning = false;
        if (!scheduled || !scheduled.ok) {
            isWarning = true;
            text = `⚠️ Pausa ${pauseType} iniciada (${timeText}), però NO s'ha pogut programar l'avís en segon pla`
                + ` (${describeScheduleFailure(scheduled && scheduled.reason)}). Mantingues l'app oberta amb la pantalla encesa.`;
        } else if (scheduled.exactDenied) {
            isWarning = true;
            text += ' ⚠️ Android no permet alarmes exactes a aquesta app: l\'avís pot endarrerir-se uns minuts (activa "Alarmes i recordatoris" a la configuració de l\'app).';
        }
        if (!isWarning && !isNativeApp && notificationStatus.permission === 'denied') {
            isWarning = true;
            text += ' ⚠️ Notificacions denegades: l\'avís només sonarà amb aquesta pestanya oberta.';
        }
        return { text, isWarning };
    }

    function describeScheduleFailure(reason) {
        switch (reason) {
            case 'permission-denied': return 'permís de notificacions denegat: activa\'l a Configuració > Aplicacions > 9T Beta10 > Notificacions';
            case 'not-pending': return 'Android no ha acceptat la programació';
            case 'no-service-worker': return 'el service worker no està actiu';
            default: return reason ? String(reason) : 'motiu desconegut';
        }
    }

    function clearInfoMessage() {
        if (!dom.infoMessage) return;
        dom.infoMessage.textContent = '';
        dom.infoMessage.classList.remove('success', 'alert');
    }

    async function endPause() {
        // Un sol tancament alhora (botó de l'app i botó "Finalitzar pausa" de la notificació). El
        // flag es posa de manera síncrona: les re-publicacions concurrents de notificacions el respecten.
        if (pauseEndInFlight) return;
        if (appState.currentState !== 'PAUSA') {
            stopAlarm();
            await releaseWakeLock();
            return;
        }
        pauseEndInFlight = true;
        try {
            await endPauseInner();
        } finally {
            pauseEndInFlight = false;
        }
    }

    async function endPauseInner() {
        // 1. Treure avisos i notificacions de pausa i alliberar recursos
        stopAlarm();
        await cancelScheduledNotification();
        await releaseWakeLock();
        clearInfoMessage();

        // 2. DETENIR EL TEMPS DE PAUSA EXACTE EN AQUEST INSTANT
        const now = new Date();
        const pauseStart = appState.currentPauseStart ? new Date(appState.currentPauseStart) : now;
        const pauseDuration = Math.max(0, now - pauseStart);
        const pauseMinutes = pauseDuration / (1000 * 60);
        const pauseType = appState.currentPauseType || 'pausa';

        if (pauseType === 'esmorçar') {
            appState.breakfastDate = getLocalDateString(now);
        }

        // 3. REGISTRAR IMMEDIATAMENT A LA BASE DE DADES SQLITE (amb coa si falla)
        const creds = authManager?.getCredentials();
        recordDb('pausa', {
            user: creds?.username || 'usuari',
            date: getLocalDateString(pauseStart),
            type: pauseType,
            startTime: pauseStart,
            endTime: now,
            durationMinutes: pauseMinutes
        }).then((saved) => {
            if (saved) logActivity(`💾 Pausa de ${pauseType} (${Math.round(pauseMinutes)} min) guardada a SQLite`);
        });

        // 4. ATURAR EL TEMPS A L'ESTAT LOCAL IMMEDIATAMENT
        appState.totalPauseTimeToday += pauseDuration;
        appState.currentPauseStart = null;
        appState.currentPauseType = null;
        appState.currentState = 'JORNADA';
        appState.pauseAlarmTriggered = false;
        appState.lastAlarmTime = null;
        appState.alarmSource = null;
        appState.wakeLockLost = false;

        saveState();
        updateUI();
        // Una re-publicació que hagués arribat al plugin just abans del canvi d'estat no queda òrfena
        cancelScheduledNotification();

        logActivity(`⏱️ Temps de pausa aturat: ${Math.round(pauseMinutes)} minuts computats.`);

        // 5. ENVIAR FITXATGES AL SERVIDOR REMOT BETA10
        const returnActions = [
            { action: 'salida', point: 'P' },
            { action: 'entrada', point: 'J', newState: 'JORNADA' }
        ];
        try {
            await handleAction(returnActions);
        } catch (error) {
            logActivity(`⚠️ Error xarxa fitxant tornada de pausa a Beta10: ${error.message}. El temps de pausa local ja s'ha aturat.`);
            // Només es posen en cua les accions que NO s'han arribat a enviar (evita duplicar la "salida P")
            const done = Number.isFinite(error && error.completedActions) ? error.completedActions : 0;
            const iso = now.toISOString();
            const remaining = returnActions.slice(done).map(a => ({ action: a.action, point: a.point, timestamp: iso }));
            if (remaining.length > 0) {
                savePendingSync({
                    type: 'END_PAUSE',
                    title: 'Tornada de Pausa',
                    actions: remaining,
                    timestamp: iso
                });
            }
            showTranslatedError(error);
        }
    }

    async function endWorkday(withObs = false) {
        let customObservations = '';

        // M4: les hores extra es calculen UNA SOLA VEGADA, a l'instant de prémer "Finalitzar".
        // Aquest mateix resultat decideix si cal el modal, què es mostra i què es desa a SQLite
        // (abans handleAction i onComplete tornaven a calcular-ho en moments diferents).
        const endAt = new Date();
        const extraInfo = calculateExtraHours(endAt);
        const info = buildOvertimeInfo(extraInfo);
        const { dayType, totalHoursFormatted, standardFormatted, extraText, hasOvertime } = info;

        if (withObs || hasOvertime) {
            const obsResult = await showObservationsModal({
                title: hasOvertime ? `💰 Hores Extra (${extraText}) Detectades` : '💬 Observacions de Sortida',
                subtitle: hasOvertime
                    ? `Has superat la jornada habitual de ${standardFormatted}. Has d'indicar obligatòriament el motiu o feina.`
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
                required: hasOvertime, // Obligatori si hi ha hores extra
                confirmText: '⛔ Finalitzar Jornada',
                cancelText: 'Cancel·lar'
            });

            if (obsResult === null) {
                logActivity('⚠️ Finalització cancel·lada per l\'usuari');
                return; // Cancel·lat per l'usuari
            }
            customObservations = obsResult;
        }

        // Dades necessàries per al registre a SQLite
        const startWorkDate = appState.workStartTime;
        const pauseInProgressMs = (appState.currentState === 'PAUSA' && appState.currentPauseStart)
            ? Math.max(0, endAt - new Date(appState.currentPauseStart))
            : 0;
        const totalPauseMs = appState.totalPauseTimeToday + pauseInProgressMs;
        const currentStandardHours = appState.workDayStandard ?? 9;
        const currentDayType = appState.workDayType || getDayTypeName(new Date());
        const shiftType = appState.currentState === 'ALMACEN' ? 'ALMACEN' : 'JORNADA';

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
            actions[actions.length - 1].onComplete = async () => {
                const totalWorkMs = startWorkDate ? (endAt - startWorkDate - totalPauseMs) : 0;
                const workedHours = Math.max(0, totalWorkMs / (1000 * 60 * 60));
                const pauseMinutes = totalPauseMs / (1000 * 60);

                // 💾 Registrar jornada a SQLite. A3: s'espera el resultat; si falla, l'usuari
                // és avisat i la jornada queda en una coa persistent (localStorage) que es
                // reintenta quan la BD torna a estar disponible.
                if (startWorkDate) {
                    const creds = authManager.getCredentials();
                    await recordDb('jornada', {
                        user: creds?.username || 'usuari',
                        date: getLocalDateString(startWorkDate),
                        startTime: startWorkDate,
                        endTime: endAt,
                        type: shiftType,
                        dayType: currentDayType,
                        standardHours: currentStandardHours,
                        workedHours: workedHours,
                        extraHours: extraInfo.workedExtraHours || extraInfo.extraHours || 0,
                        remuneratedExtraHours: extraInfo.remuneratedExtraHours || 0,
                        pauseMinutes: pauseMinutes,
                        observations: customObservations || ''
                    }, { notifyUser: true });
                }

                appState.workStartTime = null;
                appState.currentPauseStart = null;
                appState.currentPauseType = null;
                appState.totalPauseTimeToday = 0;
                appState.pauseAlarmTriggered = false;
                appState.workDayStandard = null;
                appState.workDayType = null;
                appState.workStartDay = null;
                stopAlarm();

                // 🟢 Mostrar modal recordatori WhatsApp
                showWhatsAppReminderModal();
            };
        }

        await runActions(actions, customObservations, { skipOvertimeCheck: true });
    }

    // --- SISTEMA DE NOTIFICACIONES, ALARMA Y WAKE LOCK ---
    //
    // Arquitectura de l'avís de pausa (vegeu també CLAUDE.md > "Avisos i notificacions de pausa"):
    //  - APK (Capacitor), dues notificacions:
    //     · 1002 "En pausa": es publica en iniciar la pausa, persistent (ongoing) i silenciosa (canal
    //       LOW) a la safata d'Android, amb el botó "Finalitzar pausa" (END_PAUSE) que tanca la pausa.
    //     · 1001 "Pausa acabada": programada amb AlarmManager (allowWhileIdle) a inici + límit; sona
    //       UNA vegada amb pause_end.wav (CLINK CLINK CLINK) pel canal HIGH. No és una alarma en bucle.
    //  - Web/PWA: setTimeout a la pàgina + un altre al service worker; en acabar sona pause_end.wav una
    //    vegada. Les PWA no poden garantir res amb el navegador tancat (limitació de la plataforma).
    const NATIVE_PAUSE_END_CHANNEL_ID = 'pause_end_channel_v1';
    const NATIVE_PAUSE_STATUS_CHANNEL_ID = 'pause_status_channel_v1';
    // Els canals d'Android són immutables un cop creats: per canviar so/importància cal un id nou i
    // esborrar els vells. v1..v4 eren els de l'antiga alarma en bucle (so en bucle, importància MAX).
    const LEGACY_ALARM_CHANNEL_IDS = ['pause_alarm_channel', 'pause_alarm_channel_v2', 'pause_alarm_channel_v3', 'pause_alarm_channel_v4'];
    const NATIVE_ALARM_NOTIFICATION_ID = 1001;        // "Pausa acabada" (programada)
    const NATIVE_PAUSE_STATUS_NOTIFICATION_ID = 1002; // "En pausa" (persistent)
    const PAUSE_ACTION_TYPE_ID = 'PAUSE_ACTIONS';
    const END_PAUSE_ACTION_ID = 'END_PAUSE';
    const PAUSE_END_SOUND = 'pause_end.wav';
    const NATIVE_SMALL_ICON = 'ic_stat_pause_alarm'; // drawable monocrom creat per scripts/prepare-android.js (L12)
    const EXACT_ALARM_PROMPTED_KEY = 'beta10_exact_alarm_prompted';
    const notificationStatus = { permission: 'unknown', exactAlarm: 'unknown', channelSilenced: false };
    let backgroundAlarmTimer = null;
    let nativeListenersRegistered = false;
    // Hi ha un tancament de pausa en curs (botó de l'app o END_PAUSE de la notificació): evita un
    // doble tancament i que una re-publicació concurrent (tornada a primer pla) deixi notificacions òrfenes.
    let pauseEndInFlight = false;
    // L'avís natiu de fi de pausa ha quedat programat en aquesta sessió: a l'APK, si és així, el so el
    // fa el canal d'Android i l'app NO en reprodueix cap altre (mai doble so).
    let pauseEndNativeOk = false;

    function getAudioPlayer() {
        return document.getElementById('pause-audio-player');
    }

    function getLocalNotificationsPlugin() {
        return isNativeApp ? (window.Capacitor?.Plugins?.LocalNotifications || null) : null;
    }

    function isPauseActive() {
        return appState.currentState === 'PAUSA' && !!appState.currentPauseStart && !!appState.currentPauseType && !pauseEndInFlight;
    }

    // Iniciar reproducció silenciosa (Keep-Alive) durant la pausa
    // Això manté actiu el procés web d'Android/iOS evitant que el navegador suspengui l'àudio quan s'apaga la pantalla.
    // `remainingMs`: temps que falta fins al final de la pausa (no el límit complet en reobrir l'app).
    function startBackgroundAudioKeepAlive(pauseType, remainingMs = null) {
        try {
            const player = getAudioPlayer();
            if (player) {
                player.src = 'silence.wav';
                player.loop = true;
                player.volume = 0.01;
                const playing = player.play();
                if (playing && typeof playing.then === 'function') {
                    playing.then(() => {
                        logActivity('🔈 Keep-Alive d\'àudio iniciat per a la pausa');
                    }).catch(e => {
                        console.warn('⚠️ No s\'ha pogut iniciar àudio keep-alive:', e);
                    });
                }
            }
        } catch (e) {
            console.warn('⚠️ Error en startBackgroundAudioKeepAlive:', e);
        }

        if (backgroundAlarmTimer) {
            clearTimeout(backgroundAlarmTimer);
            backgroundAlarmTimer = null;
        }
        const pauseLimit = PAUSE_LIMITS[pauseType];
        const delay = remainingMs === null || remainingMs === undefined ? pauseLimit : remainingMs;
        if (pauseLimit && Number.isFinite(delay)) {
            backgroundAlarmTimer = setTimeout(() => {
                backgroundAlarmTimer = null;
                if (appState.currentState === 'PAUSA') {
                    logActivity(`⏰ Temporitzador de pausa finalitzat (${pauseType})`);
                    notifyPauseEnd(pauseType, 'background-timer');
                }
            }, Math.max(0, delay));
        }
    }

    // So curt de fi de pausa (CLINK CLINK CLINK) UNA vegada, sense bucle
    function playPauseEndSound() {
        try {
            const player = getAudioPlayer();
            if (!player) {
                createBeepSound('strong');
                return;
            }
            player.src = PAUSE_END_SOUND;
            player.loop = false;
            player.volume = 1.0;
            const playing = player.play();
            if (playing && typeof playing.then === 'function') {
                playing.then(() => {
                    logActivity('🔔 So de fi de pausa reproduït');
                }).catch(e => {
                    console.warn(`⚠️ Error reproduint ${PAUSE_END_SOUND}:`, e);
                    createBeepSound('strong');
                });
            }
        } catch (e) {
            console.warn('⚠️ Error en playPauseEndSound:', e);
            createBeepSound('strong');
        }
    }

    // Aturar qualsevol àudio de pausa i temporitzador
    function stopAlarmAudio() {
        if (backgroundAlarmTimer) {
            clearTimeout(backgroundAlarmTimer);
            backgroundAlarmTimer = null;
        }
        try {
            const player = getAudioPlayer();
            if (player) {
                player.pause();
                player.removeAttribute('src');
                player.load();
            }
        } catch (e) {
            console.warn('⚠️ Error aturant àudio:', e);
        }
    }

    // Canals d'Android: "Pausa en curs" (silenciós) i "Fi de pausa" (so curt pause_end.wav)
    async function initNativeNotificationChannel() {
        const LocalNotifications = getLocalNotificationsPlugin();
        if (!LocalNotifications) return;
        try {
            // Esborrar els canals antics un a un (si un falla, els altres s'esborren igualment)
            for (const legacyId of LEGACY_ALARM_CHANNEL_IDS) {
                try { await LocalNotifications.deleteChannel({ id: legacyId }); } catch (e) {}
            }

            await LocalNotifications.createChannel({
                id: NATIVE_PAUSE_STATUS_CHANNEL_ID,
                name: 'Pausa en curs',
                description: 'Indica que estàs en pausa i permet finalitzar-la des de la barra de notificacions',
                importance: 2, // LOW: a la safata, sense so ni finestra emergent
                visibility: 1,
                vibration: false,
                lights: false
            });

            await LocalNotifications.createChannel({
                id: NATIVE_PAUSE_END_CHANNEL_ID,
                name: 'Fi de pausa',
                description: 'Avís curt (clink clink clink) quan s\'acaba el temps de pausa',
                importance: 4, // HIGH: sona i apareix a dalt de la pantalla una vegada
                visibility: 1,
                sound: PAUSE_END_SOUND,
                vibration: true,
                lights: true,
                lightColor: '#F39C12'
            });

            // Botó "Finalitzar pausa" a les dues notificacions
            try {
                await LocalNotifications.registerActionTypes({
                    types: [
                        {
                            id: PAUSE_ACTION_TYPE_ID,
                            actions: [
                                {
                                    id: END_PAUSE_ACTION_ID,
                                    title: '⏹️ Finalitzar pausa'
                                }
                            ]
                        }
                    ]
                });
            } catch (actErr) {
                console.warn('⚠️ No s\'han pogut registrar tipus d\'acció:', actErr);
            }

            // Comprovar que l'usuari no ha silenciat el canal de fi de pausa des de la configuració d'Android
            try {
                if (typeof LocalNotifications.listChannels === 'function') {
                    const listed = await LocalNotifications.listChannels();
                    const channel = (listed?.channels || []).find(c => c.id === NATIVE_PAUSE_END_CHANNEL_ID);
                    notificationStatus.channelSilenced = !!(channel && Number(channel.importance) < 3);
                    if (notificationStatus.channelSilenced) {
                        logActivity('⚠️ El canal "Fi de pausa" està silenciat a la configuració d\'Android: l\'avís no sonarà.');
                    }
                }
            } catch (listErr) {
                console.warn('⚠️ No s\'ha pogut comprovar el canal:', listErr);
            }

            console.log('✅ Canals de notificació de pausa preparats');
        } catch (err) {
            console.warn('⚠️ No s\'ha pogut crear el canal de notificacions:', err);
        }
    }

    // Configurar listeners d'esdeveniments per a notificacions natives
    function setupNativeNotificationListeners() {
        const LocalNotifications = getLocalNotificationsPlugin();
        if (!LocalNotifications || nativeListenersRegistered) return;
        nativeListenersRegistered = true;
        try {
            // Quan una notificació es mostra amb l'app viva. La "En pausa" (1002) també arriba aquí en
            // publicar-se (el plugin crida fireReceived): només la 1001 indica la fi de la pausa.
            Promise.resolve(LocalNotifications.addListener('localNotificationReceived', (notification) => {
                if (Number(notification?.id) !== NATIVE_ALARM_NOTIFICATION_ID) return;
                logActivity(`🔔 Notificació de fi de pausa rebuda: ${notification?.title || ''}`);
                if (appState.currentState === 'PAUSA') {
                    notifyPauseEnd(appState.currentPauseType || 'pausa', 'native-notification');
                }
            })).catch(e => console.warn('⚠️ addListener(localNotificationReceived):', e));

            // Quan l'usuari toca la notificació o el botó "Finalitzar pausa". El plugin obre l'app i
            // TREU la notificació tocada (també la persistent); l'esdeveniment es reté fins que hi ha
            // listener, de manera que també funciona si l'app estava tancada.
            Promise.resolve(LocalNotifications.addListener('localNotificationActionPerformed', (notificationAction) => {
                const actionId = notificationAction?.actionId;
                logActivity(`👆 Notificació de pausa: ${actionId || 'oberta'}`);
                if (actionId === END_PAUSE_ACTION_ID) {
                    if (appState.currentState === 'PAUSA' && !pauseEndInFlight) {
                        logActivity('⏹️ Finalitzant la pausa des de la notificació');
                        endPause().catch(e => logActivity(`❌ Error finalitzant la pausa: ${e.message}`));
                    } else {
                        logActivity('ℹ️ "Finalitzar pausa" ignorat: no hi ha cap pausa en curs');
                        if (appState.currentState !== 'PAUSA') cancelScheduledNotification();
                    }
                } else if (isPauseActive()) {
                    // Tocar el cos la treu de la safata: es torna a publicar mentre duri la pausa
                    showPauseStatusNotification().catch(() => {});
                }
            })).catch(e => console.warn('⚠️ addListener(localNotificationActionPerformed):', e));

            console.log('✅ Listeners de notificacions natives configurats');
        } catch (err) {
            console.warn('⚠️ Error configurant listeners de notificació nativa:', err);
        }
    }

    // Solicitar permisos de notificación (Android nativo o Web). Retorna true si estan concedits.
    async function requestNotificationPermission() {
        const LocalNotifications = getLocalNotificationsPlugin();
        if (LocalNotifications) {
            try {
                // Primer es consulta: si ja estan concedits no cal demanar res
                let status = typeof LocalNotifications.checkPermissions === 'function'
                    ? await LocalNotifications.checkPermissions()
                    : null;
                if (!status || status.display !== 'granted') {
                    status = await LocalNotifications.requestPermissions();
                }
                if (status && status.display === 'granted') {
                    notificationStatus.permission = 'granted';
                    logActivity('✅ Permisos de notificació nativa concedits');
                    await initNativeNotificationChannel();
                    return true;
                }
                notificationStatus.permission = 'denied';
                logActivity('⚠️ Permisos de notificació nativa no concedits');
                return false;
            } catch (error) {
                logActivity(`❌ Error permisos notificació nativa: ${error.message}`);
                return false;
            }
        } else if (!isNativeApp && typeof Notification !== 'undefined' && 'serviceWorker' in navigator) {
            try {
                if (Notification.permission === 'granted') {
                    notificationStatus.permission = 'granted';
                    return true;
                }
                if (Notification.permission === 'denied') {
                    notificationStatus.permission = 'denied';
                    return false;
                }
                const permission = await Notification.requestPermission();
                if (permission === 'granted') {
                    notificationStatus.permission = 'granted';
                    logActivity('✅ Permisos de notificació concedits');
                    return true;
                }
                notificationStatus.permission = 'denied';
                logActivity('⚠️ Permisos de notificació denegats');
                return false;
            } catch (error) {
                logActivity(`❌ Error permisos notificació: ${error.message}`);
                return false;
            }
        }
        return false;
    }

    // Android 12+: sense "Alarmes i recordatoris" l'avís NO és exacte (setAndAllowWhileIdle) i
    // en Doze pot endarrerir-se molts minuts. Es comprova i, un cop, es porta l'usuari a la configuració.
    async function checkExactAlarmSetting(askUser = false) {
        const LocalNotifications = getLocalNotificationsPlugin();
        if (!LocalNotifications || typeof LocalNotifications.checkExactNotificationSetting !== 'function') return 'unknown';
        try {
            const result = await LocalNotifications.checkExactNotificationSetting();
            const value = (result && (result.exact_alarm || result.exactAlarm)) || 'unknown';
            notificationStatus.exactAlarm = value;
            if (value === 'denied') {
                logActivity('⚠️ Alarmes exactes no permeses: l\'avís de fi de pausa pot endarrerir-se.');
                let alreadyAsked = false;
                try { alreadyAsked = !!localStorage.getItem(EXACT_ALARM_PROMPTED_KEY); } catch (e) {}
                if (askUser && !alreadyAsked && typeof LocalNotifications.changeExactNotificationSetting === 'function') {
                    try { localStorage.setItem(EXACT_ALARM_PROMPTED_KEY, '1'); } catch (e) {}
                    if (confirm('Perquè l\'avís de fi de pausa arribi a l\'hora exacta, Android ha de permetre "Alarmes i recordatoris" a aquesta app.\n\nVols obrir la configuració ara?')) {
                        const after = await LocalNotifications.changeExactNotificationSetting();
                        const afterValue = (after && (after.exact_alarm || after.exactAlarm)) || 'unknown';
                        notificationStatus.exactAlarm = afterValue;
                        return afterValue;
                    }
                }
            }
            return value;
        } catch (error) {
            console.warn('⚠️ No s\'ha pogut comprovar l\'alarma exacta:', error);
            return 'unknown';
        }
    }

    function showNotificationWarning(text) {
        if (!dom.infoMessage) return;
        dom.infoMessage.textContent = text;
        dom.infoMessage.classList.remove('success');
        dom.infoMessage.classList.add('alert');
    }

    // M10: s'executa DESPRÉS de pintar la UI; mai bloqueja updateUI esperant el diàleg de permisos.
    async function initNotifications() {
        const granted = await requestNotificationPermission();
        if (granted) {
            if (isNativeApp) await checkExactAlarmSetting(true);
            if (notificationStatus.channelSilenced) {
                showNotificationWarning('🔕 El canal "Fi de pausa" està silenciat a la configuració d\'Android: l\'avís no sonarà. Activa\'l a Configuració > Aplicacions > 9T Beta10 > Notificacions.');
            }
        } else if (isNativeApp ? !!getLocalNotificationsPlugin() : (typeof Notification !== 'undefined')) {
            showNotificationWarning('🔕 Notificacions desactivades: l\'avís de fi de pausa NOMÉS sonarà amb l\'app oberta. Activa-les a la configuració del dispositiu.');
        }
        return granted;
    }

    // Wake Lock para mantener pantalla activa durante pausa si la pantalla está encendida
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
                        logActivity('⚠️ Wake Lock alliberat - L\'avís natiu de fi de pausa segueix programat');

                        // Intentar recuperar wake lock después de 1 segundo si sigue en primer plano
                        setTimeout(async () => {
                            if (appState.currentState === 'PAUSA') {
                                const recovered = await requestWakeLock();
                                if (recovered) {
                                    logActivity('✅ Wake Lock recuperat');
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

    // `navigator.serviceWorker.ready` no es resol MAI si el SW no s'ha registrat (http, mode privat...);
    // sense límit de temps, startPause quedava penjat. Amb límit, es continua amb el que hi hagi.
    async function getServiceWorkerRegistration(timeoutMs = 3000) {
        if (isNativeApp || !('serviceWorker' in navigator)) return null;
        try {
            const timeout = new Promise(resolve => setTimeout(() => resolve(null), timeoutMs));
            const registration = await Promise.race([navigator.serviceWorker.ready, timeout]);
            return registration || null;
        } catch (e) {
            return null;
        }
    }

    async function isNativeAlarmPending() {
        const LocalNotifications = getLocalNotificationsPlugin();
        if (!LocalNotifications || typeof LocalNotifications.getPending !== 'function') return null;
        try {
            const pending = await LocalNotifications.getPending();
            return (pending?.notifications || []).some(n => Number(n.id) === NATIVE_ALARM_NOTIFICATION_ID);
        } catch (e) {
            return null;
        }
    }

    function formatClock(date) {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    // Notificació persistent "En pausa" (1002) amb el botó "Finalitzar pausa". Mateix id: mai duplicada.
    // Si el temps ja s'ha esgotat, el text ho diu (canal LOW: re-publicar-la no fa soroll).
    async function showPauseStatusNotification() {
        const LocalNotifications = getLocalNotificationsPlugin();
        if (!LocalNotifications || notificationStatus.permission !== 'granted' || !isPauseActive()) return false;
        const pauseType = appState.currentPauseType;
        const limit = PAUSE_LIMITS[pauseType];
        if (!limit) return false;
        const start = new Date(appState.currentPauseStart);
        const end = new Date(start.getTime() + limit);
        const overrun = Date.now() >= end.getTime();
        const title = pauseType === 'esmorçar' ? '☕ En pausa: esmorçar' : `🍽️ En pausa: ${pauseType}`;
        const body = overrun
            ? `⚠️ Temps esgotat a les ${formatClock(end)}. Recorda finalitzar la pausa.`
            : `Des de les ${formatClock(start)} · acaba a les ${formatClock(end)}`;
        try {
            await LocalNotifications.schedule({
                notifications: [
                    {
                        id: NATIVE_PAUSE_STATUS_NOTIFICATION_ID,
                        title,
                        body,
                        largeBody: `${body}\nPrem "Finalitzar pausa" per tornar a la jornada (s'obrirà l'app).`,
                        channelId: NATIVE_PAUSE_STATUS_CHANNEL_ID,
                        smallIcon: NATIVE_SMALL_ICON,
                        iconColor: '#F39C12',
                        ongoing: true,
                        autoCancel: false,
                        actionTypeId: PAUSE_ACTION_TYPE_ID,
                        extra: { kind: 'pause-status', pauseType }
                    }
                ]
            });
            // La pausa s'ha tancat mentre es publicava: no deixar-la òrfena
            if (!isPauseActive()) {
                await cancelScheduledNotification();
                return false;
            }
            return true;
        } catch (error) {
            logActivity(`⚠️ No s'ha pogut mostrar la notificació "En pausa": ${error.message}`);
            return false;
        }
    }

    // Programar l'avís de fi de pausa amb AlarmManager nadiu (segon pla real) o Service Worker.
    // `delayMs` = 0 i APK => es publica a l'instant (temporitzador de l'app arribat abans que l'alarma
    // inexacta d'Android). Retorna { ok, reason?, exactDenied? }: cap fallada se silencia.
    async function scheduleNotification(pauseType, delayMs) {
        const timeLimit = pauseType === 'esmorçar' ? 15 : 30;
        const targetDate = new Date(Date.now() + delayMs);
        const outcome = { ok: false, reason: null, exactDenied: false };

        try {
            const LocalNotifications = getLocalNotificationsPlugin();
            if (LocalNotifications) {
                pauseEndNativeOk = false;
                // El permís pot haver-se revocat des de l'última vegada
                const granted = notificationStatus.permission === 'granted'
                    ? (typeof LocalNotifications.checkPermissions === 'function'
                        ? ((await LocalNotifications.checkPermissions())?.display === 'granted')
                        : true)
                    : await requestNotificationPermission();
                if (!granted) {
                    notificationStatus.permission = 'denied';
                    outcome.reason = 'permission-denied';
                    return outcome;
                }

                // Cancelar l'avís previ (mateix id: mai hi ha duplicats)
                try {
                    await LocalNotifications.cancel({ notifications: [{ id: NATIVE_ALARM_NOTIFICATION_ID }] });
                } catch (e) {}

                // La pausa pot haver-se tancat mentre s'esperava (END_PAUSE concurrent)
                if (!isPauseActive()) {
                    outcome.reason = 'pause-ended';
                    return outcome;
                }

                const immediate = !(delayMs > 0);
                const notification = {
                    id: NATIVE_ALARM_NOTIFICATION_ID,
                    title: '⏰ Pausa acabada',
                    body: `Han passat els ${timeLimit} minuts de ${pauseType}. Recorda finalitzar la pausa.`,
                    channelId: NATIVE_PAUSE_END_CHANNEL_ID,
                    smallIcon: NATIVE_SMALL_ICON,
                    iconColor: '#F39C12',
                    sound: PAUSE_END_SOUND,
                    actionTypeId: PAUSE_ACTION_TYPE_ID,
                    extra: { kind: 'pause-end', pauseType: pauseType }
                };
                // allowWhileIdle: true => sona encara que el mòbil estigui en repòs/bloquejat
                if (!immediate) notification.schedule = { at: targetDate, allowWhileIdle: true };
                await LocalNotifications.schedule({ notifications: [notification] });

                if (immediate) {
                    outcome.ok = true;
                    pauseEndNativeOk = !notificationStatus.channelSilenced;
                    return outcome;
                }

                // El plugin descarta en silenci les programacions amb hora passada; es verifica
                const pending = await isNativeAlarmPending();
                if (pending === false) {
                    outcome.reason = 'not-pending';
                    logActivity('❌ Android no ha deixat programat l\'avís de fi de pausa');
                    return outcome;
                }

                const exact = await checkExactAlarmSetting(false);
                outcome.exactDenied = exact === 'denied';
                outcome.ok = true;
                pauseEndNativeOk = !notificationStatus.channelSilenced;

                logActivity(`🔔 Avís de fi de pausa programat a les ${formatClock(targetDate)} (${timeLimit} min) - Funcionarà en segon pla`);
            } else if (!isNativeApp && 'serviceWorker' in navigator) {
                const registration = await getServiceWorkerRegistration();
                const worker = registration && (registration.active || navigator.serviceWorker.controller);
                if (!worker) {
                    outcome.reason = 'no-service-worker';
                    return outcome;
                }

                // Enviar mensaje al service worker para programar notificación
                worker.postMessage({
                    type: 'SCHEDULE_NOTIFICATION',
                    pauseType: pauseType,
                    delayMs: delayMs,
                    timeLimit: timeLimit
                });
                outcome.ok = true;

                logActivity(`🔔 Notificació programada: ${pauseType} en ${Math.round(delayMs/1000/60)} min`);
            } else {
                outcome.reason = 'sense suport de notificacions';
            }
        } catch (error) {
            outcome.reason = error.message || String(error);
            logActivity(`❌ Error programant l'avís de fi de pausa: ${error.message}`);
        }
        return outcome;
    }

    // Reobrir l'app / tornar al primer pla amb una pausa en curs: es torna a mostrar la notificació
    // "En pausa" (l'usuari pot haver-la lliscat a Android 14+) i, si l'avís de fi ja no és programat
    // (reinici, dades esborrades...), es reprograma. Mai crea duplicats (mateixos ids).
    async function ensurePauseAlarmScheduled() {
        if (!isPauseActive()) return null;
        if (isNativeApp) await showPauseStatusNotification();
        const limit = PAUSE_LIMITS[appState.currentPauseType];
        if (!limit) return null;
        const remaining = limit - (Date.now() - new Date(appState.currentPauseStart).getTime());
        if (!(remaining > 0)) return null;
        if (isNativeApp) {
            const pending = await isNativeAlarmPending();
            if (pending === true) return { ok: true, reason: null, exactDenied: false };
        }
        if (!isPauseActive()) return null;
        return scheduleNotification(appState.currentPauseType, remaining);
    }

    // Pausa que ja ha superat el límit sense que hagi sonat res (p. ex. notificacions denegades):
    // avís visible, SENSE so retroactiu.
    function showPauseOverrunNotice() {
        if (appState.currentState !== 'PAUSA' || !appState.currentPauseStart || appState.isAlarmPlaying) return;
        const limit = PAUSE_LIMITS[appState.currentPauseType];
        if (!limit) return;
        const elapsed = Date.now() - new Date(appState.currentPauseStart).getTime();
        if (elapsed >= limit) {
            const over = Math.max(0, Math.round((elapsed - limit) / 60000));
            const timeText = appState.currentPauseType === 'esmorçar' ? '15 minuts' : '30 minuts';
            showNotificationWarning(`⚠️ La pausa de ${appState.currentPauseType} ja ha superat els ${timeText} (fa ${over} min). Torna a la jornada.`);
        }
    }

    // Cancel·lar l'avís programat i treure les notificacions de pausa (1001 i 1002) de la barra.
    // `cancel` també esborra la 1002 del magatzem del plugin (si no, es restauraria en reiniciar el mòbil).
    async function cancelScheduledNotification() {
        try {
            const LocalNotifications = getLocalNotificationsPlugin();
            if (LocalNotifications) {
                pauseEndNativeOk = false;
                const ids = [{ id: NATIVE_ALARM_NOTIFICATION_ID }, { id: NATIVE_PAUSE_STATUS_NOTIFICATION_ID }];
                await LocalNotifications.cancel({ notifications: ids });
                try {
                    if (LocalNotifications.removeDeliveredNotifications) {
                        await LocalNotifications.removeDeliveredNotifications({ notifications: ids });
                    }
                } catch (e) {}
                logActivity('🔕 Notificacions de pausa cancel·lades');
            } else if (!isNativeApp && 'serviceWorker' in navigator) {
                const registration = await getServiceWorkerRegistration(1500);
                const worker = registration && (registration.active || navigator.serviceWorker.controller);
                if (worker) {
                    worker.postMessage({
                        type: 'CANCEL_NOTIFICATION'
                    });
                    logActivity('🔕 Notificació cancelada');
                }
            }
        } catch (error) {
            logActivity(`❌ Error cancel·lant notificacions de pausa: ${error.message}`);
        }
    }

    function createBeepSound(intensity = 'normal') {
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);

            // So curt de reserva per a l'avís de fi de pausa
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

    // Notificació web. `new Notification()` llança "Illegal constructor" a Chrome per a Android
    // (exigeix registration.showNotification) i no ha de tallar mai el banner.
    async function showWebAlarmNotification(pauseType) {
        try {
            if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
            const timeText = pauseType === 'esmorçar' ? '15 minuts' : '30 minuts';
            const title = '⏰ Pausa acabada';
            const options = {
                body: `Han passat els ${timeText} de ${pauseType}. Recorda finalitzar la pausa.`,
                icon: '/icon-192.svg',
                badge: '/icon-192.svg',
                tag: 'pause-end',
                requireInteraction: false,
                silent: false
            };
            const registration = await getServiceWorkerRegistration(1000);
            if (registration && typeof registration.showNotification === 'function') {
                await registration.showNotification(title, options);
            } else {
                new Notification(title, options);
            }
        } catch (e) {
            console.warn('⚠️ No s\'ha pogut mostrar la notificació web:', e);
        }
    }

    // Fi del temps de pausa: avís curt UNA sola vegada per pausa (no és una alarma que calgui aturar).
    // Fonts: notificació nativa rebuda, temporitzador de sessió, service worker o el comptador de la UI.
    function notifyPauseEnd(pauseType, source = 'local') {
        // Només té sentit durant una pausa (el SW o un temporitzador tardà podrien arribar tard)
        if (appState.currentState !== 'PAUSA' || pauseEndInFlight) {
            logActivity(`ℹ️ Avís de fi de pausa (${source}) ignorat: ja no hi ha cap pausa en curs`);
            return;
        }
        if (appState.pauseAlarmTriggered) {
            logActivity(`ℹ️ Avís de fi de pausa ja donat, s'ignora (${source})`);
            return;
        }
        appState.pauseAlarmTriggered = true;
        appState.lastAlarmTime = new Date();
        appState.alarmSource = source;
        saveState();

        logActivity(`🔔 Fi de pausa detectada des de: ${source}`);

        const nativeHandlesSound = isNativeApp && pauseEndNativeOk;
        if (nativeHandlesSound) {
            if (source !== 'native-notification') {
                // El temporitzador de l'app ha arribat abans que l'alarma d'Android (pot ser inexacta):
                // es publica ARA la 1001 (substitueix la programada) => un sol so, puntual.
                scheduleNotification(pauseType, 0).catch(() => {});
            }
        } else {
            // Web, o APK sense avís natiu (permís denegat, canal silenciat...): so curt dins l'app
            try {
                if ('vibrate' in navigator) navigator.vibrate([150, 100, 150, 100, 150]);
            } catch (e) {}
            playPauseEndSound();
            if (!isNativeApp) showWebAlarmNotification(pauseType);
        }

        // La notificació "En pausa" passa a dir que el temps s'ha esgotat
        if (isNativeApp) showPauseStatusNotification().catch(() => {});

        // Banner informatiu dins l'app (es tanca amb "Entesos"; la pausa continua fins que l'usuari la finalitzi)
        const timeText = pauseType === 'esmorçar' ? '15 minuts' : '30 minuts';
        const alarmBanner = document.getElementById('alarm-banner');
        if (alarmBanner) {
            alarmBanner.style.display = 'flex';
            const subElem = document.getElementById('alarm-banner-sub');
            if (subElem) {
                subElem.textContent = `Temps de ${pauseType} completat (${timeText}). Recorda finalitzar la pausa.`;
            }
            const btnStopBanner = document.getElementById('btn-stop-alarm-banner');
            if (btnStopBanner) {
                btnStopBanner.onclick = (e) => {
                    e.stopPropagation();
                    dismissPauseEndBanner();
                };
            }
        }

        logActivity(`⏰ PAUSA ${String(pauseType).toUpperCase()}: ${timeText} completats - recorda tornar a la jornada`);
    }

    // Només amaga el banner informatiu: la pausa i la notificació "En pausa" continuen
    function dismissPauseEndBanner() {
        const alarmBanner = document.getElementById('alarm-banner');
        if (alarmBanner) alarmBanner.style.display = 'none';
    }

    // Neteja completa quan la pausa deixa d'existir: àudio, temporitzador, banner i notificacions 1001/1002
    function stopAlarm() {
        stopAlarmAudio();
        cancelScheduledNotification(); // Treu les notificacions de pausa de la safata
        appState.isAlarmPlaying = false;
        appState.alarmSource = null;

        if (alarmIntervalGlobal) {
            clearInterval(alarmIntervalGlobal);
            alarmIntervalGlobal = null;
        }

        dismissPauseEndBanner();

        const btnSilence = document.getElementById('btn-silence-alarm');
        if (btnSilence) {
            btnSilence.remove();
        }

        if (dom.infoMessage && dom.infoMessage.classList.contains('alert')) {
            dom.infoMessage.classList.remove('alert');
            dom.infoMessage.innerHTML = '';
        }
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
            if (dom.totalTimer) dom.totalTimer.textContent = '00:00:00';
            return;
        }

        if (appState.workStartTime) {
            const now = new Date();
            let workDuration = now - appState.workStartTime - (appState.totalPauseTimeToday || 0);
            
            if (appState.currentState === 'PAUSA' && appState.currentPauseStart) {
                const currentPauseDuration = now - appState.currentPauseStart;
                workDuration -= currentPauseDuration; // Restar la pausa actual que aún no está en el total
                dom.pauseTimer.textContent = formatTime(currentPauseDuration);

                // Control de alarma según el tipo de pausa: només si l'app està oberta i és el moment exacte
                if (appState.currentPauseType && PAUSE_LIMITS[appState.currentPauseType]) {
                    const pauseLimit = PAUSE_LIMITS[appState.currentPauseType];
                    // Finestra estricta de 3 segons per no sonar retroactivament si s'obre més tard
                    if (currentPauseDuration >= pauseLimit && currentPauseDuration < pauseLimit + 3000) {
                        if (!appState.pauseAlarmTriggered) {
                            notifyPauseEnd(appState.currentPauseType, 'timer-limit');
                        }
                    }
                }

            } else {
                dom.pauseTimer.textContent = formatTime(appState.totalPauseTimeToday);
            }
            dom.workTimer.textContent = formatTime(workDuration);

            // Total transcorregut de jornada (treball efectiu + pauses)
            if (dom.totalTimer) {
                const totalDuration = Math.max(0, now - appState.workStartTime);
                dom.totalTimer.textContent = formatTime(totalDuration);
            }
        }
    }
    
    function generateDynamicButtons() {
        if (!appState.currentState ||
            !['FUERA', 'JORNADA', 'PAUSA', 'ALMACEN'].includes(appState.currentState)) {
            logActivity(`⚠️ generateDynamicButtons: Estado inválido "${appState.currentState}" - NO limpiar botones`);
            return;
        }

        dom.buttonContainer.innerHTML = ''; // Limpiar botones
        // Sense això l'interval d'1s tornava a regenerar els botons just després d'updateUI()
        lastKnownState = appState.currentState;

        const showQuickTapToast = () => {
            let toast = document.getElementById('hold-quick-tap-toast');
            if (!toast) {
                toast = document.createElement('div');
                toast.id = 'hold-quick-tap-toast';
                toast.className = 'hold-quick-tap-toast';
                toast.textContent = '⏱️ Mantingues premut 1 segon per activar';
                document.body.appendChild(toast);
            }
            toast.classList.add('show');
            if (window._quickToastTimeout) clearTimeout(window._quickToastTimeout);
            window._quickToastTimeout = setTimeout(() => {
                toast.classList.remove('show');
            }, 1500);
        };

        const createButton = (text, className, action, disabled = false) => {
            const btn = document.createElement('button');
            btn.className = `btn ${className} btn-holdable`;
            btn.disabled = disabled;

            btn.innerHTML = `
                <div class="btn-hold-progress"></div>
                <div class="btn-content-wrap">
                    <span class="btn-main-text">${text}</span>
                    <span class="btn-hold-timer-tag">Prem 1s</span>
                </div>
            `;

            if (disabled) {
                btn.onclick = () => {
                    if (action) action();
                };
                return btn;
            }

            let holdTimer = null;
            let isHolding = false;
            let holdStartTime = 0;

            const startHold = (e) => {
                if (btn.disabled) return;
                // Prevenir menú contextual o selecció
                if (e.cancelable) e.preventDefault();

                isHolding = true;
                holdStartTime = Date.now();
                btn.classList.add('is-holding');

                if (navigator.vibrate) {
                    navigator.vibrate(30);
                }

                holdTimer = setTimeout(() => {
                    if (!isHolding) return;
                    isHolding = false;
                    btn.classList.remove('is-holding');
                    btn.classList.add('is-triggered');

                    if (navigator.vibrate) {
                        navigator.vibrate([70, 40, 70]);
                    }

                    setTimeout(() => {
                        btn.classList.remove('is-triggered');
                    }, 400);

                    // Execució intencionada de l'acció
                    action();
                }, 1000);
            };

            const cancelHold = (e) => {
                if (!isHolding) return;
                const elapsed = Date.now() - holdStartTime;
                isHolding = false;
                btn.classList.remove('is-holding');

                if (holdTimer) {
                    clearTimeout(holdTimer);
                    holdTimer = null;
                }

                // Si ha estat una pulsació massa ràpida (menys d'1s)
                if (elapsed < 900 && elapsed > 40) {
                    showQuickTapToast();
                }
            };

            btn.addEventListener('pointerdown', startHold);
            btn.addEventListener('pointerup', cancelHold);
            btn.addEventListener('pointercancel', cancelHold);
            btn.addEventListener('pointerleave', cancelHold);
            btn.addEventListener('contextmenu', (e) => e.preventDefault());

            return btn;
        };

        const createPair = (btn1, btn2, isEqual = false) => {
            const row = document.createElement('div');
            row.className = isEqual ? 'btn-pair btn-pair-equal' : 'btn-pair';
            row.appendChild(btn1);
            row.appendChild(btn2);
            dom.buttonContainer.appendChild(row);
        };

        // Indicador visual superior
        const hint = document.createElement('div');
        hint.className = 'hold-info-hint';
        hint.innerHTML = '<span>🔒</span> Mantén 1s qualsevol botó per confirmar';
        dom.buttonContainer.appendChild(hint);

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

            case 'JORNADA': {
                const todayStr = getLocalDateString(new Date());
                const breakfastDone = appState.breakfastDate === todayStr;

                // 2 botons directes de Pausa: Esmorçar (15m) i Dinar (30m)
                createPair(
                    createButton(
                        breakfastDone ? '🥐 Esmorzar (Fet)' : '🥐 Esmorzar (15m)',
                        'btn-pause-breakfast',
                        breakfastDone ? () => {
                            dom.infoMessage.textContent = '🔒 L\'esmorzar ja ha estat realitzat avui';
                            dom.infoMessage.classList.add('alert');
                        } : () => startPause('esmorçar'),
                        breakfastDone
                    ),
                    createButton('🍽️ Dinar (30m)', 'btn-pause-lunch', () => startPause('dinar')),
                    true
                );

                // 2 botons per finalitzar jornada (habitual i amb comentari)
                createPair(
                    createButton('⛔ Finalitzar Jornada', 'btn-stop', () => endWorkday(false)),
                    createButton('💬 Finalitzar + Obs', 'btn-stop-obs', () => endWorkday(true))
                );
                break;
            }

            case 'PAUSA':
                const pauseTypeText = appState.currentPauseType === 'esmorçar' ? ' (15 min)' : (appState.currentPauseType === 'dinar' ? ' (30 min)' : '');
                
                dom.buttonContainer.appendChild(
                    createButton(`▶️ Tornar de Pausa${pauseTypeText}`, 'btn-start', endPause, false)
                );

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
            resetToOutOfWorkday();
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

        const statusCard = document.getElementById('status-card');
        const liveBadge = document.getElementById('status-live-badge');
        const liveText = liveBadge ? liveBadge.querySelector('.status-live-text') : null;
        const workBox = document.getElementById('work-timer-box');
        const pauseBox = document.getElementById('pause-timer-box');
        const totalBox = document.getElementById('total-timer-box');

        if (statusCard) {
            statusCard.className = `status-card state-${appState.currentState.toLowerCase()}`;
        }
        document.body.setAttribute('data-app-state', appState.currentState);

        if (liveText) {
            liveText.textContent = appState.currentState === 'FUERA' ? 'INACTIU' : 'ACTIU';
        }

        if (workBox && pauseBox) {
            workBox.classList.toggle('timer-active', appState.currentState === 'JORNADA' || appState.currentState === 'ALMACEN');
            pauseBox.classList.toggle('timer-active', appState.currentState === 'PAUSA');
            if (totalBox) {
                totalBox.classList.toggle('timer-active', appState.currentState !== 'FUERA');
            }
        }

        const pauseLabelElem = document.getElementById('pause-timer-label');
        if (pauseLabelElem) {
            if (appState.currentState === 'PAUSA') {
                pauseLabelElem.textContent = appState.currentPauseType === 'esmorçar' ? '☕ Pausa (15m)' : '🍽️ Pausa (30m)';
            } else {
                pauseLabelElem.textContent = '☕ Pausa';
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
                    // La pausa ja no existeix: res d'avís programat ni notificació "En pausa"
                    stopAlarm();
                    releaseWakeLock();
                    saveState();
                    updateUI();
                    logActivity('🔧 Auto-correcció: Tornat a jornada normal');
                    return true;
                }

                // Si la pausa porta més d'1 hora (probable oblit o error d'aplicació)
                const pauseStart = new Date(appState.currentPauseStart);
                const closedAt = new Date();
                const pauseDuration = closedAt - pauseStart;
                if (pauseDuration > 60 * 60 * 1000) { // 1 hora
                    logActivity('⚠️ Pausa excessivament llarga detectada (>1h)');
                    const closedType = appState.currentPauseType || 'pausa';

                    // M6: la pausa REAL no es perd: es desa a la taula pausas amb la seva durada real.
                    // (El que se suma a la jornada continua limitat al màxim previst més avall, perquè
                    // una pausa oblidada de 3 hores no falsegi les hores treballades.)
                    const creds = authManager?.getCredentials();
                    recordDb('pausa', {
                        user: creds?.username || 'usuari',
                        date: getLocalDateString(pauseStart),
                        type: closedType,
                        startTime: pauseStart,
                        endTime: closedAt,
                        durationMinutes: pauseDuration / (1000 * 60)
                    });

                    // Limitar la pausa al màxim previst (15 min esmorzar o 30 min dinar) en lloc d'afegir hores senceres
                    const maxAllowedMs = PAUSE_LIMITS[appState.currentPauseType] || (15 * 60 * 1000);
                    appState.totalPauseTimeToday += maxAllowedMs;
                    appState.currentState = 'JORNADA';
                    appState.currentPauseStart = null;
                    appState.currentPauseType = null;
                    appState.isAlarmPlaying = false;
                    appState.pauseAlarmTriggered = false;

                    // La pausa ja no existeix: res d'avís programat, notificació "En pausa", so ni pantalla encesa
                    stopAlarm();
                    releaseWakeLock();

                    saveState();
                    updateUI();
                    logActivity(`🔧 Auto-correcció: Pausa tancada automàticament (computada a ${Math.round(maxAllowedMs / 60000)} min a la jornada; pausa real de ${Math.round(pauseDuration / 60000)} min desada a SQLite)`);
                    return true;
                }
            }

            // Detectar jornada sense temps d'inici
            if ((appState.currentState === 'JORNADA' || appState.currentState === 'PAUSA') && !appState.workStartTime) {
                logActivity('⚠️ Estat inconsistent: Jornada sense temps d\'inici');
                resetToOutOfWorkday();
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

    // M7: un reset a FUERA ha de netejar TOT el que pertany a la jornada perduda; si queda la
    // pausa acumulada o l'horari del dia, contaminen la jornada següent.
    function resetToOutOfWorkday() {
        // Si hi havia una pausa en curs, que no en quedin notificacions òrfenes a la safata
        if (appState.currentState === 'PAUSA' || appState.currentPauseStart) {
            stopAlarm();
            releaseWakeLock();
        }
        appState.currentState = 'FUERA';
        appState.workStartTime = null;
        appState.currentPauseStart = null;
        appState.currentPauseType = null;
        appState.totalPauseTimeToday = 0;
        appState.isAlarmPlaying = false;
        appState.pauseAlarmTriggered = false;
        appState.lastAlarmTime = null;
        appState.alarmSource = null;
        appState.workDayStandard = null;
        appState.workDayType = null;
        appState.workStartDay = null;
    }

    // Si hi ha una pausa en curs en obrir l'app: tornar a demanar wake lock, tornar a mostrar la notificació
    // "En pausa", reprogramar l'avís de fi amb el temps que falta (no el límit complet) i, si ja ha passat el
    // límit, avisar visualment sense so retroactiu.
    async function resumeActivePause() {
        // També surt si un "Finalitzar pausa" de la notificació (arrencada en fred) ja està tancant la pausa
        if (!isPauseActive()) return;
        const timeText = appState.currentPauseType === 'esmorçar' ? '15 minuts' : '30 minuts';

        // Volver a activar wake lock si está en pausa
        await requestWakeLock();
        if (!isPauseActive()) {
            await releaseWakeLock();
            return;
        }
        if (isNativeApp) await showPauseStatusNotification();
        const elapsed = new Date() - appState.currentPauseStart;
        const pauseLimit = PAUSE_LIMITS[appState.currentPauseType];
        const remaining = pauseLimit - elapsed;

        if (remaining > 0) {
            dom.infoMessage.textContent = `⏰ Pausa ${appState.currentPauseType} activa (${timeText}). Avís de fi de pausa programat.`;
            dom.infoMessage.classList.add('success');

            // Temporitzador d'aquesta sessió: amb el temps que FALTA, no el límit sencer
            startBackgroundAudioKeepAlive(appState.currentPauseType, remaining);
            const scheduled = await scheduleNotification(appState.currentPauseType, remaining);
            if (!isPauseActive()) {
                // La pausa s'ha tancat mentre es reprogramava: res de keep-alive ni temporitzador orfes
                stopAlarmAudio();
                return;
            }
            if (scheduled.ok) {
                logActivity(`🔔 Notificació reprogramada: ${Math.round(remaining/1000/60)} min restants`);
            } else {
                showNotificationWarning(`⚠️ No s'ha pogut reprogramar l'avís de fi de pausa en segon pla (${describeScheduleFailure(scheduled.reason)}). Mantingues l'app oberta.`);
            }
        } else {
            // Si el temps de pausa ja ha passat fa estona, NO sona res en iniciar l'app
            logActivity(`ℹ️ La pausa de ${appState.currentPauseType} ja ha superat el temps previst (${timeText}).`);
            showPauseOverrunNotice();
        }
    }

    // --- INICIALIZACIÓN OPTIMIZADA PARA VERCEL ---
    async function init() {
        loadState();

        // 💾 INICIALITZAR SQLITE I UI D'ESTADÍSTIQUES
        if (window.beta10DB) {
            window.beta10DB.init().then(() => {
                logActivity('💾 Base de dades SQLite llesta (registres locals)');
                if (window.beta10DBUI) {
                    window.beta10DBUI.init();
                }
                // A3: reintentar les escriptures que no es van poder desar
                return flushDbQueue();
            }).catch(err => {
                console.error('Error inicialitzant SQLite:', err);
                logActivity(`⚠️ Error SQLite: ${err.message}`);
            });
        }

        // 🔍 VALIDACIÓ INICIAL D'ESTAT
        const wasFixed = validateAppState();
        if (wasFixed) {
            logActivity('✅ Estat de l\'app validat i corregit automàticament');
        }

        // 🔔 Listeners de notificacions natives: sincrons i abans de qualsevol await, perquè no es perdi
        // cap esdeveniment (recepció / clic) i perquè la UI no depengui del diàleg de permisos (M10)
        setupNativeNotificationListeners();

        // 🆕 NUEVO: Mostrar información del día al iniciar
        if (appState.currentState !== 'FUERA' && appState.workDayType) {
            const dayInfo = `${appState.workDayType} (${getStandardWorkDayFormatted(appState.workDayStandard)})`;
            logActivity(`📅 Horari d'avui: ${dayInfo}`);
        }

        updateUI();
        renderPendingSyncBanner();

        window.addEventListener('online', () => {
            logActivity('📶 Connexió a Internet restablerta');
            if (getPendingSync()) {
                executePendingSync();
            }
        });

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

        // Petición inicial para calentar GPS (sense alert: és una arrencada automàtica)
        getCurrentLocation().catch(err => {
            logActivity(`⚠️ Error inicial GPS: ${translateError(err)}`);
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
                            logActivity('🔔 Fi de pausa avisada pel Service Worker');
                            notifyPauseEnd(event.data.pauseType, 'service-worker');
                        }
                    });
                })
                .catch(err => logActivity(`❌ Error en registrar Service Worker: ${err}`));
        } else if (isNativeApp) {
            logActivity('📱 Mode APK Nativa: notificació "En pausa" i avís de fi de pausa natius (AlarmManager)');
        }

        // Detectar quan l'app perd/guanya focus
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                if (isNativeApp) {
                    logActivity('📱 App en segon pla: l\'avís de fi de pausa sonarà a la seva hora');
                } else {
                    logActivity('⚠️ Web en segon pla: Mantingues el navegador obert');
                }
            } else {
                logActivity('📱 App en primer pla');
                // En tornar al primer pla NO sona res: l'avís només sona a la seva hora.
                updateTimers();
                // Es verifica que la notificació "En pausa" i l'avís de fi segueixen actius i, si la
                // pausa ja ha superat el límit, es mostra un avís visual (sense so).
                ensurePauseAlarmScheduled().catch(() => {});
                showPauseOverrunNotice();
            }
        });

        logActivity('🚀 Beta10 Control iniciat');
        logActivity('✅ Sistema operatiu amb avisos de pausa');

        // Mostrar avís important sobre el dia
        if (appState.currentState === 'FUERA') {
            setTimeout(() => {
                // Si hi ha un avís de notificacions actiu, no es trepitja
                if (notificationStatus.permission === 'denied' || notificationStatus.channelSilenced) return;
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

        // 🔔 M10: permisos de notificació, canals i reprogramació dels avisos d'una pausa en curs.
        // Al final i sense bloquejar la UI (ja pintada): el diàleg de permisos pot trigar minuts.
        try {
            await initNotifications();
            await resumeActivePause();
        } catch (error) {
            logActivity(`❌ Error configurant notificacions: ${error.message}`);
        }
    }

    init();
});
