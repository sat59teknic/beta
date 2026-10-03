// scripts/prepare-android.js - Configura permisos i paràmetres a AndroidManifest.xml
const fs = require('fs');
const path = require('path');

const manifestPath = path.resolve(__dirname, '../android/app/src/main/AndroidManifest.xml');

if (!fs.existsSync(manifestPath)) {
    console.error('❌ No s\'ha trobat AndroidManifest.xml a:', manifestPath);
    process.exit(1);
}

let manifest = fs.readFileSync(manifestPath, 'utf8');

const permissions = `
    <!-- Permisos necessaris per a 9T Beta10 -->
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
    <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
    <uses-permission android:name="android.permission.VIBRATE" />
    <uses-permission android:name="android.permission.WAKE_LOCK" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
    <uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM" />
    <uses-permission android:name="android.permission.USE_EXACT_ALARM" />
    <uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
`;

if (!manifest.includes('ACCESS_FINE_LOCATION')) {
    manifest = manifest.replace('<application', `${permissions}\n    <application`);
    console.log('✅ Permisos de geolocalització, vibració i xarxa afegits.');
}

if (!manifest.includes('usesCleartextTraffic')) {
    manifest = manifest.replace('<application', '<application android:usesCleartextTraffic="true"');
    console.log('✅ Habilitat usesCleartextTraffic per a compatibilitat HTTP/HTTPS.');
}

fs.writeFileSync(manifestPath, manifest, 'utf8');
console.log('✅ AndroidManifest.xml actualitzat amb èxit!');

// Copiar so d'alarma a res/raw per a les notificacions natives d'Android
const rawDir = path.resolve(__dirname, '../android/app/src/main/res/raw');
if (!fs.existsSync(rawDir)) {
    fs.mkdirSync(rawDir, { recursive: true });
}
const srcAlarm = path.resolve(__dirname, '../alarm.wav');
if (fs.existsSync(srcAlarm)) {
    fs.copyFileSync(srcAlarm, path.join(rawDir, 'alarm.wav'));
    console.log('✅ alarm.wav copiat a res/raw per al timbre de la notificació nativa.');
}

// 🔐 Configurar Keystore fix per mantenir la mateixa signatura en totes les actualitzacions d'APK
const keystoreSrc = path.resolve(__dirname, '../debug.keystore');
const keystoreDest = path.resolve(__dirname, '../android/app/debug.keystore');
if (fs.existsSync(keystoreSrc)) {
    fs.copyFileSync(keystoreSrc, keystoreDest);
    console.log('✅ debug.keystore copiat a android/app/debug.keystore');

    // Configurar build.gradle d'Android per usar aquest keystore fix
    const gradlePath = path.resolve(__dirname, '../android/app/build.gradle');
    if (fs.existsSync(gradlePath)) {
        let gradleContent = fs.readFileSync(gradlePath, 'utf8');
        if (!gradleContent.includes("signingConfigs {")) {
            const signingBlock = `
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
`;
            gradleContent = gradleContent.replace('android {', `android {\n${signingBlock}`);
            gradleContent = gradleContent.replace(
                'buildTypes {',
                `buildTypes {\n        debug {\n            signingConfig signingConfigs.debug\n        }`
            );
            fs.writeFileSync(gradlePath, gradleContent, 'utf8');
            console.log('✅ android/app/build.gradle configurat amb signatura permanent debug.keystore.');
        }
    }
}


