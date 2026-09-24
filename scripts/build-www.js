// scripts/build-www.js - Copia els fitxers estàtics de la web a www/ per a Capacitor
const fs = require('fs');
const path = require('path');

const srcDir = path.resolve(__dirname, '..');
const destDir = path.join(srcDir, 'www');

const filesToCopy = [
    'index.html',
    'style.css',
    'auth.css',
    'error-styles.css',
    'script.js',
    'auth.js',
    'beta10-direct.js',
    'error-manager.js',
    'service-worker.js',
    'manifest.json',
    'icon-192.svg',
    'icon-512.svg'
];

if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
}

console.log('📦 Empaquetant fitxers web per a Capacitor a www/...');

filesToCopy.forEach(file => {
    const srcFile = path.join(srcDir, file);
    const destFile = path.join(destDir, file);
    if (fs.existsSync(srcFile)) {
        fs.copyFileSync(srcFile, destFile);
        console.log(`  ✓ ${file}`);
    } else {
        console.warn(`  ⚠️ No trobat: ${file}`);
    }
});

console.log('✅ Carpeta www/ llesta per a Capacitor!');
