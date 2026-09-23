// api/beta10.js - FITXATGE AMB PROTOCOL JSON-RPC I TOKENS DE 24H (V12)
const { resolveCredentials } = require('./crypto-helper');

const BASE_URL = 'https://9teknic.movbeta10.es:9000';
const TOKEN_TTL_MS = 23 * 60 * 60 * 1000; // 23 hores de TTL per seguretat (expira a les 24h)

// Memòria cau del procés serverless
let tokenCache = null;      // { token, expiresAt, username }
let employeeCache = {};     // { [username]: idempleado }
let pointCache = {};        // { [codigo_scanner]: idpunto }

/**
 * Obté un token vàlid des de la memòria cau o sol·licita un de nou al nou host
 */
async function getOrRefreshToken(creds, forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && tokenCache && tokenCache.username === creds.username && tokenCache.token && now < tokenCache.expiresAt) {
        console.log(`🔑 Usant token en memòria cau per a ${creds.username} (expira en ${Math.round((tokenCache.expiresAt - now) / 60000)} min)`);
        return tokenCache.token;
    }

    console.log(`🌐 Sol·licitant nou token de 24h a ${BASE_URL}/token/ per a: ${creds.username}...`);
    const formData = new FormData();
    formData.append('username', creds.username);
    formData.append('password', creds.password);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
        const response = await fetch(`${BASE_URL}/token/`, {
            method: 'POST',
            body: formData,
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`Error sol·licitant token: HTTP ${response.status}`);
        }

        const data = await response.json();
        if (data.response_code !== 1 || !data.token) {
            throw new Error(data.error || 'Credencials no vàlides a Beta10');
        }

        tokenCache = {
            token: data.token,
            expiresAt: now + TOKEN_TTL_MS,
            username: creds.username
        };

        console.log(`✅ Nou token obtingut amb èxit (vigència 24h): ${data.token.substring(0, 15)}...`);
        return data.token;
    } catch (err) {
        clearTimeout(timeoutId);
        throw err;
    }
}

/**
 * Executa una crida JSON-RPC 2.0 a la nova API de Beta10
 */
async function jsonRpcCall(method, params, token) {
    const body = {
        jsonrpc: '2.0',
        id: 1,
        method: method,
        params: params
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
        const response = await fetch(`${BASE_URL}/api/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json;charset=UTF-8',
                'Accept': 'application/json',
                'Authorization': `Token ${token}`
            },
            body: JSON.stringify(body),
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (response.status === 401 || response.status === 403) {
            const err = new Error('SESSION_EXPIRED');
            err.statusCode = response.status;
            throw err;
        }

        if (!response.ok) {
            throw new Error(`Error HTTP en crida ${method}: ${response.status}`);
        }

        const data = await response.json();

        // Control d'errors a nivell JSON-RPC
        if (data.error) {
            const errMsg = data.error.message || JSON.stringify(data.error);
            const errData = data.error.data ? ` (${data.error.data})` : '';
            throw new Error(`${errMsg}${errData}`);
        }

        if (data.result && data.result.error) {
            throw new Error(data.result.error);
        }

        return data.result;
    } catch (err) {
        clearTimeout(timeoutId);
        throw err;
    }
}

/**
 * Resol l'ID d'empleat associat al nom d'usuari
 */
async function resolveEmployeeId(username, token) {
    if (employeeCache[username]) {
        return employeeCache[username];
    }

    console.log(`🔍 Resolent idempleado per a usuari: ${username}...`);
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
    if (!employeeId) {
        throw new Error(`L'usuari '${username}' no té cap idempleado associat`);
    }

    employeeCache[username] = employeeId;
    console.log(`✅ idempleado resolt: ${employeeId}`);
    return employeeId;
}

/**
 * Resol l'ID numèric del punt segons el seu codi ('J', 'P', '9')
 */
async function resolvePointId(pointCode, token) {
    const codeUpper = String(pointCode).trim().toUpperCase();
    if (pointCache[codeUpper]) {
        return pointCache[codeUpper];
    }

    console.log(`🔍 Resolent idpunto per a codi: '${codeUpper}'...`);
    const filter = {
        operator: 'AND',
        clauses: [
            { field: 'estado', operator: '>', value: 0, not: false },
            { field: 'codigo_scanner', operator: '=', value: codeUpper, not: false }
        ]
    };

    const result = await jsonRpcCall('punto.select', { filter }, token);
    if (!result || !result.dataset || result.dataset.length === 0) {
        // Fallback: si no es troba per scanner, provar per idpunto si ja fos numèric
        if (!isNaN(pointCode)) {
            pointCache[codeUpper] = Number(pointCode);
            return Number(pointCode);
        }
        throw new Error(`Punt de fitxatge '${pointCode}' no trobat al sistema`);
    }

    const pointId = result.dataset[0].idpunto;
    pointCache[codeUpper] = pointId;
    console.log(`✅ idpunto resolt per a '${codeUpper}': ${pointId}`);
    return pointId;
}

module.exports = async function handler(req, res) {
    // Headers CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.setHeader('Access-Control-Max-Age', '86400');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ 
            success: false, 
            error: 'Mètode no permès. Només POST.' 
        });
    }

    const timestamp = new Date().toISOString();
    const { action, point, location, observations, credentials } = req.body || {};

    if (!action || !point || !location?.latitude || !location?.longitude) {
        return res.status(400).json({ 
            success: false, 
            error: 'Dades requerides: action, point, location.latitude, location.longitude' 
        });
    }

    if (!['entrada', 'salida'].includes(action)) {
        return res.status(400).json({ 
            success: false, 
            error: 'Action ha de ser "entrada" o "salida"' 
        });
    }

    // 🔐 Resolució de credencials (1. Env xifrades, 2. Env planes, 3. Client)
    const activeCreds = resolveCredentials(credentials);
    if (!activeCreds || !activeCreds.username || !activeCreds.password) {
        return res.status(400).json({ 
            success: false, 
            error: 'Calen credencials d\'usuari (configurades a l\'entorn o enviades des del client).' 
        });
    }

    console.log(`🚀 [${timestamp}] Fitxatge ${action.toUpperCase()} (${point}) per a usuari '${activeCreds.username}' [font: ${activeCreds.source}]`);
    console.log(`📍 GPS: ${location.latitude}, ${location.longitude} | Obs: "${observations || ''}"`);

    try {
        let token = await getOrRefreshToken(activeCreds);
        let employeeId;
        let pointId;

        // Intent d'execució amb reintent automàtic si expira el token
        for (let attempt = 1; attempt <= 2; attempt++) {
            try {
                employeeId = await resolveEmployeeId(activeCreds.username, token);
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

                console.log(`🎉 Fitxatge ${action.toUpperCase()} (${point}) completat amb èxit!`);
                return res.status(200).json({
                    success: true,
                    action: action,
                    point: point,
                    message: `✅ ${action.toUpperCase()} registrada correctament en Beta10`,
                    observations: observations || null,
                    timestamp: new Date().toISOString(),
                    user: activeCreds.username,
                    result: rpcResult?.dataset?.[0] || null,
                    performance: {
                        platform: 'Vercel V12 - Token JSON-RPC',
                        authSource: activeCreds.source
                    }
                });

            } catch (err) {
                if (err.message === 'SESSION_EXPIRED' && attempt === 1) {
                    console.log('⚠️ Token caducat o rebutjat (401/403). Forçant renovació...');
                    token = await getOrRefreshToken(activeCreds, true);
                    continue; // Reintentar amb nou token
                }
                throw err;
            }
        }

    } catch (error) {
        console.error(`❌ Error en fitxatge: ${error.message}`);
        return res.status(500).json({
            success: false,
            error: error.message || 'Error processant el fitxatge a Beta10',
            timestamp: new Date().toISOString()
        });
    }
}
