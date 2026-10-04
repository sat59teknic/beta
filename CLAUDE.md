# CLAUDE.md

Guía para Claude Code en este repositorio: app de control de jornada para 9 Teknic que ficha en Beta10.
Interfaz en catalán.

## Comandos (`beta/`)

- `npm test`: suite completa, sin red (obligatoria antes de cada push; debe dar 0 fallos).
- `npm run build`: copia los estáticos a `www/` (lista en `scripts/build-www.js`).
- `npm run dev`: servidor local con Vercel CLI (versión web).
- `node scripts/generate-pause-sound.js`: regenera `pause_end.wav`.

## Qué es y cómo se publica

- **APK Android (uso principal)**: Capacitor 6 (`appId es.teknic.beta10`, `webDir www`). Al hacer push a `main`,
  `.github/workflows/build-apk.yml` ejecuta los tests, compila el APK y lo publica en la release `latest`
  (`Beta10-app.apk`).
- **Web/PWA**: los mismos ficheros servidos en Vercel, con `service-worker.js`.
- **Fichajes**: en el APK, `beta10-direct.js` habla directamente con `https://9teknic.movbeta10.es:9000`. En la web
  pasa por el proxy serverless `api/beta10.js` (`api/health.js`, `api/test-auth.js`; `api/backup/` son versiones
  viejas). Las credenciales de cada empleado se guardan solo en el dispositivo (`auth.js`).

## Ficheros clave

- `script.js`: estado, fichajes, pausas, horas extra, notificaciones e inicio (`init`).
- `db.js` / `db-ui.js`: SQLite (sql.js + IndexedDB) y la pantalla de estadísticas, backup y restauración.
- `error-manager.js`: traducción de errores técnicos a mensajes en catalán.
- `scripts/prepare-android.js`: prepara el proyecto Android nativo (ver "Build Android").

## Estados

`FUERA` → `JORNADA` ⇄ `PAUSA` (esmorçar 15 min, una vez al día / dinar 30 min) → `FUERA`; `ALMACEN` = punto 9.
El estado vive en `localStorage` (`beta10AppState`). Entrar en pausa ficha `salida J` + `entrada P` (con el tipo de
pausa en las observaciones); volver ficha `salida P` + `entrada J`.

## Reglas de cálculo de horas (decisiones consolidadas)

- **M1: la jornada total INCLUYE las pausas.** `calculateExtraHours()` usa el tiempo transcurrido desde el
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
  el texto y lo que se guarda. Con horas extra, las observaciones son obligatorias.
- **M6**: una pausa que supera 1 h se cierra automáticamente contando solo el máximo previsto (15/30 min) en la
  jornada, pero la pausa REAL se registra en la tabla `pausas` con su duración real.

## Persistencia y migraciones (db.js)

- Las migraciones usan `PRAGMA table_info` y `PRAGMA user_version` (versión actual 1) y son idempotentes. Al añadir
  `remunerated_extra_hours` a una BD antigua se rellena el histórico con `floor(extra / 0.5) * 0.5`.
- `persist()` propaga los errores de IndexedDB y serializa los guardados (cola). Las escrituras (`record*`, `update*`,
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

No hay alarma en bucle (se eliminaron `alarm.wav`, el banner "Aturar alarma" y la acción `STOP_ALARM`).

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
- `isAlarmPlaying`, `wakeLock`, `wakeLockLost` y `alarmSource` NO se persisten (un valor obsoleto silenciaba los
  avisos siguientes).
- Los canales de Android son inmutables: si hay que cambiar sonido/importancia hay que subir el id del canal
  (`NATIVE_PAUSE_END_CHANNEL_ID` / `NATIVE_PAUSE_STATUS_CHANNEL_ID`) y añadir el anterior a `LEGACY_ALARM_CHANNEL_IDS`.
- **Web/PWA (limitación de plataforma)**: el temporizador del service worker y el de la página mueren si el navegador
  los suspende (pantalla apagada, pestaña en segundo plano). El aviso web solo es fiable con la app abierta y no tiene
  notificación persistente con botón. Doze/ahorro de batería de algunos fabricantes puede retrasar el aviso del APK:
  excluir la app de la optimización de batería.
- `service-worker.js` usa red primero para HTML/JS/CSS y caché primero para audio/wasm/iconos. Subir `CACHE_NAME` al
  cambiar la lista `urlsToCache` (un test la compara con `index.html` y con el disco).

## Build Android

1. `npm run build`, `npx cap add android` / `npx cap sync android`.
2. `node scripts/prepare-android.js` (idempotente): permisos, `pause_end.wav` -> `res/raw` (borra el `alarm.wav`
   antiguo), icono de notificación monocromo `ic_stat_pause_alarm`, firma debug y release con `debug.keystore`, sin
   tráfico en claro. **Falla** si falta `debug.keystore`, `pause_end.wav`, el manifest o el gradle.
3. La firma fija con `debug.keystore` es lo que permite instalar cada APK nuevo encima del anterior sin perder datos.
   Aviso: está en el repositorio (contraseña pública `android`), así que cualquiera con el repo puede firmar un APK.

## Pruebas

- Todo cambio (funcionalidad, fix o refactor) lleva sus tests en `scripts/tests/`, registrados en
  `scripts/run-all-tests.js`. Un bug se reproduce con un test antes de corregirlo.
- **Cero red**: `fetch` real está bloqueado en el runner; Beta10, IndexedDB, Capacitor, GPS y service worker están
  simulados. Nunca hacer peticiones reales a Beta10 desde un test.
- Los tests de script.js, db-ui.js y el service worker ejecutan el **código real** en `vm` (`scripts/test-fake-app.js`,
  con un `LocalNotifications` simulado que imita el plugin de Android). Los tests antiguos
  `test-alarm-and-notifications.js`, `test-pause-and-resilience.js` y similares prueban réplicas con mocks del arnés.
  La cobertura real de las notificaciones de pausa está en `test-pause-alarms-real.js` (y el sonido en
  `test-pause-end-sound.js`).

## Git

Conventional Commits (`feat`, `fix`, `test`, `refactor`, `chore`). Antes de `git push`: `npm test` con 0 fallos.
