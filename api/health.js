// api/health.js - Health check per verificar connectivitat i estat de configuració
const { resolveCredentials } = require('./crypto-helper');

module.exports = async function handler(req, res) {
    // Headers CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        const timestamp = new Date().toISOString();
        const serverCreds = resolveCredentials();
        
        // Comprovar connectivitat amb el nou host
        let hostReachable = false;
        let hostStatus = null;
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            const response = await fetch('https://9teknic.movbeta10.es:9000/token/', {
                method: 'GET',
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            hostReachable = response.status === 405 || response.ok || response.status === 200;
            hostStatus = response.status;
        } catch (e) {
            hostReachable = false;
            hostStatus = e.message;
        }
        
        return res.status(200).json({
            success: true,
            message: 'Backend Beta10 operatiu',
            timestamp: timestamp,
            version: 'V12 JSON-RPC Token',
            targetHost: 'https://9teknic.movbeta10.es:9000',
            hostReachable: hostReachable,
            hostStatus: hostStatus,
            hasServerCredentials: !!serverCreds,
            credentialsSource: serverCreds ? serverCreds.source : null,
            status: 'healthy'
        });
        
    } catch (error) {
        return res.status(500).json({
            success: false,
            error: 'Error intern del servidor',
            details: error.message,
            timestamp: new Date().toISOString()
        });
    }
}
