// error-manager.js - Sistema centralitzat de gestió d'errors

class ErrorManager {
    constructor() {
        this.errorContainer = null;
        this.logFunction = null;
    }
    
    // Inicializar el gestor de errores
    init(logFunction) {
        this.logFunction = logFunction;
        this.createErrorContainer();
    }
    
    // Crear contenedor de errores
    createErrorContainer() {
        if (!this.errorContainer) {
            this.errorContainer = document.createElement('div');
            this.errorContainer.id = 'error-container';
            this.errorContainer.className = 'error-container';
            document.body.appendChild(this.errorContainer);
        }
    }
    
    // Mostrar error al usuario
    showError(message, type = 'error', duration = 5000) {
        this.createErrorContainer();
        
        const errorElement = document.createElement('div');
        errorElement.className = `error-message error-${type}`;
        
        const icon = this.getIconForType(type);
        errorElement.innerHTML = `
            <div class="error-content">
                <span class="error-icon">${icon}</span>
                <span class="error-text">${message}</span>
                <button class="error-close" onclick="this.parentElement.parentElement.remove()">×</button>
            </div>
        `;
        
        this.errorContainer.appendChild(errorElement);
        
        // Auto-eliminar después del tiempo especificado
        setTimeout(() => {
            if (errorElement.parentElement) {
                errorElement.remove();
            }
        }, duration);
        
        // Log del error
        if (this.logFunction) {
            this.logFunction(`❌ ${type.toUpperCase()}: ${message}`);
        }
    }
    
    // Obtener icono según tipo de error
    getIconForType(type) {
        switch (type) {
            case 'network': return '📡';
            case 'gps': return '📍';
            case 'auth': return '🔐';
            case 'server': return '🖥️';
            case 'permission': return '🔒';
            case 'validation': return '⚠️';
            case 'warning': return '⚠️';
            case 'info': return 'ℹ️';
            case 'success': return '✅';
            default: return '❌';
        }
    }
    
    // Traducir errores técnicos a catalán
    translateError(error, context = '') {
        const errorMessage = error.message || error.toString();
        const lowerError = errorMessage.toLowerCase();
        
        // 🌐 ERRORES DE CONECTIVIDAD
        if (lowerError.includes('failed to fetch') || 
            lowerError.includes('network error') || 
            lowerError.includes('fetch')) {
            return {
                message: 'No tens connexió a internet. Comprova la xarxa i torna-ho a intentar.',
                type: 'network',
                action: 'Revisa la connexió WiFi o dades mòbils'
            };
        }
        
        if (lowerError.includes('timeout') || 
            lowerError.includes('timed out')) {
            return {
                message: 'La connexió ha trigat massa temps. Comprova la xarxa.',
                type: 'network',
                action: 'Prova amb millor senyal de xarxa'
            };
        }
        
        if (lowerError.includes('cors') || 
            lowerError.includes('cross-origin')) {
            return {
                message: 'Error de configuració del servidor. Contacta amb administració.',
                type: 'server',
                action: 'Informa a l\'administrador del sistema'
            };
        }
        
        // 🔐 ERRORES DE AUTENTICACIÓN
        if (lowerError.includes('credencials incorrectes') || 
            lowerError.includes('login falló') || 
            lowerError.includes('unauthorized')) {
            return {
                message: 'Usuari o contrasenya incorrectes. Revisa les credencials.',
                type: 'auth',
                action: 'Verifica l\'usuari i contrasenya de Beta10'
            };
        }
        
        if (lowerError.includes('no hay credenciales') || 
            lowerError.includes('inicia sesión')) {
            return {
                message: 'Has de fer login primer. Introdueix les credencials.',
                type: 'auth',
                action: 'Prem el botó d\'usuari per iniciar sessió'
            };
        }
        
        if (lowerError.includes('sesión inválida') || 
            lowerError.includes('session expired')) {
            return {
                message: 'La sessió ha expirat. Torna a fer login.',
                type: 'auth',
                action: 'Prem el botó d\'usuari i torna a entrar'
            };
        }
        
        // 📍 ERRORES DE GPS
        if (lowerError.includes('gps no suportat') || 
            lowerError.includes('geolocation not supported')) {
            return {
                message: 'El teu dispositiu no suporta GPS. Canvia de navegador.',
                type: 'gps',
                action: 'Prova amb Chrome o Firefox'
            };
        }
        
        if (lowerError.includes('permís gps denegat') || 
            error.code === 1) {
            return {
                message: 'Has denegat el permís de localització. Habilita\'l per continuar.',
                type: 'permission',
                action: 'Configuració → Permisos → Localització → Sempre'
            };
        }
        
        if (lowerError.includes('senyal gps no disponible') || 
            error.code === 2) {
            return {
                message: 'No es pot obtenir la ubicació. Vés a un lloc obert.',
                type: 'gps',
                action: 'Surt a l\'exterior o prop d\'una finestra'
            };
        }
        
        if (lowerError.includes('timeout de gps') || 
            error.code === 3) {
            return {
                message: 'El GPS triga massa temps. Reintenta en uns segons.',
                type: 'gps',
                action: 'Espera uns segons i torna-ho a provar'
            };
        }
        
        if (lowerError.includes('coordenades gps invàlides')) {
            return {
                message: 'Les coordenades obtingudes no són vàlides. Reintenta.',
                type: 'gps',
                action: 'Mou-te una mica i torna-ho a provar'
            };
        }
        
        // 🖥️ ERRORES DEL SERVIDOR BETA10
        if (lowerError.includes('error cargando login') || 
            lowerError.includes('http 500') || 
            lowerError.includes('internal server error')) {
            return {
                message: 'El servidor Beta10 té problemes. Prova més tard.',
                type: 'server',
                action: 'Espera uns minuts i torna-ho a intentar'
            };
        }
        
        if (lowerError.includes('http 404') || 
            lowerError.includes('not found')) {
            return {
                message: 'La pàgina Beta10 no existeix. Comprova la configuració.',
                type: 'server',
                action: 'Contacta amb l\'administrador del sistema'
            };
        }
        
        if (lowerError.includes('formulario de fichaje no encontrado') || 
            lowerError.includes('contenido inesperado')) {
            return {
                message: 'El sistema Beta10 ha canviat. Actualitza l\'aplicació.',
                type: 'server',
                action: 'Informa a l\'administrador per actualitzar'
            };
        }
        
        if (lowerError.includes('fichaje falló') || 
            lowerError.includes('resultado inesperado')) {
            return {
                message: 'Error en registrar el fitxatge. Comprova i reintenta.',
                type: 'server',
                action: 'Verifica que l\'horari sigui correcte'
            };
        }
        
        // 🔒 ERRORES DE PERMISOS
        if (lowerError.includes('notification permission') || 
            lowerError.includes('permisos de notificació')) {
            return {
                message: 'Les notificacions estan desactivades. Activa-les per rebre alarmes.',
                type: 'permission',
                action: 'Configuració → Notificacions → Permet'
            };
        }
        
        if (lowerError.includes('wake lock') || 
            lowerError.includes('screen wake')) {
            return {
                message: 'No es pot mantenir la pantalla activa. Normal en aquest navegador.',
                type: 'warning',
                action: 'Mantén l\'aplicació oberta durant les pauses'
            };
        }
        
        // ⚠️ ERRORES DE VALIDACIÓN
        if (lowerError.includes('dades requerides') || 
            lowerError.includes('datos requeridos')) {
            return {
                message: 'Falten dades necessàries. Comprova la informació.',
                type: 'validation',
                action: 'Verifica que tots els camps estiguin complerts'
            };
        }
        
        if (lowerError.includes('action ha de ser') || 
            lowerError.includes('punto no válido')) {
            return {
                message: 'Dades de fitxatge incorrectes. Reintenta.',
                type: 'validation',
                action: 'Prova de nou o contacta amb suport'
            };
        }
        
        // 🚨 ERRORES DE ESTADO
        if (lowerError.includes('has de sortir de la pausa')) {
            return {
                message: 'Primer has de sortir de la pausa abans de finalitzar.',
                type: 'warning',
                action: 'Prem "Tornar de Pausa" primer'
            };
        }
        
        // 📱 ERRORES DE SERVICE WORKER
        if (lowerError.includes('service worker') || 
            lowerError.includes('sw registration')) {
            return {
                message: 'Error en el sistema d\'alarmes. Pot afectar les notificacions.',
                type: 'warning',
                action: 'Recarrega la pàgina per solucionar-ho'
            };
        }
        
        // 🎵 ERRORES DE AUDIO
        if (lowerError.includes('audio') || 
            lowerError.includes('sound')) {
            return {
                message: 'No es pot reproduir so. Les alarmes seran silencioses.',
                type: 'warning',
                action: 'Comprova el volum i permisos d\'àudio'
            };
        }
        
        // 💾 ERRORES DE ALMACENAMIENTO
        if (lowerError.includes('localstorage') || 
            lowerError.includes('quota exceeded')) {
            return {
                message: 'No hi ha espai d\'emmagatzematge. Neteja les dades.',
                type: 'warning',
                action: 'Configuració → Emmagatzematge → Neteja dades'
            };
        }
        
        // 🌐 ERRORES GENERALES DE RED
        if (lowerError.includes('no es pot connectar') || 
            lowerError.includes('connection refused')) {
            return {
                message: 'No es pot connectar amb el servidor. Comprova la connexió.',
                type: 'network',
                action: 'Verifica WiFi o dades mòbils'
            };
        }
        
        // ERROR GENÉRICO
        return {
            message: `Error inesperat: ${errorMessage}`,
            type: 'error',
            action: 'Recarrega la pàgina o contacta amb suport'
        };
    }
    
    // Manejar errores de forma inteligente
    handleError(error, context = '') {
        const translatedError = this.translateError(error, context);
        
        // Crear mensaje completo
        let fullMessage = translatedError.message;
        if (translatedError.action) {
            fullMessage += `\n\n💡 Solució: ${translatedError.action}`;
        }
        
        // Mostrar error al usuario
        this.showError(fullMessage, translatedError.type);
        
        // Log técnico para debugging
        if (this.logFunction) {
            this.logFunction(`🔧 Error tècnic: ${error.message || error}`);
            this.logFunction(`📍 Context: ${context}`);
        }
        
        return translatedError;
    }
    
    // Wrapper para fetch con manejo de errores
    async safeFetch(url, options = {}, context = '') {
        try {
            const response = await fetch(url, options);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            return response;
        } catch (error) {
            this.handleError(error, context || `Fetch a ${url}`);
            throw error;
        }
    }
    
    // Validar conectividad
    async checkConnectivity() {
        try {
            const response = await fetch('/api/health', {
                method: 'GET',
                cache: 'no-cache'
            });
            
            if (!response.ok) {
                throw new Error('Backend no disponible');
            }
            
            return true;
        } catch (error) {
            this.handleError(error, 'Verificació de connectivitat');
            return false;
        }
    }
    
    // Mostrar mensaje de éxito
    showSuccess(message, duration = 3000) {
        this.showError(message, 'success', duration);
    }
    
    // Mostrar advertencia
    showWarning(message, duration = 4000) {
        this.showError(message, 'warning', duration);
    }
    
    // Mostrar información
    showInfo(message, duration = 3000) {
        this.showError(message, 'info', duration);
    }
}

// Crear instancia global
window.errorManager = new ErrorManager();
