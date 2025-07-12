// Cloudflare Worker - Beta10 Control

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    // Servir archivos estáticos
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return new Response(HTML_CONTENT, {
        headers: { 'Content-Type': 'text/html' }
      });
    }
    
    if (url.pathname === '/style.css') {
      return new Response(CSS_CONTENT, {
        headers: { 'Content-Type': 'text/css' }
      });
    }
    
    if (url.pathname === '/script.js') {
      return new Response(JS_CONTENT, {
        headers: { 'Content-Type': 'application/javascript' }
      });
    }
    
    if (url.pathname === '/manifest.json') {
      return new Response(MANIFEST_CONTENT, {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    if (url.pathname === '/service-worker.js') {
      return new Response(SW_CONTENT, {
        headers: { 'Content-Type': 'application/javascript' }
      });
    }

    // API endpoint
    if (url.pathname === '/api/beta10' && request.method === 'POST') {
      return handleBeta10API(request, env);
    }

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        }
      });
    }

    return new Response('Not Found', { status: 404 });
  }
};

async function handleBeta10API(request, env) {
  try {
    const { action, point, location, observations } = await request.json();
    
    // Validación
    if (!action || !point || !location) {
      return jsonResponse({ error: 'Datos incompletos' }, 400);
    }

    // Obtener sesión
    const sessionCookie = await getOrCreateSession(env);
    
    // Obtener CSRF token
    const csrfToken = await getCSRFToken(sessionCookie);
    
    // Hacer el fichaje
    const formData = new URLSearchParams({
      [`punto_${action}`]: point,
      [`observaciones_${action}`]: observations || '',
      [`latitud_${action}`]: location.latitude.toString(),
      [`longitud_${action}`]: location.longitude.toString(),
      'csrfmiddlewaretoken': csrfToken,
      'submit-presencia': 'Enviar',
    });

    const response = await fetch(`https://9teknic.movilidadbeta10.es:9001/presencia/${action}/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': sessionCookie,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://9teknic.movilidadbeta10.es:9001/presencia/',
      },
      body: formData
    });

    const responseText = await response.text();
    
    if (response.ok && !responseText.includes('error')) {
      return jsonResponse({
        success: true,
        message: `${action} registrada correctamente`,
        timestamp: new Date().toISOString()
      });
    } else {
      throw new Error('Error en el registro');
    }
  } catch (error) {
    return jsonResponse({
      success: false,
      error: error.message
    }, 500);
  }
}

async function getOrCreateSession(env) {
  // Intentar obtener de KV storage
  const cached = await env.BETA10_KV.get('session', { type: 'json' });
  
  if (cached && Date.now() - cached.timestamp < 3600000) {
    return cached.cookie;
  }

  // Crear nueva sesión
  const loginResponse = await fetch('https://9teknic.movilidadbeta10.es:9001/accounts/login/', {
    method: 'GET',
    redirect: 'manual'
  });

  const loginHtml = await loginResponse.text();
  const csrfMatch = loginHtml.match(/csrfmiddlewaretoken['"]\s*value=['"]([^'"]+)/);
  const csrfToken = csrfMatch ? csrfMatch[1] : '';

  // Login
  const authResponse = await fetch('https://9teknic.movilidadbeta10.es:9001/accounts/login/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': loginResponse.headers.get('set-cookie') || ''
    },
    body: new URLSearchParams({
      username: env.BETA10_USERNAME,
      password: env.BETA10_PASSWORD,
      csrfmiddlewaretoken: csrfToken
    }),
    redirect: 'manual'
  });

  const sessionCookie = authResponse.headers.get('set-cookie') || '';
  
  // Guardar en KV
  await env.BETA10_KV.put('session', JSON.stringify({
    cookie: sessionCookie,
    timestamp: Date.now()
  }), { expirationTtl: 3600 });

  return sessionCookie;
}

async function getCSRFToken(sessionCookie) {
  const response = await fetch('https://9teknic.movilidadbeta10.es:9001/presencia/', {
    headers: { 'Cookie': sessionCookie }
  });

  const html = await response.text();
  const match = html.match(/csrfmiddlewaretoken['"]\s*value=['"]([^'"]+)/);
  return match ? match[1] : '';
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

// Contenido de los archivos estáticos
const HTML_CONTENT = `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
    <title>Beta10 Control - CF</title>
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="theme-color" content="#007aff">
    <link rel="manifest" href="/manifest.json">
    <link rel="stylesheet" href="/style.css">
    <script src="/script.js" defer></script>
</head>
<body>
    <div class="container">
        <header class="header">
            <div class="status-container">
                <div id="connection-status" class="status-indicator"></div>
                <span>Conexión</span>
            </div>
            <h1>Beta10 Control</h1>
            <div class="status-container">
                <div id="gps-status" class="status-indicator"></div>
                <span>GPS</span>
            </div>
        </header>
        <main>
            <div class="status-card">
                <p>Estado Actual</p>
                <h2 id="current-state">Fuera de Jornada</h2>
            </div>
            <div class="timer-card">
                <div class="timer">
                    <span>Jornada</span>
                    <p id="work-timer">00:00:00</p>
                </div>
                <div class="timer">
                    <span>Pausa</span>
                    <p id="pause-timer">00:00:00</p>
                </div>
            </div>
            <div id="info-message" class="info-message"></div>
            <div id="button-container" class="button-container"></div>
            <div class="log-card">
                <h3>Registro de Actividad</h3>
                <div id="log-container"></div>
            </div>
        </main>
    </div>
    <div id="loading-overlay" class="loading-overlay">
        <div class="spinner"></div>
        <p id="loading-text">Procesando...</p>
    </div>
</body>
</html>`;

const CSS_CONTENT = `:root{--primary:#007aff;--success:#34c759;--warning:#ff9500;--danger:#ff3b30;--bg:#f2f2f7;--card-bg:#fff;--text:#1c1e21;--text-secondary:#8e8e93;--border:#e5e5ea}*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:var(--bg);color:var(--text);line-height:1.6;-webkit-tap-highlight-color:transparent}.container{max-width:480px;margin:0 auto;padding:20px;min-height:100vh}.header{display:flex;justify-content:space-between;align-items:center;margin-bottom:30px}.header h1{font-size:24px;font-weight:600}.status-container{display:flex;flex-direction:column;align-items:center;gap:5px}.status-container span{font-size:12px;color:var(--text-secondary)}.status-indicator{width:12px;height:12px;border-radius:50%;background:var(--border);transition:all .3s ease}.status-indicator.green{background:var(--success);box-shadow:0 0 10px rgba(52,199,89,.3)}.status-indicator.yellow{background:var(--warning);animation:pulse 1s infinite}.status-indicator.red{background:var(--danger)}@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}.status-card{background:var(--card-bg);border-radius:16px;padding:20px;margin-bottom:20px;box-shadow:0 2px 10px rgba(0,0,0,.05);text-align:center}.status-card p{color:var(--text-secondary);font-size:14px;margin-bottom:5px}.status-card h2{font-size:28px;font-weight:600}.timer-card{background:var(--card-bg);border-radius:16px;padding:20px;margin-bottom:20px;box-shadow:0 2px 10px rgba(0,0,0,.05);display:flex;justify-content:space-around}.timer{text-align:center}.timer span{display:block;color:var(--text-secondary);font-size:14px;margin-bottom:5px}.timer p{font-size:24px;font-weight:600;font-variant-numeric:tabular-nums}.info-message{padding:15px;border-radius:12px;margin-bottom:20px;text-align:center;display:none;animation:slideIn .3s ease}.info-message.success{background:rgba(52,199,89,.1);color:var(--success);display:block}.info-message.error{background:rgba(255,59,48,.1);color:var(--danger);display:block}@keyframes slideIn{from{transform:translateY(-10px);opacity:0}to{transform:translateY(0);opacity:1}}.button-container{display:grid;gap:12px;margin-bottom:20px}.btn{padding:16px;border:none;border-radius:12px;font-size:16px;font-weight:600;cursor:pointer;transition:all .2s ease;color:#fff;display:flex;align-items:center;justify-content:center;gap:8px}.btn:active{transform:scale(.98)}.btn-start{background:var(--success)}.btn-pause{background:var(--warning)}.btn-stop{background:var(--danger)}.btn-secondary{background:var(--primary)}.log-card{background:var(--card-bg);border-radius:16px;padding:20px;box-shadow:0 2px 10px rgba(0,0,0,.05)}.log-card h3{font-size:16px;margin-bottom:15px}#log-container{max-height:150px;overflow-y:auto;font-size:14px;color:var(--text-secondary)}#log-container p{padding:5px 0;border-bottom:1px solid var(--border)}#log-container p:last-child{border:none}.loading-overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(255,255,255,.95);display:none;align-items:center;justify-content:center;flex-direction:column;z-index:1000}.spinner{width:40px;height:40px;border:4px solid var(--border);border-top-color:var(--primary);border-radius:50%;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}#loading-text{margin-top:20px;color:var(--text-secondary)}@media (prefers-color-scheme:dark){:root{--bg:#000;--card-bg:#1c1c1e;--text:#fff;--text-secondary:#8e8e93;--border:#38383a}.loading-overlay{background:rgba(0,0,0,.95)}}@media (max-width:480px){.container{padding:15px}.header h1{font-size:20px}.timer p{font-size:20px}}`;

const JS_CONTENT = `document.addEventListener('DOMContentLoaded',()=>{const API_URL='/api/beta10';const PAUSE_LIMITS={desayuno:15*60*1000,comida:30*60*1000};const dom={connectionStatus:document.getElementById('connection-status'),gpsStatus:document.getElementById('gps-status'),currentState:document.getElementById('current-state'),workTimer:document.getElementById('work-timer'),pauseTimer:document.getElementById('pause-timer'),buttonContainer:document.getElementById('button-container'),logContainer:document.getElementById('log-container'),loadingOverlay:document.getElementById('loading-overlay'),loadingText:document.getElementById('loading-text'),infoMessage:document.getElementById('info-message')};let state={currentState:'FUERA',workStartTime:null,pauseStartTime:null,totalPauseTime:0,location:null,isAlarmActive:false};function loadState(){const saved=localStorage.getItem('beta10State');if(saved){const parsed=JSON.parse(saved);state={...parsed,workStartTime:parsed.workStartTime?new Date(parsed.workStartTime):null,pauseStartTime:parsed.pauseStartTime?new Date(parsed.pauseStartTime):null};log('Estado recuperado de sesión anterior')}}function saveState(){localStorage.setItem('beta10State',JSON.stringify(state))}function log(message){const time=new Date().toLocaleTimeString('es-ES');const entry=document.createElement('p');entry.textContent=\`[\${time}] \${message}\`;dom.logContainer.prepend(entry);while(dom.logContainer.children.length>30){dom.logContainer.removeChild(dom.logContainer.lastChild)}}function showLoading(show,text='Procesando...'){dom.loadingText.textContent=text;dom.loadingOverlay.style.display=show?'flex':'none'}async function getLocation(){return new Promise((resolve,reject)=>{if(!navigator.geolocation){reject(new Error('GPS no disponible'));return}dom.gpsStatus.classList.add('yellow');navigator.geolocation.getCurrentPosition((position)=>{state.location={latitude:position.coords.latitude,longitude:position.coords.longitude,accuracy:position.coords.accuracy};dom.gpsStatus.classList.remove('yellow','red');dom.gpsStatus.classList.add('green');log(\`GPS: \${state.location.latitude.toFixed(4)}, \${state.location.longitude.toFixed(4)}\`);resolve(state.location)},(error)=>{dom.gpsStatus.classList.remove('yellow','green');dom.gpsStatus.classList.add('red');reject(new Error(\`Error GPS: \${error.message}\`))},{enableHighAccuracy:true,timeout:10000,maximumAge:30000})})}async function callAPI(action,point,observations=''){try{showLoading(true,\`Registrando \${action}...\`);dom.connectionStatus.classList.add('yellow');await getLocation();const response=await fetch(API_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,point,location:state.location,observations})});const result=await response.json();if(result.success){dom.connectionStatus.classList.remove('yellow','red');dom.connectionStatus.classList.add('green');log(\`✅ \${action.toUpperCase()} en \${point} registrada\`);return result}else{throw new Error(result.error||'Error desconocido')}}catch(error){dom.connectionStatus.classList.remove('yellow','green');dom.connectionStatus.classList.add('red');log(\`❌ Error: \${error.message}\`);alert(\`Error: \${error.message}\`);throw error}finally{showLoading(false)}}async function startWorkday(){try{await callAPI('entrada','J');state.currentState='JORNADA';state.workStartTime=new Date();saveState();updateUI()}catch(error){console.error(error)}}async function startAlmacen(){try{await callAPI('entrada','9');state.currentState='ALMACEN';state.workStartTime=new Date();saveState();updateUI()}catch(error){console.error(error)}}async function almacenToJornada(){try{await callAPI('salida','9');await callAPI('entrada','J');state.currentState='JORNADA';saveState();updateUI()}catch(error){console.error(error)}}async function startPause(){try{await callAPI('salida','J');await callAPI('entrada','P');state.currentState='PAUSA';state.pauseStartTime=new Date();state.isAlarmActive=false;saveState();updateUI()}catch(error){console.error(error)}}async function endPause(){try{await callAPI('salida','P');await callAPI('entrada','J');if(state.pauseStartTime){const pauseDuration=new Date()-state.pauseStartTime;state.totalPauseTime+=pauseDuration}state.currentState='JORNADA';state.pauseStartTime=null;state.isAlarmActive=false;saveState();updateUI()}catch(error){console.error(error)}}async function endWorkday(){try{let observations='';if(state.workStartTime){const worked=new Date()-state.workStartTime-state.totalPauseTime;const hours=worked/(1000*60*60);if(hours>8.5){observations=prompt('Detectadas horas extra. ¿Observaciones?')||''}}if(state.currentState==='PAUSA'){await callAPI('salida','P',observations)}else if(state.currentState==='ALMACEN'){await callAPI('salida','9',observations)}else{await callAPI('salida','J',observations)}state.currentState='FUERA';state.workStartTime=null;state.pauseStartTime=null;state.totalPauseTime=0;state.isAlarmActive=false;saveState();updateUI()}catch(error){console.error(error)}}function updateTimers(){if(state.workStartTime){let workTime=new Date()-state.workStartTime-state.totalPauseTime;if(state.pauseStartTime){const currentPause=new Date()-state.pauseStartTime;workTime-=currentPause;dom.pauseTimer.textContent=formatTime(currentPause);if(currentPause>10*60*1000&&!state.isAlarmActive){playAlarm()}}else{dom.pauseTimer.textContent=formatTime(state.totalPauseTime)}dom.workTimer.textContent=formatTime(workTime)}else{dom.workTimer.textContent='00:00:00';dom.pauseTimer.textContent='00:00:00'}}function formatTime(ms){const seconds=Math.floor(ms/1000);const h=Math.floor(seconds/3600);const m=Math.floor((seconds%3600)/60);const s=seconds%60;return \`\${String(h).padStart(2,'0')}:\${String(m).padStart(2,'0')}:\${String(s).padStart(2,'0')}\`}function playAlarm(){state.isAlarmActive=true;dom.infoMessage.textContent='⏰ Pausa mínima completada (10 min)';dom.infoMessage.classList.add('success');if('vibrate' in navigator){navigator.vibrate([200,100,200,100,200])}const audio=new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSuBzvLZhjsIG2m+8+OWT');audio.play();setTimeout(()=>{dom.infoMessage.classList.remove('success');dom.infoMessage.textContent=''},5000)}function updateUI(){let stateText='Fuera de Jornada';switch(state.currentState){case'JORNADA':stateText='En Jornada';break;case'PAUSA':stateText='En Pausa';break;case'ALMACEN':stateText='En Almacén';break}dom.currentState.textContent=stateText;dom.buttonContainer.innerHTML='';const createButton=(text,className,handler)=>{const btn=document.createElement('button');btn.textContent=text;btn.className=\`btn \${className}\`;btn.onclick=handler;dom.buttonContainer.appendChild(btn)};switch(state.currentState){case'FUERA':createButton('▶️ Iniciar Jornada','btn-start',startWorkday);createButton('📦 Iniciar Almacén','btn-secondary',startAlmacen);break;case'ALMACEN':createButton('▶️ Pasar a Jornada','btn-start',almacenToJornada);createButton('⛔ Finalizar','btn-stop',endWorkday);break;case'JORNADA':createButton('⏸️ Iniciar Pausa','btn-pause',startPause);createButton('⛔ Finalizar Jornada','btn-stop',endWorkday);break;case'PAUSA':createButton('▶️ Volver de Pausa','btn-start',endPause);createButton('⛔ Finalizar Jornada','btn-stop',endWorkday);break}}loadState();updateUI();setInterval(updateTimers,1000);if('serviceWorker' in navigator){navigator.serviceWorker.register('/service-worker.js').then(()=>log('✅ Service Worker registrado')).catch(err=>log(\`❌ Error SW: \${err.message}\`))}log('🚀 Beta10 CF iniciado')});`;

const MANIFEST_CONTENT = JSON.stringify({
  "name": "Beta10 Control CF",
  "short_name": "Beta10",
  "description": "Control de jornada con Cloudflare Workers",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#f2f2f7",
  "theme_color": "#007aff",
  "orientation": "portrait",
  "icons": [
    {
      "src": "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTkyIiBoZWlnaHQ9IjE5MiIgdmlld0JveD0iMCAwIDE5MiAxOTIiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSIxOTIiIGhlaWdodD0iMTkyIiByeD0iMzgiIGZpbGw9IiMwMDdhZmYiLz4KPHBhdGggZD0iTTk2IDQ4QzEyMC4zIDQ4IDEzNiA2My43IDEzNiA4OFYxMDRDMTM2IDEyOC4zIDEyMC4zIDE0NCA5NiAxNDRINzJDNjcuNiAxNDQgNjQgMTQwLjQgNjQgMTM2VjU2QzY0IDUxLjYgNjcuNiA0OCA3MiA0OEg5NloiIGZpbGw9IndoaXRlIi8+CjxjaXJjbGUgY3g9Ijk2IiBjeT0iOTYiIHI9IjE2IiBmaWxsPSIjMDA3YWZmIi8+Cjwvc3ZnPgo=",
      "sizes": "192x192",
      "type": "image/svg+xml"
    }
  ]
});

const SW_CONTENT = \`const CACHE_NAME='beta10-cf-v1';const urlsToCache=['/','/style.css','/script.js','/manifest.json'];self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(urlsToCache)))});self.addEventListener('fetch',event=>{event.respondWith(caches.match(event.request).then(response=>{if(response){return response}const fetchRequest=event.request.clone();if(event.request.url.includes('/api/')){return fetch(event.request)}return fetch(fetchRequest).then(response=>{if(!response||response.status!==200||response.type!=='basic'){return response}const responseToCache=response.clone();caches.open(CACHE_NAME).then(cache=>{cache.put(event.request,responseToCache)});return response})}))});\`;