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
