// api/test-auth.js - Endpoint para probar credenciales

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
            error: 'Método no permitido. Solo POST.' 
        });
    }

    console.log("🔐 TEST AUTH: Probando credenciales de usuario");
    
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ 
            success: false, 
            error: 'Usuario y contraseña requeridos' 
        });
    }

    console.log(`🔐 Probando credenciales para usuario: ${username}`);
    
    try {
        // ✅ FUNCIÓN DE FETCH SIMPLE
        async function fetchBeta10(url, options = {}) {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 20000);
            
            try {
                const response = await fetch(url, {
                    ...options,
                    signal: controller.signal,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Accept': 'text/html,*/*',
                        ...options.headers
                    }
                });
                clearTimeout(timeoutId);
                return response;
            } catch (error) {
                clearTimeout(timeoutId);
                throw error;
            }
        }
        
        // ETAPA 1: CARGAR PÁGINA DE LOGIN
        console.log('🌐 Cargando página de login para test...');
        
        const baseUrl = 'https://9teknic.movilidadbeta10.es:9001/';
        const loginResponse = await fetchBeta10(baseUrl);
        
        if (!loginResponse.ok) {
            throw new Error(`Error accediendo a Beta10: HTTP ${loginResponse.status}`);
        }
        
        const loginHTML = await loginResponse.text();
        const initialCookies = loginResponse.headers.get('set-cookie') || '';
        
        // Extraer CSRF token
        const csrfMatch = loginHTML.match(/name=['"]csrfmiddlewaretoken['"][^>]*value=['"]([^'"]+)['"]/);
        const csrfToken = csrfMatch ? csrfMatch[1] : null;
        
        if (!csrfToken) {
            throw new Error('No se pudo obtener token CSRF');
        }
        
        console.log('✅ Token CSRF obtenido para test');
        
        // ETAPA 2: PROBAR LOGIN
        console.log('🔑 Probando login...');
        
        const loginData = new URLSearchParams({
            'csrfmiddlewaretoken': csrfToken,
            'username': username,
            'password': password
        });
        
        const authResponse = await fetchBeta10(baseUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Referer': baseUrl,
                'Origin': 'https://9teknic.movilidadbeta10.es:9001',
                'Cookie': initialCookies
            },
            body: loginData.toString(),
            redirect: 'manual'
        });
        
        const authStatus = authResponse.status;
        const authCookies = authResponse.headers.get('set-cookie');
        const authLocation = authResponse.headers.get('location');
        
        console.log(`📊 Test result: Status ${authStatus}, Cookies: ${authCookies ? 'SÍ' : 'NO'}, Redirect: ${authLocation || 'NINGUNO'}`);
        
        // Verificar si el login fue exitoso
        const isSuccess = authStatus === 302 && authCookies && authLocation && !authLocation.includes('login');
        
        if (isSuccess) {
            console.log('✅ Credenciales válidas');
            
            return res.status(200).json({
                success: true,
                message: 'Credenciales válidas',
                username: username,
                timestamp: new Date().toISOString()
            });
        } else {
            console.log('❌ Credenciales inválidas');
            
            // Determinar el tipo de error específico
            let errorMessage = 'Credenciales incorrectas';
            
            if (authStatus === 403) {
                errorMessage = 'Acceso denegado. Verifica tu usuario y contraseña.';
            } else if (authStatus === 500) {
                errorMessage = 'Error del servidor. Inténtalo más tarde.';
            } else if (!authCookies) {
                errorMessage = 'Usuario o contraseña incorrectos.';
            }
            
            return res.status(401).json({
                success: false,
                error: errorMessage,
                details: {
                    status: authStatus,
                    hasCookies: !!authCookies,
                    redirect: authLocation
                }
            });
        }

    } catch (error) {
        console.error('💥 ERROR en test de credenciales:', error.message);
        
        return res.status(500).json({
            success: false,
            error: 'Error de conexión con Beta10. Verifica tu internet.',
            details: error.message
        });
    }
}
