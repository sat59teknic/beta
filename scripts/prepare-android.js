// scripts/prepare-android.js - Configura permisos, so de fi de pausa, icona de notificació i signatura
// al projecte natiu generat per `npx cap add android` / `npx cap sync android`.
//
// És idempotent (es pot executar abans de cada build) i FALLA amb codi de sortida 1 si falta
// qualsevol peça crítica (manifest, debug.keystore, pause_end.wav): abans, sense debug.keystore
// l'APK es construïa en silenci amb una signatura aleatòria i l'actualització sobre una
// instal·lació existent fallava ("app no instal·lada").
//
// Exporta prepareAndroid(rootDir) per poder-lo provar sense tocar el projecte real.
const fs = require('fs');
const path = require('path');

// POST_NOTIFICATIONS (Android 13+) i alarmes exactes són imprescindibles per a l'avís de fi de pausa.
const REQUIRED_PERMISSIONS = [
    'android.permission.INTERNET',
    'android.permission.ACCESS_NETWORK_STATE',
    'android.permission.ACCESS_FINE_LOCATION',
    'android.permission.ACCESS_COARSE_LOCATION',
    'android.permission.VIBRATE',
    'android.permission.WAKE_LOCK',
    'android.permission.POST_NOTIFICATIONS',
    'android.permission.SCHEDULE_EXACT_ALARM',
    'android.permission.USE_EXACT_ALARM',
    'android.permission.RECEIVE_BOOT_COMPLETED'
];

// L12: la icona petita de la notificació ha de ser un drawable MONOCROM (Android la pinta amb la
// silueta alfa). 'ic_launcher_round' és un mipmap de color i, a més, el plugin només busca a
// drawable/, de manera que queia a la icona genèrica d'Android.
const NOTIFICATION_ICON_NAME = 'ic_stat_pause_alarm';
// So del canal "Fi de pausa" (CLINK CLINK CLINK). Generat per scripts/generate-pause-sound.js.
const PAUSE_END_SOUND = 'pause_end.wav';
const NOTIFICATION_ICON_XML = `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
    <path
        android:fillColor="#FFFFFFFF"
        android:pathData="M12,22c1.1,0 2,-0.9 2,-2h-4c0,1.1 0.9,2 2,2zM18,16v-5c0,-3.07 -1.63,-5.64 -4.5,-6.32V4c0,-0.83 -0.67,-1.5 -1.5,-1.5s-1.5,0.67 -1.5,1.5v0.68C7.64,5.36 6,7.92 6,11v5l-2,2v1h16v-1l-2,-2z" />
</vector>
`;

function addMissingPermissions(manifest) {
    const missing = REQUIRED_PERMISSIONS.filter(name => !manifest.includes(`"${name}"`));
    if (missing.length === 0) return { manifest, added: [] };
    if (!manifest.includes('<application')) {
        throw new Error('AndroidManifest.xml no té cap etiqueta <application>');
    }
    const block = missing
        .map(name => `    <uses-permission android:name="${name}" />`)
        .join('\n');
    const updated = manifest.replace('<application', `<!-- Permisos necessaris per a 9T Beta10 -->\n${block}\n\n    <application`);
    return { manifest: updated, added: missing };
}

// L13: l'app només parla amb https://9teknic.movbeta10.es:9000 i amb el seu propi origen https
// (androidScheme: https). El trànsit HTTP en clar no fa falta; es desactiva si una versió antiga
// de l'script l'havia activat.
function disableCleartext(manifest) {
    if (manifest.includes('android:usesCleartextTraffic="true"')) {
        return { manifest: manifest.replace('android:usesCleartextTraffic="true"', 'android:usesCleartextTraffic="false"'), changed: true };
    }
    return { manifest, changed: false };
}

function signingBlock(name) {
    return `        ${name} {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }`;
}

// Retorna el text del bloc "name { ... }" (claus equilibrades) o null.
function getBlock(content, name) {
    const m = new RegExp(name + '\\s*\\{').exec(content);
    if (!m) return null;
    let depth = 0;
    for (let i = m.index + m[0].length - 1; i < content.length; i++) {
        if (content[i] === '{') depth++;
        else if (content[i] === '}') { depth--; if (depth === 0) return content.slice(m.index, i + 1); }
    }
    return null;
}

// Signa debug I release amb el mateix keystore fix (A6). Idempotent.
function ensureSigningInGradle(gradle) {
    let content = gradle;
    let changed = false;

    if (!/signingConfigs\s*\{/.test(content)) {
        content = content.replace(/android\s*\{/, match => `${match}\n    signingConfigs {\n${signingBlock('debug')}\n${signingBlock('release')}\n    }\n`);
        changed = true;
    } else {
        const signingBlockText = getBlock(content, 'signingConfigs') || '';
        const hasDebug = /\bdebug\s*\{/.test(signingBlockText);
        const hasRelease = /\brelease\s*\{/.test(signingBlockText);
        if (!hasDebug) {
            content = content.replace(/signingConfigs\s*\{/, match => `${match}\n${signingBlock('debug')}`);
            changed = true;
        }
        if (!hasRelease) {
            content = content.replace(/signingConfigs\s*\{/, match => `${match}\n${signingBlock('release')}`);
            changed = true;
        }
    }

    if (!content.includes('signingConfig signingConfigs.debug')) {
        if (/buildTypes\s*\{[\s\S]*?\bdebug\s*\{/.test(content)) {
            content = content.replace(/(buildTypes\s*\{[\s\S]*?\bdebug\s*\{)/, '$1\n            signingConfig signingConfigs.debug');
        } else {
            content = content.replace(/buildTypes\s*\{/, match => `${match}\n        debug {\n            signingConfig signingConfigs.debug\n        }`);
        }
        changed = true;
    }
    if (!content.includes('signingConfig signingConfigs.release')) {
        if (/buildTypes\s*\{[\s\S]*?\brelease\s*\{/.test(content)) {
            content = content.replace(/(buildTypes\s*\{[\s\S]*?\brelease\s*\{)/, '$1\n            signingConfig signingConfigs.release');
        } else {
            content = content.replace(/buildTypes\s*\{/, match => `${match}\n        release {\n            signingConfig signingConfigs.release\n        }`);
        }
        changed = true;
    }
    return { gradle: content, changed };
}

function prepareAndroid(rootDir = path.resolve(__dirname, '..'), log = console) {
    const manifestPath = path.join(rootDir, 'android/app/src/main/AndroidManifest.xml');
    const resDir = path.join(rootDir, 'android/app/src/main/res');
    const gradlePath = path.join(rootDir, 'android/app/build.gradle');
    const keystoreSrc = path.join(rootDir, 'debug.keystore');
    const keystoreDest = path.join(rootDir, 'android/app/debug.keystore');
    const srcSound = path.join(rootDir, PAUSE_END_SOUND);

    // --- Comprovacions prèvies: res no es modifica si falta una peça crítica ---
    if (!fs.existsSync(manifestPath)) {
        throw new Error(`No s'ha trobat AndroidManifest.xml a: ${manifestPath} (executa "npx cap add android" i "npx cap sync android" abans)`);
    }
    if (!fs.existsSync(keystoreSrc)) {
        throw new Error(`No s'ha trobat debug.keystore a: ${keystoreSrc}. Sense el keystore fix, l'APK se signaria amb una clau aleatòria i NO es podria actualitzar sobre la instal·lació existent.`);
    }
    if (!fs.existsSync(srcSound)) {
        throw new Error(`No s'ha trobat ${PAUSE_END_SOUND} a: ${srcSound} (genera'l amb "node scripts/generate-pause-sound.js"). Sense aquest so, el canal de fi de pausa sonaria amb el so per defecte.`);
    }
    if (!fs.existsSync(gradlePath)) {
        throw new Error(`No s'ha trobat build.gradle a: ${gradlePath}`);
    }

    // --- Manifest: permisos + sense trànsit en clar ---
    let manifest = fs.readFileSync(manifestPath, 'utf8');
    const permissions = addMissingPermissions(manifest);
    manifest = permissions.manifest;
    const cleartext = disableCleartext(manifest);
    manifest = cleartext.manifest;
    fs.writeFileSync(manifestPath, manifest, 'utf8');
    if (permissions.added.length > 0) log.log(`✅ Permisos afegits: ${permissions.added.join(', ')}`);
    if (cleartext.changed) log.log('✅ usesCleartextTraffic desactivat (només HTTPS).');
    log.log('✅ AndroidManifest.xml actualitzat amb èxit!');

    // --- So de fi de pausa a res/raw (l'antic alarm.wav ja no s'usa) ---
    const rawDir = path.join(resDir, 'raw');
    fs.mkdirSync(rawDir, { recursive: true });
    fs.copyFileSync(srcSound, path.join(rawDir, PAUSE_END_SOUND));
    const legacyAlarm = path.join(rawDir, 'alarm.wav');
    if (fs.existsSync(legacyAlarm)) fs.unlinkSync(legacyAlarm);
    log.log(`✅ ${PAUSE_END_SOUND} copiat a res/raw per al so de la notificació de fi de pausa.`);

    // --- Icona monocroma de la notificació ---
    const drawableDir = path.join(resDir, 'drawable');
    fs.mkdirSync(drawableDir, { recursive: true });
    fs.writeFileSync(path.join(drawableDir, `${NOTIFICATION_ICON_NAME}.xml`), NOTIFICATION_ICON_XML, 'utf8');
    log.log(`✅ Icona de notificació monocroma creada: drawable/${NOTIFICATION_ICON_NAME}.xml`);

    // --- Keystore fix + signatura debug i release ---
    fs.copyFileSync(keystoreSrc, keystoreDest);
    log.log('✅ debug.keystore copiat a android/app/debug.keystore');
    const signing = ensureSigningInGradle(fs.readFileSync(gradlePath, 'utf8'));
    if (signing.changed) {
        fs.writeFileSync(gradlePath, signing.gradle, 'utf8');
        log.log('✅ android/app/build.gradle configurat amb signatura permanent (debug i release) amb debug.keystore.');
    } else {
        log.log('✅ build.gradle ja tenia la signatura configurada.');
    }

    return { permissionsAdded: permissions.added, cleartextDisabled: cleartext.changed, gradleChanged: signing.changed };
}

module.exports = {
    prepareAndroid,
    addMissingPermissions,
    disableCleartext,
    ensureSigningInGradle,
    REQUIRED_PERMISSIONS,
    NOTIFICATION_ICON_NAME,
    PAUSE_END_SOUND
};

if (require.main === module) {
    try {
        prepareAndroid();
    } catch (error) {
        console.error('❌', error.message);
        process.exit(1);
    }
}
