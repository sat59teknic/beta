// api/beta10.js - FITXATGE AMB COOKIES PERSISTENTS V7

module.exports = async function handler(req, res) {
    // Headers CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
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
    console.log(`🚀 COOKIES PERSISTENTS V7 - ${timestamp}: Mantenint sessió`);
    
    const { action, point, location, observations, credentials } = req.body;

    if (!action || !point || !location?.latitude || !location?.longitude) {
        return res.status(400).json({ 
            success: false, 
            error: 'Dades requerides: action, point, location.latitude, location.longitude' 
        });
    }

    if (!credentials || !credentials.username || !credentials.password) {
        return res.status(400).json({ 
            success: false, 
            error: 'Credencials d\'usuari requerides. Inicia sessió.' 
        });
    }

    if (!['entrada', 'salida'].includes(action)) {
        return res.status(400).json({ 
            success: false, 
            error: 'Action ha de ser "entrada" o "salida"' 
        });
    }

    console.log(`⚡ V7 - Executant ${action.toUpperCase()} per punt: ${point}`);
    console.log(`👤 V7 - Usuari: ${credentials.username}`);
    console.log(`📍 V7 - GPS: ${location.latitude}, ${location.longitude}`);
        
        try {
        // ✅ GESTOR DE COOKIES MEJORADO
        let sessionCookies = '';
        
        function updateCookies(response) {
            const newCookies = response.headers.get('set-cookie');
            if (newCookies) {
                // Combinar cookies existentes con nuevas
                const existingCookieNames = sessionCookies.split(';').map(cookie => cookie.split('=')[0].trim());
                const newCookieEntries = newCookies.split(',').map(cookie => cookie.trim());
                
                const combinedCookies = [...newCookieEntries];
                
                // Agregar cookies existentes que no fueron reemplazadas
                sessionCookies.split(';').forEach(existingCookie => {
                    const cookieName = existingCookie.split('=')[0].trim();
                    if (!newCookieEntries.some(newCookie => newCookie.startsWith(cookieName + '='))) {
                        combinedCookies.push(existingCookie.trim());
                    }
                });
                
                sessionCookies = combinedCookies.join('; ');
                console.log(`🍪 V7 - Cookies actualizadas: ${sessionCookies.substring(0, 100)}...`);
            }
            return sessionCookies;
        }
        
        // ✅ FUNCIÓN DE FETCH CON GESTIÓN DE COOKIES
        async function fetchBeta10(url, options = {}) {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000);
            
            try {
                console.log(`🌐 V7 - Fetch: ${url} con cookies: ${sessionCookies ? 'SÍ' : 'NO'}`);
                
                const response = await fetch(url, {
                    ...options,
                    signal: controller.signal,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
                        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
                        'Accept-Encoding': 'gzip, deflate, br',
                        'DNT': '1',
                        'Connection': 'keep-alive',
                        'Upgrade-Insecure-Requests': '1',
                        'Sec-Fetch-Dest': 'document',
                        'Sec-Fetch-Mode': 'navigate',
                        'Sec-Fetch-Site': 'same-origin',
                        'Cache-Control': 'max-age=0',
                        'Cookie': sessionCookies,
                        ...options.headers
                    }
                });
                
                clearTimeout(timeoutId);
                console.log(`📊 V7 - Response: ${response.status} ${response.statusText}`);
                
                // Actualizar cookies automáticamente
                updateCookies(response);
                
                return response;
            } catch (error) {
                clearTimeout(timeoutId);
                throw error;
            }
        }
        
        // ETAPA 1: LOGIN AMB COOKIES INICIALS
        console.log('🔐 V7 - ETAPA 1: Login amb gestió de cookies...');
        
        const baseUrl = 'https://9teknic.movilidadbeta10.es:9001/';
        const loginResponse = await fetchBeta10(baseUrl);
        
        if (!loginResponse.ok) {
            throw new Error(`Error cargando login: HTTP ${loginResponse.status}`);
        }
        
        const loginHTML = await loginResponse.text();
        
        // Extraer CSRF token
        const csrfMatch = loginHTML.match(/name=['"]csrfmiddlewaretoken['"][^>]*value=['"]([^'"]+)['"]/);
        const csrfToken = csrfMatch ? csrfMatch[1] : null;
        
        if (!csrfToken) {
            throw new Error('Token CSRF no encontrado');
        }
        
        console.log(`✅ V7 - Token CSRF: ${csrfToken.substring(0, 15)}...`);
        
        // 🔐 USAR CREDENCIALES DINÁMICAS DEL USUARIO
        console.log(`🔑 V7 - Haciendo login con usuario: ${credentials.username}`);
        
        const loginData = new URLSearchParams({
            'csrfmiddlewaretoken': csrfToken,
            'username': credentials.username,
            'password': credentials.password
        });
        
        const authResponse = await fetchBeta10(baseUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Referer': baseUrl,
                'Origin': 'https://9teknic.movilidadbeta10.es:9001'
            },
            body: loginData.toString(),
            redirect: 'manual'
        });
        
        const authStatus = authResponse.status;
        const authLocation = authResponse.headers.get('location');
        
        console.log(`📊 V7 - Login result: Status ${authStatus}, Redirect: ${authLocation}`);
        console.log(`🍪 V7 - Cookies después del login: ${sessionCookies.substring(0, 100)}...`);
        
        if (authStatus !== 302) {
            throw new Error(`Login falló: Status ${authStatus}`);
        }
        
        console.log('✅ V7 - Login exitoso');
        
        // ETAPA 2: SEGUIR REDIRECT SI ES NECESARIO
        console.log('🔄 V7 - ETAPA 2: Siguiendo redirect de login...');
        
        if (authLocation && authLocation !== '/inicio/') {
            console.log(`🔄 V7 - Siguiendo redirect a: ${authLocation}`);
            
            const redirectUrl = authLocation.startsWith('/') ? `${baseUrl.slice(0, -1)}${authLocation}` : authLocation;
            const redirectResponse = await fetchBeta10(redirectUrl);
            
            if (!redirectResponse.ok) {
                throw new Error(`Error siguiendo redirect: HTTP ${redirectResponse.status}`);
            }
            
            console.log('✅ V7 - Redirect seguido correctamente');
        }
        
        // ETAPA 3: ACCEDER AL FORMULARIO DE FICHAJE
        console.log('📋 V7 - ETAPA 3: Accediendo al formulario de fichaje...');
        
        const fichajeUrl = `${baseUrl}presencia/${action}/`;
        const fichajeResponse = await fetchBeta10(fichajeUrl, {
            headers: {
                'Referer': baseUrl
            }
        });
        
        if (!fichajeResponse.ok) {
            throw new Error(`Error cargando formulario: HTTP ${fichajeResponse.status}`);
        }
        
        const fichajeHTML = await fichajeResponse.text();
        
        console.log(`📄 V7 - Formulario cargado: ${fichajeHTML.length} chars`);
        
        // Verificar que NO estamos en login
        if (fichajeHTML.includes('username') && fichajeHTML.includes('password')) {
            throw new Error('Sesión inválida - redirigido a login');
        }
        
        // Verificar que tenemos el formulario correcto
        if (!fichajeHTML.includes('presencia') && !fichajeHTML.includes('fichaje') && !fichajeHTML.includes('punto')) {
            console.log(`⚠️ V7 - HTML del formulario: ${fichajeHTML.substring(0, 500)}...`);
            throw new Error('Formulario de fichaje no encontrado - contenido inesperado');
        }
        
        console.log('✅ V7 - Formulario de fichaje cargado correctamente');
        
        // ETAPA 4: ANALIZAR Y ENVIAR FORMULARIO
        console.log('🔍 V7 - ETAPA 4: Analizando y enviando formulario...');
        
        // Extraer CSRF del formulario
        const formCsrfMatch = fichajeHTML.match(/name=['"]csrfmiddlewaretoken['"][^>]*value=['"]([^'"]+)['"]/);
        const formCsrfToken = formCsrfMatch ? formCsrfMatch[1] : '';
        
        if (!formCsrfToken) {
            throw new Error('Token CSRF no encontrado en formulario de fichaje');
        }
        
        // Buscar campos
        const allInputs = [...fichajeHTML.matchAll(/<input[^>]*name=['"]([^'"]+)['"][^>]*>/gi)];
        const inputNames = allInputs.map(match => {
            const fullTag = match[0];
            const name = match[1];
            const typeMatch = fullTag.match(/type=['"]([^'"]+)['"]/);
            
            return { name, type: typeMatch ? typeMatch[1] : 'text' };
        });
        
        const textareas = [...fichajeHTML.matchAll(/<textarea[^>]*name=['"]([^'"]+)['"][^>]*>/gi)];
        const textareaNames = textareas.map(match => ({ name: match[1], type: 'textarea' }));
        
        const allFields = [...inputNames, ...textareaNames];
        
        console.log(`📊 V7 - Campos encontrados: ${allFields.length}`);
        allFields.forEach(field => {
            console.log(`  - ${field.name} (${field.type})`);
        });
        
        // Identificar campos específicos
        const pointField = allFields.find(field => 
            field.name.includes('punto') || 
            field.name === `punto_${action}` ||
            field.name === 'punto'
        );
        
        const obsField = allFields.find(field => 
            field.name.includes('observ') || 
            field.name === `observaciones_${action}` ||
            field.name === 'observaciones'
        );
        
        const latField = allFields.find(field => 
            field.name.includes('lat') ||
            field.name === `latitud_${action}` ||
            field.name === 'latitud'
        );
        
        const lonField = allFields.find(field => 
            field.name.includes('lon') ||
            field.name === `longitud_${action}` ||
            field.name === 'longitud'
        );
        
        console.log(`🎯 V7 - Campos identificados:`);
        console.log(`  Punto: ${pointField ? pointField.name : 'NO ENCONTRADO'}`);
        console.log(`  Observaciones: ${obsField ? obsField.name : 'NO ENCONTRADO'}`);
        console.log(`  Latitud: ${latField ? latField.name : 'NO ENCONTRADO'}`);
        console.log(`  Longitud: ${lonField ? lonField.name : 'NO ENCONTRADO'}`);
        
        if (!pointField) {
            throw new Error('Campo "punto" no encontrado en el formulario');
        }
        
        // Preparar datos de fichaje
        const fichajeData = new URLSearchParams();
        fichajeData.append('csrfmiddlewaretoken', formCsrfToken);
        fichajeData.append(pointField.name, point);
        
        if (obsField) {
            fichajeData.append(obsField.name, observations || '');
        }
        
        if (latField) {
            fichajeData.append(latField.name, location.latitude.toString());
        }
        
        if (lonField) {
            fichajeData.append(lonField.name, location.longitude.toString());
        }
        
        console.log(`📤 V7 - Enviando fichaje con datos:`);
        console.log(`  - ${pointField.name}: ${point}`);
        if (obsField) console.log(`  - ${obsField.name}: "${observations || ''}"`);
        if (latField) console.log(`  - ${latField.name}: ${location.latitude}`);
        if (lonField) console.log(`  - ${lonField.name}: ${location.longitude}`);
        
        const submitResponse = await fetchBeta10(fichajeUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Referer': fichajeUrl,
                'Origin': 'https://9teknic.movilidadbeta10.es:9001'
            },
            body: fichajeData.toString(),
            redirect: 'manual'
        });
        
        // ETAPA 5: VERIFICAR RESULTADO
        console.log('🔍 V7 - ETAPA 5: Verificando resultado...');
        
        const resultStatus = submitResponse.status;
        const resultLocation = submitResponse.headers.get('location');
        let resultText = '';
        
        if (resultStatus === 200) {
            resultText = await submitResponse.text();
        }
        
        console.log(`📊 V7 - Resultado final:`);
        console.log(`  Status: ${resultStatus}`);
        console.log(`  Redirect: ${resultLocation || 'NINGUNO'}`);
        console.log(`  Contiene errores: ${resultText.includes('error') ? 'SÍ' : 'NO'}`);
        
        const isSuccess = (resultStatus === 302 && resultLocation && !resultLocation.includes(`/presencia/${action}/`)) ||
                         (resultStatus === 200 && !resultText.includes('error'));
        
        if (isSuccess) {
            console.log('🎉 V7 - FICHAJE REGISTRADO EXITOSAMENTE EN BETA10');
            
            return res.status(200).json({
                success: true,
                action: action,
                point: point,
                message: `✅ ${action.toUpperCase()} registrada correctamente en Beta10`,
                observations: observations || null,
                timestamp: new Date().toISOString(),
                performance: {
                    platform: 'Vercel V7 - Cookies persistentes',
                    cookieManagement: 'Automático',
                    fieldsUsed: {
                        point: pointField.name,
                        observations: obsField ? obsField.name : null,
                        latitude: latField ? latField.name : null,
                        longitude: lonField ? lonField.name : null
                    },
                    resultStatus: resultStatus,
                    resultRedirect: resultLocation
                }
            });
        } else {
            throw new Error(`Fichaje falló: Status ${resultStatus}, ${resultText.includes('error') ? 'contiene errores' : 'resultado inesperado'}`);
        }

    } catch (error) {
        console.error(`💥 V7 - ERROR: ${error.message}`);
        
        return res.status(500).json({
            success: false,
            error: error.message,
            version: 'V7 - Cookies persistentes',
            action: action || 'unknown',
            timestamp: new Date().toISOString()
        });
    }
}
