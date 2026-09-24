// scripts/generate-icons.js - Genera les icones d'Android (mipmaps adaptatives i estàndard)
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

async function generateIcons() {
    const srcSvg = path.resolve(__dirname, '../icon-512.svg');
    const resDir = path.resolve(__dirname, '../android/app/src/main/res');

    if (!fs.existsSync(srcSvg)) {
        console.error('❌ No s\'ha trobat icon-512.svg a:', srcSvg);
        process.exit(1);
    }

    if (!fs.existsSync(resDir)) {
        console.error('❌ No s\'ha trobat la carpeta res d\'Android a:', resDir);
        process.exit(1);
    }

    console.log('🎨 Generant icones natives d\'Android per a 9T Beta10...');

    const mipmaps = [
        { dir: 'mipmap-mdpi', size: 48, fgSize: 108, safe: 72 },
        { dir: 'mipmap-hdpi', size: 72, fgSize: 162, safe: 108 },
        { dir: 'mipmap-xhdpi', size: 96, fgSize: 216, safe: 144 },
        { dir: 'mipmap-xxhdpi', size: 144, fgSize: 324, safe: 216 },
        { dir: 'mipmap-xxxhdpi', size: 192, fgSize: 432, safe: 288 }
    ];

    for (const m of mipmaps) {
        const targetDir = path.join(resDir, m.dir);
        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }

        // 1. ic_launcher.png (icona quadrada completa)
        await sharp(srcSvg)
            .resize(m.size, m.size)
            .png()
            .toFile(path.join(targetDir, 'ic_launcher.png'));

        // 2. ic_launcher_round.png (icona arrodonida)
        const circleBuffer = Buffer.from(
            `<svg width="${m.size}" height="${m.size}"><circle cx="${m.size / 2}" cy="${m.size / 2}" r="${m.size / 2}" fill="#000"/></svg>`
        );
        await sharp(srcSvg)
            .resize(m.size, m.size)
            .composite([{ input: circleBuffer, blend: 'dest-in' }])
            .png()
            .toFile(path.join(targetDir, 'ic_launcher_round.png'));

        // 3. ic_launcher_foreground.png (per a Adaptive Icons de Android 8+)
        const pad = Math.round((m.fgSize - m.safe) / 2);
        const padExtra = m.fgSize - m.safe - pad;
        await sharp(srcSvg)
            .resize(m.safe, m.safe)
            .extend({
                top: pad,
                bottom: padExtra,
                left: pad,
                right: padExtra,
                background: { r: 0, g: 0, b: 0, alpha: 0 }
            })
            .png()
            .toFile(path.join(targetDir, 'ic_launcher_foreground.png'));

        console.log(`  ✓ ${m.dir} generat (${m.size}x${m.size} i adaptativa ${m.fgSize}x${m.fgSize})`);
    }

    // 4. Configurar el fons de la icona adaptativa a negre (#000000)
    const valuesDir = path.join(resDir, 'values');
    if (fs.existsSync(valuesDir)) {
        const bgXmlPath = path.join(valuesDir, 'ic_launcher_background.xml');
        const bgXmlContent = `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#000000</color>\n</resources>\n`;
        fs.writeFileSync(bgXmlPath, bgXmlContent, 'utf8');
        console.log('  ✓ values/ic_launcher_background.xml configurat a #000000');
    }

    console.log('✅ Totes les icones d\'Android s\'han generat correctament!');
}

generateIcons().catch(err => {
    console.error('❌ Error generant icones:', err);
    process.exit(1);
});
