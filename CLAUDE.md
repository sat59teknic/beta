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
- No specific test commands configured
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