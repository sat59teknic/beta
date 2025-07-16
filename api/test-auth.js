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
        
        // Test ràpid de login a Beta10 amb més debugging
        const baseUrl = 'https://9teknic.movilidadbeta10.es:9001/';
        
        console.log('🌐 Carregant pàgina de login...');
        
        // Carregar pàgina de login
        const loginResponse = await fetch(baseUrl, {
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
                'Accept-Encoding': 'gzip, deflate, br',
                'DNT': '1',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1'
            }
        });
        
        if (!loginResponse.ok) {
        console.error(`❌ Error carregant Beta10: HTTP ${loginResponse.status}`);
            throw new Error(`Error carregant Beta10: HTTP ${loginResponse.status}`);
        }
        
        // Obtenir cookies de la resposta inicial
        const setCookieHeaders = loginResponse.headers.get('set-cookie');
        let sessionCookies = '';
        if (setCookieHeaders) {
            sessionCookies = setCookieHeaders.split(',').map(cookie => cookie.split(';')[0]).join('; ');
            console.log('🍪 Cookies obtingudes:', sessionCookies.substring(0, 100) + '...');
        }
        
        const loginHTML = await loginResponse.text();
        console.log('📄 HTML rebut:', loginHTML.length, 'chars');
        
        // Extreure token CSRF amb més patrons
        let csrfToken = null;
        const csrfPatterns = [
            /name=['"]csrfmiddlewaretoken['"][^>]*value=['"]([^'"]+)['"]/,
            /value=['"]([^'"]+)['"][^>]*name=['"]csrfmiddlewaretoken['"]/,
            /<input[^>]*csrfmiddlewaretoken[^>]*value=['"]([^'"]+)['"]/
        ];
        
        for (const pattern of csrfPatterns) {
            const match = loginHTML.match(pattern);
            if (match) {
                csrfToken = match[1];
                break;
            }
        }
        
        if (!csrfToken) {
            console.error('❌ Token CSRF no trobat al HTML');
            console.log('🔍 Inici HTML:', loginHTML.substring(0, 500));
            throw new Error('Token CSRF no trobat');
        }
        
        console.log('✅ Token CSRF trobat:', csrfToken.substring(0, 10) + '...');
        
        // Fer login de prova amb totes les cookies i headers
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
                'Origin': 'https://9teknic.movilidadbeta10.es:9001',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
                'Accept-Encoding': 'gzip, deflate, br',
                'DNT': '1',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
                'Cookie': sessionCookies
            },
            body: loginData.toString(),
            redirect: 'manual'
        });
        
        const authStatus = authResponse.status;
        const authLocation = authResponse.headers.get('location');
        
        console.log('📊 Resultat login:');
        console.log('  Status:', authStatus);
        console.log('  Location:', authLocation);
        
        // Verificar èxit del login amb més validacions
        let loginSuccess = false;
        
        if (authStatus === 302) {
            // Redirect positiu - verificar que no sigui de vuelta al login
            if (authLocation && !authLocation.includes('/login') && authLocation !== baseUrl) {
                loginSuccess = true;
                console.log('✅ Login exitoso - redirect vàlid');
            } else {
                console.log('❌ Login fallit - redirect a login');
            }
        } else if (authStatus === 200) {
            // Potser és successful sense redirect - verificar contingut
            const authHTML = await authResponse.text();
            if (!authHTML.includes('username') || !authHTML.includes('password')) {
                loginSuccess = true;
                console.log('✅ Login exitoso - sense redirect');
            } else {
                console.log('❌ Login fallit - encara mostra formulari');
            }
        }
        
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
