// api/test-auth.js - Test de credencials amb el nou endpoint de tokens
const { resolveCredentials } = require('./crypto-helper');

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

    try {
        const bodyCreds = req.body || {};
        const creds = resolveCredentials(bodyCreds.username ? bodyCreds : null);

        if (!creds || !creds.username || !creds.password) {
            return res.status(400).json({ 
                success: false, 
                error: 'Usuari i contrasenya requerits (ni al cos ni a les variables d\'entorn)' 
            });
        }

        console.log(`🔐 Validant credencials per usuari: ${creds.username} (font: ${creds.source || 'manual'})`);
        
        // Peticio al nou endpoint /token/
        const tokenUrl = 'https://9teknic.movbeta10.es:9000/token/';
        const formData = new FormData();
        formData.append('username', creds.username);
        formData.append('password', creds.password);

        const tokenResponse = await fetch(tokenUrl, {
            method: 'POST',
            body: formData
        });

        if (!tokenResponse.ok) {
            throw new Error(`Error en servidor Beta10: HTTP ${tokenResponse.status}`);
        }

        const data = await tokenResponse.json();

        // Codis de resposta Beta10: 1 = loginOk, 0 = error, 2 = sesionTemp (2FA)
        if (data.response_code === 1 && data.token) {
            console.log(`✅ Credencials vàlides per a ${creds.username}`);
            return res.status(200).json({
                success: true,
                message: 'Credencials vàlides',
                username: creds.username,
                source: creds.source || 'client'
            });
        } else if (data.response_code === 2) {
            return res.status(200).json({
                success: false,
                requires2FA: true,
                message: 'Aquest compte requereix autenticació de doble factor (2FA)',
                username: creds.username
            });
        } else {
            console.log(`❌ Credencials incorrectes per a ${creds.username}`);
            return res.status(401).json({
                success: false,
                error: data.error || 'Credencials incorrectes a Beta10'
            });
        }
        
    } catch (error) {
        console.error(`💥 Error test credencials: ${error.message}`);
        return res.status(500).json({
            success: false,
            error: 'Error de connexió amb Beta10',
            details: error.message
        });
    }
}
