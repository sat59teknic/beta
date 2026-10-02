# 🚀 GEMINI.md - Directrices de Desarrollo y Calidad para Beta10 Jornada

Este archivo define las reglas obligatorias de conducta y flujo de trabajo para agentes y asistentes de desarrollo en este proyecto.

---

## 🧪 Regla Obligatoria: Tests y Emulación Pre-Push a GitHub

> **REGLA CRÍTICA**: Antes de realizar cualquier commit o subida (`git push`) a GitHub con una nueva implementación, corrección de errores o refactorización, es **estrictamente obligatorio** crear los tests correspondientes y emular todas las situaciones en un entorno de test.

### 1. Creación de Tests para Cada Implementación
- **Nuevas Funcionalidades**: Escribir suites de pruebas que cubran los casos de éxito (happy path), casos límite (edge cases) y validaciones de seguridad.
- **Corrección de Bugs**: Reproducir siempre el error con un test antes de implementar la solución y verificar que el test pase tras el fix.
- **Ubicación de Tests**: Todos los tests se ubican en [scripts/tests/](file:///c:/Users/sat59/Desktop/Beta10-github-jornada%20DEFINITIU/beta/scripts/tests/) e integrados en el runner maestro [scripts/run-all-tests.js](file:///c:/Users/sat59/Desktop/Beta10-github-jornada%20DEFINITIU/beta/scripts/run-all-tests.js).

### 2. Emulación Rigurosa en Entorno de Test
Toda prueba debe emular las condiciones y situaciones reales a través del arnés de pruebas ([scripts/test-harness.js](file:///c:/Users/sat59/Desktop/Beta10-github-jornada%20DEFINITIU/beta/scripts/test-harness.js)):
- **Emulación de Estados**: Transiciones completas entre estados (`FUERA`, `JORNADA`, `PAUSA`, `ALMACEN`).
- **Emulación de Red & Resiliencia Offline**: Simular desconexiones, errores de red ("Unable to resolve host", timeouts) y colas de sincronización offline.
- **Seguridad Estricta de Red (Zero Network Calls)**: Está terminantemente prohibido hacer peticiones HTTP reales a servidores externos o a Beta10 en los tests. Toda llamada a `fetch` debe ser interceptada/mockeada para evitar crear registros o tocar la base de datos de producción.
- **Emulación de Almacenamiento**: Persistencia simulada en `localStorage` y base de datos SQLite (`db.js` con `sql.js`).
- **Emulación de Audio, Notificaciones y Sensores**: Simulación de APIs de Audio (`playPauseAlarm`, `stopAlarm`), notificaciones nativas de Capacitor y geolocalización GPS.
- **Emulación de UI y Ciclo de Vida**: Simular eventos del DOM, pulsaciones largas (1s hold), temporizadores, visibilidad de ventana (`visibilitychange`) y reaperturas de app sin falsas alarmas retroactivas.

### 3. Verificación Previa y Criterio de Aceptación (DoD)
Antes de ejecutar cualquier comando `git push`:
1. Ejecutar la suite completa de pruebas:
   ```bash
   npm test
   ```
2. Confirmar que el 100% de los tests pasan exitosamente (`0 failed`).
3. Comprobar que no existen efectos secundarios indeseados ni llamadas de red no mockeadas.

---

## 🛠 Comandos Rápidos del Proyecto (`beta/`)
- **Ejecutar Tests**: `npm test` (o `node scripts/run-all-tests.js`)
- **Compilar Web / PWA**: `npm run build`
- **Servidor de Desarrollo**: `npm run dev`

---

## 📦 Flujo Git (Conventional Commits)
Una vez validados todos los tests en el entorno de emulación:
1. `git add .`
2. `git commit -m "<tipo>: <descripción>"` *(Tipos: `feat`, `fix`, `test`, `refactor`, `chore`)*
3. `git push`
