# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Build and Development
- `npm run build` - Build process (outputs "Build completed" - minimal build step)
- `npm run dev` - Start development server using Vercel CLI
- Node.js version: 18 (specified in package.json engines)

### Deployment
- **Platform**: Vercel
- **Main Entry**: `api/beta10.js`
- Auto-deploy on git push to main branch
- No environment variables needed (credentials stored client-side)

### Testing Commands
- `npm test` - suite completa sin red (ver la sección Pruebas más abajo)
- Manual testing through PWA interface
- Use `/api/health` endpoint for backend connectivity checks

## Architecture Overview

### Core Application Structure
This is a **Progressive Web App (PWA)** for employee time tracking that integrates with the Beta10 HR system. The application uses a **serverless architecture** hosted on Vercel with multi-user support for enterprise deployment.

### Frontend Architecture
- **Main Files**: 
  - `index.html` - Main PWA interface with status indicators and timers
  - `script.js` - Core application logic and state management
  - `auth.js` - Authentication management
  - `error-manager.js` - Centralized error handling system (V11)
  - `service-worker.js` - PWA functionality and offline capabilities

### Backend Architecture (Serverless Functions)
- **`api/beta10.js`** - Main proxy server for Beta10 integration with persistent cookie management (V7)
- **`api/test-auth.js`** - Credential validation endpoint
- **`api/health.js`** - Backend connectivity health check

### Key Design Patterns

#### State Management
- **Persistent State**: Application state stored in localStorage (`beta10AppState`)
- **Dynamic Work Days**: Supports different work schedules (8h vs 9h) based on day of week
- **Real-time Timers**: Work time and pause time tracking with millisecond precision

#### Authentication System
- **Multi-user Support**: Each employee uses their own Beta10 credentials
- **Client-side Storage**: Credentials stored locally in browser (not on server)
- **Automatic Session Recovery**: Restores login state on page reload

#### Error Management System (V11)
- **Centralized Error Handling**: All errors processed through `ErrorManager` class in `error-manager.js`
- **Localized Messages**: Technical errors automatically translated to Catalan user messages
- **Visual Toast Notifications**: Non-intrusive error display system with color coding
- **Context-aware Errors**: Different error types (network, GPS, auth, server, permissions)
- **SafeFetch Function**: Wrapper around fetch() with automatic error handling
- **User-friendly Messages**: Technical errors like "Failed to fetch" become "No tens connexió a internet"

#### GPS and Location Services
- **Real-time Location**: GPS coordinates sent with each clock-in/out action
- **Location Validation**: Ensures valid coordinates before submitting
- **Permission Management**: Handles GPS permission requests gracefully

### Integration Architecture

#### Beta10 System Integration
- **Cookie-based Authentication**: Maintains session with Beta10 through persistent cookies
- **CSRF Token Handling**: Automatically extracts and manages CSRF tokens
- **Form Field Detection**: Dynamically identifies form fields on Beta10 pages
- **Multi-step Process**: Login → Form Loading → Data Submission → Verification

#### PWA Features
- **Offline Capability**: Service worker enables offline functionality
- **Wake Lock API**: Keeps screen active during breaks to ensure alarms work
- **System Notifications**: Background notifications for break reminders
- **Installable**: Can be installed as native app on mobile devices

### State Flow
```
FUERA (Out) → JORNADA (Working) → PAUSA (Break) → JORNADA → FUERA
              ↓
            ALMACEN (Warehouse - Point 9)
```

### Break System (V9-V10 Improvements)
- **Two Break Types**: 
  - `esmorçar` (Breakfast - 10 min)
  - `dinar` (Lunch - 30 min)
- **Smart Alarms**: Multiple alarm systems (audio + vibration + system notifications)
- **Ultra-Reliable Alarms (V10)**: Wake Lock API + Service Worker + multiple fallbacks
- **Modal Selection**: Users choose break type when starting pause
- **Automatic Observations**: Break type automatically added to Beta10 observations
- **Overtime Calculation**: Automatic calculation after standard work hours + 30min buffer
- **Dynamic Work Days**: Different schedules (8h Friday vs 9h Monday-Saturday)

### File Organization
- **Root**: Main application files (HTML, CSS, JS)
- **`/api`**: Serverless functions for Vercel
- **`/api/backup`**: Backup versions of API functions
- **Documentation**: `README_EMPRESARIAL.md` (business docs), `README_ERRORS.md` (error system docs)

## Important Implementation Notes

### Security Considerations
- **No Server-side Credentials**: All user credentials stored client-side only
- **CORS Headers**: Properly configured for cross-origin requests
- **Session Management**: Secure cookie handling with Beta10 system
- **Individual Authentication**: Each employee uses their personal Beta10 credentials

### Performance Optimizations
- **Cookie Persistence**: V7 implementation maintains session cookies across requests
- **Dynamic Field Detection**: Adapts to changes in Beta10 form structure
- **Error Recovery**: Automatic retry mechanisms for failed operations
- **State Persistence**: Application state saved in localStorage for session recovery

### Multi-language Support
- **Primary Language**: Catalan (català)
- **Error Messages**: All user-facing errors translated to Catalan
- **UI Labels**: Interface completely in Catalan
- **Business Documentation**: Available in `README_EMPRESARIAL.md`

### Development Workflow
1. Changes pushed to main branch trigger automatic Vercel deployment
2. Use Vercel Dashboard for monitoring and debugging
3. All logging goes to Vercel function logs
4. No environment variables needed (credentials are client-side)
5. Test with `/api/health` endpoint for backend connectivity

### Key Files for Development
- **`script.js`**: Main application logic and state management (1000+ lines)
- **`auth.js`**: Authentication system with login modal
- **`error-manager.js`**: V11 centralized error handling system
- **`service-worker.js`**: PWA functionality and background notifications
- **`api/beta10.js`**: Main serverless proxy for Beta10 integration
- **`api/test-auth.js`**: Credential validation endpoint
- **`api/health.js`**: Backend connectivity health check

### Version History
- **V11**: Enhanced error management with Catalan translations
- **V10**: Ultra-reliable alarm system with Wake Lock API
- **V9**: Differentiated break types (breakfast/lunch)
- **V8**: Improved UI flow and pause management
- **V7**: Persistent cookie management for Beta10 sessions

This application is production-ready and designed for enterprise use with multiple employees.
## Reglas de cálculo de horas (decisiones consolidadas)

- **M1 - la jornada total INCLUYE las pausas.** `calculateExtraHours()` usa el tiempo transcurrido desde el
  inicio (esmorzar y dinar NO se restan) y lo compara con el horario del día (L-J 9 h, V 8 h, S/D 0 h = todo
  extra). Lo que se resta de las pausas es solo el campo "treballat" (`worked_hours`) que se guarda en SQLite.
  Es una decisión de negocio: no cambiarla sin hablar con el usuario. La UI lo indica ("Total Jornada (amb pauses)").
- **Extra remunerada**: bloques completos de 30 min **por día** (`floor(extra / 0.5) * 0.5`); los minutos sueltos
  no se acumulan entre días. En SQLite el resumen mensual agrega por día: con varias jornadas el mismo día se
  suman sus extras reales y se aplica el bloque al total del día (M5); una jornada única respeta su
  `remunerated_extra_hours` guardado. `days_with_extra` cuenta días distintos (L7) y `total_worked_hours` es el
  total del mes entero (incluye días sin extra).
- **M2/M4**: en PAUSA la pausa en curso ya está dentro del tiempo transcurrido (no se vuelve a sumar), y al
  finalizar la jornada las extras se calculan **una sola vez** (al pulsar el botón); ese resultado decide el modal,
  el texto y lo que se guarda.
- **M6**: una pausa que supera 1 h se cierra automáticamente contando solo el máximo previsto (15/30 min) en la
  jornada, pero la pausa REAL se registra en la tabla `pausas` con su duración real.

## Persistencia y migraciones (db.js)

- Las migraciones usan `PRAGMA table_info` y `PRAGMA user_version` (versión actual 1) y son idempotentes. Al añadir
  `remunerated_extra_hours` a una BD antigua se rellena el histórico con `floor(extra / 0.5) * 0.5`.
- `persist()` propaga los errores de IndexedDB y serializa los desados (cola). Las escrituras (`record*`, `update*`,
  `delete*`) deshacen el cambio en memoria si no se pudo persistir, para que un reintento no duplique filas.
- script.js mantiene una cola persistente (`beta10_pending_db_writes`) de escrituras SQLite fallidas que se
  reintenta al arrancar la BD; los fichajes pendientes de Beta10 viven en `beta10_pending_sync` (varios, con su
  hora original).
- La restauración valida el esquema (columnas) y el `quick_check`, guarda un snapshot de la BD anterior (memoria +
  IndexedDB) y la persiste ANTES de cerrar la antigua; "Desfer l'última restauració" la recupera.
- Backup en el APK: `<a download>` no descarga nada en el WebView de Capacitor. Si están los plugins
  `@capacitor/filesystem` y `@capacitor/share` se usa el menú de compartir; si no, la app NO simula éxito y ofrece la
  copia en texto (Base64). Los plugins no se han añadido a `package.json` (decisión pendiente del usuario).

## Avisos y notificaciones de pausa

Ya NO hay alarma en bucle (se eliminó `alarm.wav`, el banner "Aturar alarma" y la acción `STOP_ALARM`). Modelo actual:

- **APK, notificación 1002 "En pausa"**: se publica al iniciar la pausa (sin `schedule` => inmediata), `ongoing: true`,
  `autoCancel: false`, canal `pause_status_channel_v1` (importancia 2: en la bandeja, sin sonido). Lleva el botón
  `END_PAUSE` "Finalitzar pausa" (action type `PAUSE_ACTIONS`), que abre la app y llama a `endPause()` (mismo flujo
  que el botón de la app: fichajes P/J, SQLite, cola offline). Tocar el cuerpo la quita (lo hace el plugin) y la app
  la vuelve a publicar. Se re-publica al reabrir/volver al primer plano (Android 14+ deja deslizarla). Cuando vence
  el tiempo su texto pasa a "Temps esgotat".
- **APK, notificación 1001 "Pausa acabada"**: programada a inicio + límite con `allowWhileIdle`, canal
  `pause_end_channel_v1` (importancia 4, `pause_end.wav` = CLINK CLINK CLINK ~1,25 s, `USAGE_NOTIFICATION`). Suena UNA
  vez; no hay que pararla. Se verifica con `getPending`. Si el temporizador de la app llega antes (alarma inexacta),
  se publica la 1001 al instante (mismo id: cancela la programada) => un solo sonido. Con el aviso nativo programado
  la app NO reproduce audio propio (`pauseEndNativeOk`); sin permiso / canal silenciado sí reproduce `pause_end.wav`
  una vez.
- `notifyPauseEnd()` avisa UNA vez por pausa (`pauseAlarmTriggered`); el banner es informativo ("Entesos" solo lo
  cierra). La pausa nunca se cierra sola salvo la autocorrección de >1 h (M6).
- `pauseEndInFlight`: `endPause()` no se ejecuta dos veces a la vez (botón + notificación) y ninguna re-publicación
  concurrente (vuelta a primer plano, arranque en frío por END_PAUSE retenido) deja notificaciones huérfanas.
  `stopAlarm()` = limpieza completa (cancel + removeDelivered de 1001 y 1002); se llama en todos los caminos donde
  la pausa deja de existir (endPause, fin de jornada, autocorrecciones, `resetToOutOfWorkday`).
- `localNotificationReceived` también llega al publicar la 1002: solo la 1001 cuenta como fin de pausa.
- Se pide POST_NOTIFICATIONS (Android 13+) y, si Android 12+ no permite alarmas exactas, se ofrece abrir Ajustes
  (una vez) y cada pausa muestra un aviso. Todo fallo de programación se muestra al usuario (caja roja).
- Al reabrir con una pausa en curso: persistente re-publicada y 1001 reprogramada con el tiempo RESTANTE; si el
  límite ya pasó, aviso visual sin sonido retroactivo. Tras reiniciar el móvil el plugin restaura las notificaciones
  guardadas (RECEIVE_BOOT_COMPLETED).
- `pause_end.wav` lo genera `scripts/generate-pause-sound.js` (determinista; el .wav se commitea).
- `isAlarmPlaying`, `wakeLock`, `wakeLockLost` y `alarmSource` NO se persisten (un valor obsoleto silenciaba todas
  las alarmas siguientes).
- Los canales de Android son inmutables: si hay que cambiar sonido/importancia hay que subir el id del canal
  (`NATIVE_PAUSE_END_CHANNEL_ID` / `NATIVE_PAUSE_STATUS_CHANNEL_ID`) y añadir el anterior a `LEGACY_ALARM_CHANNEL_IDS`.
- **Web/PWA - limitaciones de plataforma (no corregibles)**: el temporizador del service worker y el de la página
  mueren si el navegador los suspende (pantalla apagada, pestaña en segundo plano, SW detenido). El aviso web solo
  es fiable con la app abierta y no tiene notificación persistente con botón; el fiable es el del APK. Doze/ahorro de batería de algunos fabricantes (Xiaomi,
  Huawei, Samsung...) puede retrasar o matar la app: excluir la app de la optimización de batería.
- Servicio de la PWA: `service-worker.js` usa red primero para HTML/JS/CSS (evita scripts viejos) y caché primero para
  audio/wasm/iconos. Subir `CACHE_NAME` al cambiar la lista de ficheros.

## Build Android

1. `npm run build` (copia los estáticos a `www/`), `npx cap add android` / `npx cap sync android`.
2. `node scripts/prepare-android.js` (idempotente): permisos, `pause_end.wav` -> `res/raw` (borra el `alarm.wav` antiguo), icono de notificación, firma
   debug y release con `debug.keystore`, sin tráfico en claro. **Falla** si falta `debug.keystore`, `pause_end.wav`, el
   manifest o el gradle.
3. Aviso: `debug.keystore` está en el repositorio (contraseña pública `android`) y también firma release.
   Es lo que mantiene la firma entre actualizaciones, pero cualquiera con el repo puede firmar un APK con esa clave.

## Pruebas

`npm test` en `beta/` (sin red; fetch, IndexedDB, Capacitor, GPS y service worker simulados). Los tests de script.js,
db-ui.js y el service worker ejecutan el **código real** en `vm` (`scripts/test-fake-app.js`). Los tests antiguos
`test-alarm-and-notifications.js`, `test-pause-and-resilience.js` y similares prueban réplicas con mocks del arnés;
la cobertura real de las notificaciones de pausa está en `test-pause-alarms-real.js` (y el sonido en
`test-pause-end-sound.js`).
