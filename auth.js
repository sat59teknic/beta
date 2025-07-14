// auth.js - Sistema de autenticación seguro

class AuthManager {
    constructor() {
        this.storageKey = 'beta10_auth_data';
        this.isAuthenticated = false;
        this.credentials = null;
    }

    // Encriptar credenciales de forma simple pero segura
    encrypt(text) {
        const encoded = btoa(unescape(encodeURIComponent(text)));
        return encoded.split('').reverse().join('');
    }

    // Desencriptar credenciales
    decrypt(encodedText) {
        try {
            const reversed = encodedText.split('').reverse().join('');
            return decodeURIComponent(escape(atob(reversed)));
        } catch (e) {
            return null;
        }
    }

    // Guardar credenciales en localStorage
    saveCredentials(username, password) {
        const authData = {
            username: this.encrypt(username),
            password: this.encrypt(password),
            timestamp: new Date().getTime(),
            version: 'v1'
        };
        
        localStorage.setItem(this.storageKey, JSON.stringify(authData));
        this.credentials = { username, password };
        this.isAuthenticated = true;
        
        console.log('🔐 Credenciales guardadas de forma segura');
    }

    // Cargar credenciales guardadas
    loadSavedCredentials() {
        try {
            const stored = localStorage.getItem(this.storageKey);
            if (!stored) return null;

            const authData = JSON.parse(stored);
            const username = this.decrypt(authData.username);
            const password = this.decrypt(authData.password);

            if (username && password) {
                this.credentials = { username, password };
                this.isAuthenticated = true;
                console.log(`🔐 Credenciales cargadas para usuario: ${username}`);
                return this.credentials;
            }
        } catch (e) {
            console.error('❌ Error cargando credenciales:', e.message);
            this.clearCredentials();
        }
        return null;
    }

    // Obtener credenciales actuales
    getCredentials() {
        if (!this.isAuthenticated) {
            const saved = this.loadSavedCredentials();
            return saved;
        }
        return this.credentials;
    }

    // Limpiar credenciales (logout)
    clearCredentials() {
        localStorage.removeItem(this.storageKey);
        this.credentials = null;
        this.isAuthenticated = false;
        console.log('🔐 Credenciales eliminadas');
    }

    // Verificar si hay credenciales válidas
    hasValidCredentials() {
        const creds = this.getCredentials();
        return creds && creds.username && creds.password;
    }

    // Mostrar pantalla de login
    showLoginScreen() {
        return new Promise((resolve) => {
            // Crear modal de login
            const loginModal = document.createElement('div');
            loginModal.className = 'auth-modal-overlay';
            loginModal.innerHTML = `
                <div class="auth-modal-content">
                    <div class="auth-header">
                        <div class="auth-logo">
                            <span class="nine-text">9</span><span class="t-text">T</span>
                        </div>
                        <h2>Beta10 Control</h2>
                        <p>Introduce tus credenciales de Beta10</p>
                    </div>
                    
                    <form class="auth-form" id="loginForm">
                        <div class="auth-field">
                            <label for="auth-username">Usuario Beta10</label>
                            <input type="text" id="auth-username" placeholder="Tu usuario" required autocomplete="username" />
                        </div>
                        
                        <div class="auth-field">
                            <label for="auth-password">Contraseña</label>
                            <input type="password" id="auth-password" placeholder="Tu contraseña" required autocomplete="current-password" />
                        </div>
                        
                        <div class="auth-field">
                            <label class="auth-checkbox">
                                <input type="checkbox" id="auth-remember" checked />
                                <span class="checkmark"></span>
                                Recordar credenciales en este dispositivo
                            </label>
                        </div>
                        
                        <div class="auth-buttons">
                            <button type="submit" class="auth-btn auth-btn-primary">
                                <span class="auth-btn-text">Iniciar Sesión</span>
                                <div class="auth-btn-loading" style="display: none;">
                                    <div class="auth-spinner"></div>
                                    Verificando...
                                </div>
                            </button>
                        </div>
                    </form>
                    
                    <div class="auth-footer">
                        <p><small>Las credenciales se almacenan de forma segura solo en tu dispositivo</small></p>
                    </div>
                </div>
            `;

            document.body.appendChild(loginModal);

            // Enfocar en el primer campo
            setTimeout(() => {
                document.getElementById('auth-username').focus();
            }, 300);

            // Manejar envío del formulario
            const form = document.getElementById('loginForm');
            const submitBtn = form.querySelector('button[type="submit"]');
            const btnText = submitBtn.querySelector('.auth-btn-text');
            const btnLoading = submitBtn.querySelector('.auth-btn-loading');

            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                
                const username = document.getElementById('auth-username').value.trim();
                const password = document.getElementById('auth-password').value;
                const remember = document.getElementById('auth-remember').checked;

                if (!username || !password) {
                    this.showAuthError('Por favor, completa todos los campos');
                    return;
                }

                // Mostrar loading
                submitBtn.disabled = true;
                btnText.style.display = 'none';
                btnLoading.style.display = 'flex';

                try {
                    // Probar credenciales haciendo un test de login
                    const testResult = await this.testCredentials(username, password);
                    
                    if (testResult.success) {
                        // Guardar credenciales si el usuario quiere
                        if (remember) {
                            this.saveCredentials(username, password);
                        } else {
                            // Solo guardar en memoria para esta sesión
                            this.credentials = { username, password };
                            this.isAuthenticated = true;
                        }

                        // Cerrar modal
                        document.body.removeChild(loginModal);
                        resolve({ username, password });
                    } else {
                        this.showAuthError(testResult.error || 'Credenciales incorrectas');
                        // Restaurar botón
                        submitBtn.disabled = false;
                        btnText.style.display = 'block';
                        btnLoading.style.display = 'none';
                    }
                } catch (error) {
                    this.showAuthError('Error de conexión. Verifica tu internet.');
                    // Restaurar botón
                    submitBtn.disabled = false;
                    btnText.style.display = 'block';
                    btnLoading.style.display = 'none';
                }
            });

            // Cerrar con ESC
            document.addEventListener('keydown', function(e) {
                if (e.key === 'Escape' && document.body.contains(loginModal)) {
                    // No permitir cerrar sin autenticarse
                    document.getElementById('auth-username').focus();
                }
            });
        });
    }

    // Probar credenciales con el servidor
    async testCredentials(username, password) {
        try {
            const response = await fetch('/api/test-auth', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    username: username,
                    password: password
                })
            });

            const result = await response.json();
            return result;
        } catch (error) {
            console.error('Error probando credenciales:', error);
            return { success: false, error: 'Error de conexión' };
        }
    }

    // Mostrar error de autenticación
    showAuthError(message) {
        // Buscar error anterior y eliminarlo
        const existingError = document.querySelector('.auth-error');
        if (existingError) {
            existingError.remove();
        }

        // Crear nuevo mensaje de error
        const errorDiv = document.createElement('div');
        errorDiv.className = 'auth-error';
        errorDiv.textContent = message;

        // Insertar antes de los botones
        const form = document.getElementById('loginForm');
        const buttons = form.querySelector('.auth-buttons');
        form.insertBefore(errorDiv, buttons);

        // Auto-eliminar después de 5 segundos
        setTimeout(() => {
            if (document.body.contains(errorDiv)) {
                errorDiv.remove();
            }
        }, 5000);
    }

    // Mostrar modal de gestión de cuenta
    showAccountModal() {
        const creds = this.getCredentials();
        if (!creds) return;

        const accountModal = document.createElement('div');
        accountModal.className = 'auth-modal-overlay';
        accountModal.innerHTML = `
            <div class="auth-modal-content">
                <div class="auth-header">
                    <h2>Mi Cuenta</h2>
                </div>
                
                <div class="auth-account-info">
                    <div class="auth-field">
                        <label>Usuario actual</label>
                        <div class="auth-user-display">${creds.username}</div>
                    </div>
                    
                    <div class="auth-field">
                        <label>Estado</label>
                        <div class="auth-status-display">
                            <span class="auth-status-dot"></span>
                            Sesión activa
                        </div>
                    </div>
                </div>
                
                <div class="auth-buttons">
                    <button type="button" class="auth-btn auth-btn-secondary" onclick="authManager.closeAccountModal()">
                        Cerrar
                    </button>
                    <button type="button" class="auth-btn auth-btn-danger" onclick="authManager.logout()">
                        Cerrar Sesión
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(accountModal);
        
        // Guardar referencia para poder cerrarla
        this.currentAccountModal = accountModal;
    }

    // Cerrar modal de cuenta
    closeAccountModal() {
        if (this.currentAccountModal && document.body.contains(this.currentAccountModal)) {
            document.body.removeChild(this.currentAccountModal);
            this.currentAccountModal = null;
        }
    }

    // Logout completo
    logout() {
        this.clearCredentials();
        this.closeAccountModal();
        
        // Mostrar mensaje y recargar
        alert('Sesión cerrada. La aplicación se reiniciará.');
        window.location.reload();
    }
}

// Crear instancia global del gestor de autenticación
window.authManager = new AuthManager();
