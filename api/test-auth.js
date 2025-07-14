// api/test-auth.js - Test de credencials per validació

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
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ 
                success: false, 
                error: 'Usuari i contrasenya requerits' 
            });
        }

        console.log(`🔐 Test credencials per usuari: ${username}`);
        
        // Test ràpid de login a Beta10
        const baseUrl = 'https://9teknic.movilidadbeta10.es:9001/';
        
        // Carregar pàgina de login
        const loginResponse = await fetch(baseUrl, {
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        
        if (!loginResponse.ok) {
            throw new Error(`Error carregant Beta10: HTTP ${loginResponse.status}`);
        }
        
        const loginHTML = await loginResponse.text();
        
        // Extreure token CSRF
        const csrfMatch = loginHTML.match(/name=['"]csrfmiddlewaretoken['"][^>]*value=['"]([^'"]+)['"]/);
        const csrfToken = csrfMatch ? csrfMatch[1] : null;
        
        if (!csrfToken) {
            throw new Error('Token CSRF no trobat');
        }
        
        // Fer login de prova
        const loginData = new URLSearchParams({
            'csrfmiddlewaretoken': csrfToken,
            'username': username,
            'password': password
        });
        
        const authResponse = await fetch(baseUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Referer': baseUrl,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            body: loginData.toString(),
            redirect: 'manual'
        });
        
        const authStatus = authResponse.status;
        const authLocation = authResponse.headers.get('location');
        
        // Verificar èxit del login
        const loginSuccess = authStatus === 302 && authLocation && authLocation !== baseUrl;
        
        if (loginSuccess) {
            console.log(`✅ Test login exitós per: ${username}`);
            return res.status(200).json({
                success: true,
                message: 'Credencials vàlides',
                username: username
            });
        } else {
            console.log(`❌ Test login fallit per: ${username}`);
            return res.status(401).json({
                success: false,
                error: 'Credencials incorrectes'
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
