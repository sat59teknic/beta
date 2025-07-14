// api/beta10.js - OPTIMIZADO PARA RAILWAY

const puppeteer = require('puppeteer');

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
            error: 'Método no permitido. Solo POST.' 
        });
    }

    console.log("🚂 RAILWAY: Iniciando fichaje Beta10");
    
    const { action, point, location, observations } = req.body;

    // Validación rápida
    if (!action || !point || !location?.latitude || !location?.longitude) {
        return res.status(400).json({ 
            success: false, 
            error: 'Datos requeridos: action, point, location.latitude, location.longitude' 
        });
    }

    if (!['entrada', 'salida'].includes(action)) {
        return res.status(400).json({ 
            success: false, 
            error: 'Action debe ser "entrada" o "salida"' 
        });
    }

    console.log(`⚡ Procesando ${action.toUpperCase()} → punto: ${point}`);
    console.log(`📍 GPS: ${location.latitude}, ${location.longitude}`);
    
    let browser = null;
    
    try {
        console.log('🚂 Lanzando Puppeteer en Railway...');
        
        // ✅ CONFIGURACIÓN SIMPLE PARA RAILWAY
        browser = await puppeteer.launch({
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--no-first-run',
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-renderer-backgrounding'
            ],
            defaultViewport: { width: 1280, height: 720 },
            timeout: 30000
        });

        console.log('✅ Navegador Railway lanzado correctamente');

        const page = await browser.newPage();

        // 🎯 CONFIGURAR MOCK GPS
        console.log('📡 Configurando GPS mock...');
        
        await page.setGeolocation({
            latitude: location.latitude,
            longitude: location.longitude,
            accuracy: location.accuracy || 100
        });

        // Permitir geolocalización
        const context = browser.defaultBrowserContext();
        await context.overridePermissions('https://9teknic.movilidadbeta10.es:9001', ['geolocation']);

        // Mock de geolocalización
        await page.evaluateOnNewDocument((lat, lon, acc) => {
            Object.defineProperty(navigator, 'geolocation', {
                value: {
                    getCurrentPosition: (success, error, options) => {
                        console.log('🎯 GPS Mock activado');
                        setTimeout(() => {
                            success({
                                coords: {
                                    latitude: lat,
                                    longitude: lon,
                                    accuracy: acc,
                                    altitude: null,
                                    altitudeAccuracy: null,
                                    heading: null,
                                    speed: null
                                },
                                timestamp: Date.now()
                            });
                        }, 100);
                    },
                    watchPosition: (success) => {
                        return 1;
                    },
                    clearWatch: () => {}
                },
                configurable: true
            });
        }, location.latitude, location.longitude, location.accuracy || 100);

        // Configurar página
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
        
        const BASE_URL = 'https://9teknic.movilidadbeta10.es:9001';
        const presenciaUrl = `${BASE_URL}/presencia/${action}/`;
        
        console.log(`🌐 Navegando a ${presenciaUrl}`);
        await page.goto(presenciaUrl, { 
            waitUntil: 'networkidle2',
            timeout: 30000 
        });

        // ✅ MANEJO DE LOGIN
        const needsLogin = await page.$('#username');
        if (needsLogin) {
            console.log('🔐 Login requerido...');
            
            if (!process.env.BETA10_USERNAME || !process.env.BETA10_PASSWORD) {
                throw new Error('❌ Variables de entorno no configuradas');
            }
            
            await page.click('#username', { clickCount: 3 });
            await page.type('#username', process.env.BETA10_USERNAME, { delay: 50 });
            
            await page.click('#password', { clickCount: 3 });
            await page.type('#password', process.env.BETA10_PASSWORD, { delay: 50 });
            
            await Promise.all([
                page.click('input[type="submit"]'),
                page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 })
            ]);
            
            if (page.url().includes('login')) {
                throw new Error('❌ Login falló - credenciales incorrectas');
            }
            
            console.log('✅ Login exitoso');
            await page.goto(presenciaUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        }

        // 📋 BÚSQUEDA DEL FORMULARIO
        console.log('🔍 Buscando formulario...');
        
        const dialogSelectors = [
            'div[role="dialog"]',
            '.ui-dialog',
            '[data-role="dialog"]',
            'dialog',
            '.modal'
        ];
        
        let dialogFound = false;
        for (const selector of dialogSelectors) {
            try {
                await page.waitForSelector(selector, { visible: true, timeout: 5000 });
                console.log(`✅ Formulario encontrado: ${selector}`);
                dialogFound = true;
                break;
            } catch (e) {
                continue;
            }
        }
        
        if (!dialogFound) {
            throw new Error('❌ Formulario de fichaje no encontrado');
        }

        // 📝 RELLENAR FORMULARIO
        console.log('⚡ Rellenando formulario...');
        
        const formData = await page.evaluate((action, point, observations, lat, lon) => {
            const dialog = document.querySelector('div[role="dialog"], .ui-dialog, [data-role="dialog"]');
            if (!dialog) return null;
            
            // Detectar campos
            const pointField = action === 'entrada' ? 
                dialog.querySelector('#id_punto_entrada') : 
                dialog.querySelector('#id_punto_salida');
                
            const obsField = action === 'entrada' ? 
                dialog.querySelector('#id_observaciones_entrada') : 
                dialog.querySelector('#id_observaciones_salida');
                
            const latField = action === 'entrada' ? 
                dialog.querySelector('#id_latitud_entrada') : 
                dialog.querySelector('#id_latitud_salida');
                
            const lonField = action === 'entrada' ? 
                dialog.querySelector('#id_longitud_entrada') : 
                dialog.querySelector('#id_longitud_salida');
            
            // Rellenar campos
            if (pointField) {
                pointField.value = point;
                pointField.dispatchEvent(new Event('change', { bubbles: true }));
            }
            
            if (obsField) {
                obsField.value = observations || '';
                obsField.dispatchEvent(new Event('change', { bubbles: true }));
            }
            
            if (latField) latField.value = lat.toString();
            if (lonField) lonField.value = lon.toString();
            
            return {
                pointFieldFound: !!pointField,
                obsFieldFound: !!obsField,
                coordsSet: !!(latField && lonField)
            };
        }, action, point, observations || '', location.latitude, location.longitude);

        if (!formData?.pointFieldFound) {
            throw new Error('❌ Campos del formulario no encontrados');
        }

        console.log('✅ Formulario rellenado correctamente');

        // 🚀 ENVÍO
        console.log('📤 Enviando formulario...');
        
        const submitSelectors = [
            '#submit-presencia',
            'input[type="submit"]',
            'button[type="submit"]',
            '.ui-btn[data-theme="b"]',
            'a[data-role="button"]'
        ];
        
        let submitted = false;
        for (const selector of submitSelectors) {
            try {
                const button = await page.$(selector);
                if (button) {
                    console.log(`🎯 Enviando con: ${selector}`);
                    
                    try {
                        await Promise.all([
                            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }),
                            button.click()
                        ]);
                    } catch (navError) {
                        await page.evaluate((sel) => {
                            document.querySelector(sel)?.click();
                        }, selector);
                        await page.waitForTimeout(3000);
                    }
                    
                    submitted = true;
                    break;
                }
            } catch (e) {
                continue;
            }
        }
        
        if (!submitted) {
            throw new Error('❌ No se pudo enviar el formulario');
        }

        // ✅ VERIFICACIÓN DE ÉXITO
        const currentUrl = page.url();
        console.log(`📊 URL final: ${currentUrl}`);
        
        const isSuccess = !currentUrl.includes(`/presencia/${action}/`) || 
                         (currentUrl.includes('/presencia/') && !currentUrl.endsWith(`${action}/`));
        
        if (isSuccess) {
            console.log('🎉 FICHAJE EXITOSO');
            
            return res.status(200).json({
                success: true,
                action: action,
                point: point,
                message: `✅ ${action.toUpperCase()} registrada correctamente en Beta10`,
                observations: observations || null,
                timestamp: new Date().toISOString(),
                performance: {
                    platform: 'Railway',
                    region: process.env.RAILWAY_ENVIRONMENT || 'unknown'
                }
            });
        } else {
            throw new Error('❌ El formulario no se procesó correctamente');
        }

    } catch (error) {
        console.error('💥 ERROR:', error.message);
        
        return res.status(500).json({
            success: false,
            error: error.message,
            action: action || 'unknown',
            point: point || 'unknown',
            timestamp: new Date().toISOString()
        });
        
    } finally {
        if (browser) {
            console.log('🔧 Cerrando navegador...');
            try {
                await browser.close();
            } catch (closeError) {
                console.log('⚠️ Error cerrando navegador:', closeError.message);
            }
        }
        console.log('✅ Proceso completado');
    }
}
