# CLAUDE.md

Este archivo proporciona orientación a Claude Code (claude.ai/code) cuando trabaja con código en este repositorio.

## Comandos de Desarrollo

### Construcción y Desarrollo
- `npm run build` - Proceso de construcción (muestra "Build completed" - paso mínimo de construcción)
- `npm run dev` - Iniciar servidor de desarrollo usando Vercel CLI
- Versión de Node.js: 18 (especificada en engines del package.json)

### Despliegue
- **Plataforma**: Vercel
- **Entrada Principal**: `api/beta10.js`
- Auto-despliegue en git push a la rama main
- No se necesitan variables de entorno (credenciales almacenadas del lado del cliente)

### Comandos de Pruebas
- No hay comandos específicos de prueba configurados
- Pruebas manuales a través de la interfaz PWA
- Usar endpoint `/api/health` para verificar conectividad del backend

## Descripción de la Arquitectura

### Estructura Central de la Aplicación
Esta es una **Aplicación Web Progresiva (PWA)** para control de jornada laboral que se integra con el sistema Beta10 de RRHH. La aplicación usa una **arquitectura serverless** alojada en Vercel con soporte multi-usuario para despliegue empresarial.

### Arquitectura del Frontend
- **Archivos Principales**: 
  - `index.html` - Interfaz principal PWA con indicadores de estado y temporizadores
  - `script.js` - Lógica central de aplicación y gestión de estado
  - `auth.js` - Gestión de autenticación
  - `error-manager.js` - Sistema centralizado de manejo de errores (V11)
  - `service-worker.js` - Funcionalidad PWA y capacidades offline

### Arquitectura del Backend (Funciones Serverless)
- **`api/beta10.js`** - Servidor proxy principal para integración Beta10 con gestión persistente de cookies (V7)
- **`api/test-auth.js`** - Endpoint de validación de credenciales
- **`api/health.js`** - Verificación de salud de conectividad del backend

### Patrones de Diseño Clave

#### Gestión de Estado
- **Estado Persistente**: Estado de aplicación almacenado en localStorage (`beta10AppState`)
- **Días Laborales Dinámicos**: Soporta diferentes horarios de trabajo (8h vs 9h) basado en día de la semana
- **Temporizadores en Tiempo Real**: Seguimiento de tiempo de trabajo y pausa con precisión de milisegundos

#### Sistema de Autenticación
- **Soporte Multi-usuario**: Cada empleado usa sus propias credenciales Beta10
- **Almacenamiento del Cliente**: Credenciales almacenadas localmente en navegador (no en servidor)
- **Recuperación Automática de Sesión**: Restaura estado de login al recargar página

#### Sistema de Gestión de Errores (V11)
- **Manejo Centralizado de Errores**: Todos los errores procesados a través de la clase `ErrorManager` en `error-manager.js`
- **Mensajes Localizados**: Errores técnicos automáticamente traducidos a mensajes de usuario en catalán
- **Notificaciones Toast Visuales**: Sistema de visualización de errores no intrusivo con codificación por colores
- **Errores Conscientes del Contexto**: Diferentes tipos de error (red, GPS, auth, servidor, permisos)
- **Función SafeFetch**: Wrapper alrededor de fetch() con manejo automático de errores
- **Mensajes Amigables**: Errores técnicos como "Failed to fetch" se convierten en "No tens connexió a internet"

#### Servicios GPS y de Ubicación
- **Ubicación en Tiempo Real**: Coordenadas GPS enviadas con cada acción de fichar entrada/salida
- **Validación de Ubicación**: Asegura coordenadas válidas antes de enviar
- **Gestión de Permisos**: Maneja solicitudes de permisos GPS elegantemente

### Arquitectura de Integración

#### Integración del Sistema Beta10
- **Autenticación Basada en Cookies**: Mantiene sesión con Beta10 a través de cookies persistentes
- **Manejo de Tokens CSRF**: Extrae y gestiona automáticamente tokens CSRF
- **Detección de Campos de Formulario**: Identifica dinámicamente campos de formulario en páginas Beta10
- **Proceso Multi-paso**: Login → Carga de Formulario → Envío de Datos → Verificación

#### Características PWA
- **Capacidad Offline**: Service worker habilita funcionalidad offline
- **API Wake Lock**: Mantiene pantalla activa durante descansos para asegurar que funcionen las alarmas
- **Notificaciones del Sistema**: Notificaciones de fondo para recordatorios de descanso
- **Instalable**: Puede instalarse como app nativa en dispositivos móviles

### Flujo de Estados
```
FUERA (Fuera) → JORNADA (Trabajando) → PAUSA (Descanso) → JORNADA → FUERA
              ↓
            ALMACEN (Almacén - Punto 9)
```

### Sistema de Descansos (Mejoras V9-V10)
- **Dos Tipos de Descanso**: 
  - `esmorçar` (Desayuno - 10 min)
  - `dinar` (Almuerzo - 30 min)
- **Alarmas Inteligentes**: Múltiples sistemas de alarma (audio + vibración + notificaciones del sistema)
- **Alarmas Ultra-Confiables (V10)**: Wake Lock API + Service Worker + múltiples respaldos
- **Selección Modal**: Los usuarios eligen tipo de descanso al iniciar pausa
- **Observaciones Automáticas**: Tipo de descanso agregado automáticamente a observaciones Beta10
- **Cálculo de Horas Extra**: Cálculo automático después de horas de trabajo estándar + buffer de 30min
- **Días Laborales Dinámicos**: Diferentes horarios (8h viernes vs 9h lunes-sábado)

### Organización de Archivos
- **Raíz**: Archivos principales de aplicación (HTML, CSS, JS)
- **`/api`**: Funciones serverless para Vercel
- **`/api/backup`**: Versiones de respaldo de funciones API
- **Documentación**: `README_EMPRESARIAL.md` (docs empresariales), `README_ERRORS.md` (docs del sistema de errores)

## Notas Importantes de Implementación

### Consideraciones de Seguridad
- **Sin Credenciales del Servidor**: Todas las credenciales de usuario almacenadas solo del lado del cliente
- **Headers CORS**: Configurados apropiadamente para peticiones cross-origin
- **Gestión de Sesiones**: Manejo seguro de cookies con sistema Beta10
- **Autenticación Individual**: Cada empleado usa sus credenciales personales de Beta10

### Optimizaciones de Rendimiento
- **Persistencia de Cookies**: Implementación V7 mantiene cookies de sesión entre peticiones
- **Detección Dinámica de Campos**: Se adapta a cambios en la estructura de formularios Beta10
- **Recuperación de Errores**: Mecanismos automáticos de reintento para operaciones fallidas
- **Persistencia de Estado**: Estado de aplicación guardado en localStorage para recuperación de sesión

### Soporte Multi-idioma
- **Idioma Primario**: Catalán (català)
- **Mensajes de Error**: Todos los errores de cara al usuario traducidos al catalán
- **Etiquetas de UI**: Interfaz completamente en catalán
- **Documentación Empresarial**: Disponible en `README_EMPRESARIAL.md`

### Flujo de Trabajo de Desarrollo
1. Los cambios pusheados a la rama main desencadenan despliegue automático en Vercel
2. Usar Dashboard de Vercel para monitoreo y debugging
3. Todo el logging va a los logs de funciones Vercel
4. No se necesitan variables de entorno (credenciales del lado del cliente)
5. Probar con endpoint `/api/health` para conectividad del backend

### Archivos Clave para Desarrollo
- **`script.js`**: Lógica principal de aplicación y gestión de estado (1000+ líneas)
- **`auth.js`**: Sistema de autenticación con modal de login
- **`error-manager.js`**: Sistema centralizado de manejo de errores V11
- **`service-worker.js`**: Funcionalidad PWA y notificaciones de fondo
- **`api/beta10.js`**: Proxy serverless principal para integración Beta10
- **`api/test-auth.js`**: Endpoint de validación de credenciales
- **`api/health.js`**: Verificación de salud de conectividad del backend

### Historial de Versiones
- **V11**: Gestión de errores mejorada con traducciones al catalán
- **V10**: Sistema de alarmas ultra-confiables con Wake Lock API
- **V9**: Tipos de descanso diferenciados (desayuno/almuerzo)
- **V8**: Flujo de UI mejorado y gestión de pausas
- **V7**: Gestión persistente de cookies para sesiones Beta10

Esta aplicación está lista para producción y diseñada para uso empresarial con múltiples empleados.