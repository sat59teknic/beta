// beta10-direct.js - Connexió directa nativa amb Beta10 (per a APK Capacitor / Android)
const Beta10Direct = (() => {
    const BASE_URL = 'https://9teknic.movbeta10.es:9000';
    const TOKEN_KEY = 'beta10_direct_token';
    const TOKEN_TTL_MS = 23 * 60 * 60 * 1000; // 23h

    let employeeCache = {};
    let pointCache = {};

    function isNative() {
        if (typeof window.Capacitor !== 'undefined' && typeof window.Capacitor.isNativePlatform === 'function') {
            if (window.Capacitor.isNativePlatform()) return true;
        }
        const isLocalHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        const isNativeProtocol = window.location.protocol === 'capacitor:' || window.location.protocol === 'file:';
        const isCapacitorWebview = navigator.userAgent.includes('wv') || navigator.userAgent.includes('Capacitor');

        return isNativeProtocol || (isLocalHost && (!window.location.port || window.location.port === '80' || window.location.port === '443')) || isCapacitorWebview;
    }

    async function getOrRefreshToken(credentials, forceRefresh = false) {
        const now = Date.now();
        if (!forceRefresh) {
            try {
                const stored = localStorage.getItem(TOKEN_KEY);
                if (stored) {
                    const parsed = JSON.parse(stored);
                    if (parsed.username === credentials.username && parsed.token && now < parsed.expiresAt) {
                        console.log(`[Beta10Direct] 🔑 Usant token en cau per a ${credentials.username}`);
                        return parsed.token;
                    }
                }
            } catch (e) {
                // Continuar a demanar nou token
            }
        }

        console.log(`[Beta10Direct] 🌐 Demanant nou token 24h a ${BASE_URL}/token/ per a: ${credentials.username}...`);
        const formData = new FormData();
        formData.append('username', credentials.username);
        formData.append('password', credentials.password);

        const response = await fetch(`${BASE_URL}/token/`, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            throw new Error(`Error sol·licitant token: HTTP ${response.status}`);
        }

        const data = await response.json();
        if (data.response_code !== 1 || !data.token) {
            throw new Error(data.error || 'Credencials no vàlides a Beta10');
        }

        const tokenData = {
            token: data.token,
            expiresAt: now + TOKEN_TTL_MS,
            username: credentials.username
        };
        localStorage.setItem(TOKEN_KEY, JSON.stringify(tokenData));

        console.log(`[Beta10Direct] ✅ Nou token obtingut: ${data.token.substring(0, 15)}...`);
        return data.token;
    }

    async function jsonRpcCall(method, params, token) {
        const body = {
            jsonrpc: '2.0',
            id: 1,
            method: method,
            params: params
        };

        const response = await fetch(`${BASE_URL}/api/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json;charset=UTF-8',
                'Accept': 'application/json',
                'Authorization': `Token ${token}`
            },
            body: JSON.stringify(body)
        });

        if (response.status === 401 || response.status === 403) {
            const err = new Error('SESSION_EXPIRED');
            err.statusCode = response.status;
            throw err;
        }

        if (!response.ok) {
            throw new Error(`Error HTTP en crida ${method}: ${response.status}`);
        }

        const data = await response.json();
        if (data.error) {
            const errMsg = data.error.message || JSON.stringify(data.error);
            const errData = data.error.data ? ` (${data.error.data})` : '';
            throw new Error(`${errMsg}${errData}`);
        }

        if (data.result && data.result.error) {
            throw new Error(data.result.error);
        }

        return data.result;
    }

    async function resolveEmployeeId(username, token) {
        if (employeeCache[username]) return employeeCache[username];

        const filter = {
            operator: 'AND',
            clauses: [
                { field: 'login', operator: '=', value: username, not: false },
                { field: 'estado', operator: '>', value: 0, not: false }
            ]
        };

        const result = await jsonRpcCall('usuariosistema.select', { filter }, token);
        if (!result || !result.dataset || result.dataset.length === 0) {
            throw new Error(`No s'ha trobat cap usuari actiu per a '${username}'`);
        }

        const employeeId = result.dataset[0].idempleado;
        employeeCache[username] = employeeId;
        return employeeId;
    }

    async function resolvePointId(pointCode, token) {
        const codeUpper = String(pointCode).trim().toUpperCase();
        if (pointCache[codeUpper]) return pointCache[codeUpper];

        const filter = {
            operator: 'AND',
            clauses: [
                { field: 'estado', operator: '>', value: 0, not: false },
                { field: 'codigo_scanner', operator: '=', value: codeUpper, not: false }
            ]
        };

        const result = await jsonRpcCall('punto.select', { filter }, token);
        if (!result || !result.dataset || result.dataset.length === 0) {
            if (!isNaN(pointCode)) {
                pointCache[codeUpper] = Number(pointCode);
                return Number(pointCode);
            }
            throw new Error(`Punt de fitxatge '${pointCode}' no trobat a Beta10`);
        }

        const pointId = result.dataset[0].idpunto;
        pointCache[codeUpper] = pointId;
        return pointId;
    }

    async function executeFichaje(action, point, location, observations, credentials) {
        let token = await getOrRefreshToken(credentials);
        let employeeId;
        let pointId;

        for (let attempt = 1; attempt <= 2; attempt++) {
            try {
                employeeId = await resolveEmployeeId(credentials.username, token);
                pointId = await resolvePointId(point, token);

                let rpcResult;
                if (action === 'entrada') {
                    rpcResult = await jsonRpcCall('presencia.registrarEntrada', {
                        idempleado: employeeId,
                        latitud: location.latitude,
                        longitud: location.longitude,
                        observaciones: observations || '',
                        idpunto: pointId,
                        idpuesto_servicio_servicio: null
                    }, token);
                } else {
                    rpcResult = await jsonRpcCall('presencia.registrarSalida', {
                        idempleado: employeeId,
                        latitud: location.latitude,
                        longitud: location.longitude,
                        observaciones: observations || '',
                        idpunto: pointId
                    }, token);
                }

                return {
                    success: true,
                    action: action,
                    point: point,
                    message: `✅ ${action.toUpperCase()} registrada correctament a Beta10`,
                    observations: observations || null,
                    timestamp: new Date().toISOString(),
                    user: credentials.username,
                    result: rpcResult?.dataset?.[0] || null,
                    performance: { platform: 'Android APK Nativa (Capacitor Direct)' }
                };

            } catch (err) {
                if (err.message === 'SESSION_EXPIRED' && attempt === 1) {
                    console.log('[Beta10Direct] ⚠️ Token caducat. Renovant...');
                    token = await getOrRefreshToken(credentials, true);
                    continue;
                }
                throw err;
            }
        }
    }

    async function testAuth(username, password) {
        const formData = new FormData();
        formData.append('username', username);
        formData.append('password', password);

        const response = await fetch(`${BASE_URL}/token/`, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            throw new Error(`Error en servidor Beta10: HTTP ${response.status}`);
        }

        const data = await response.json();
        if (data.response_code === 1 && data.token) {
            return { success: true, message: 'Credencials vàlides', username };
        } else {
            return { success: false, error: data.error || 'Credencials incorrectes a Beta10' };
        }
    }

    return {
        isNative,
        executeFichaje,
        testAuth,
        BASE_URL
    };
})();
