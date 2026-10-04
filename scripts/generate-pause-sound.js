// scripts/generate-pause-sound.js - Genera pause_end.wav: tres "clinks" metàl·lics curts (~1,2 s)
// per a l'avís de fi de pausa. És un so de notificació (no una alarma en bucle) i ha de ser
// diferent del so per defecte del mòbil. El .wav resultant es commiteja (la CI no el regenera).
//
// Ús: node scripts/generate-pause-sound.js [sortida]
const fs = require('fs');
const path = require('path');

const SAMPLE_RATE = 22050;
const HITS = [0, 0.33, 0.66];           // segons: CLINK CLINK CLINK
const DURATION = 1.25;                  // segons
// Parcials inharmònics (so de vidre/metall) amb amplitud i temps de decaïment propis
const PARTIALS = [
    { freq: 2093, amp: 0.55, decay: 0.16 },
    { freq: 3389, amp: 0.30, decay: 0.11 },
    { freq: 5011, amp: 0.18, decay: 0.08 },
    { freq: 6877, amp: 0.10, decay: 0.05 }
];

function renderSamples() {
    const total = Math.round(SAMPLE_RATE * DURATION);
    const samples = new Float32Array(total);
    for (const hit of HITS) {
        const start = Math.round(hit * SAMPLE_RATE);
        for (let i = start; i < total; i++) {
            const t = (i - start) / SAMPLE_RATE;
            const attack = Math.min(1, t / 0.002); // 2 ms d'atac: evita el "clic" digital
            let v = 0;
            for (const p of PARTIALS) v += p.amp * Math.exp(-t / p.decay) * Math.sin(2 * Math.PI * p.freq * t);
            samples[i] += v * attack;
        }
    }
    // Normalitzar a -1 dBFS
    let peak = 0;
    for (const s of samples) peak = Math.max(peak, Math.abs(s));
    const gain = peak > 0 ? 0.89 / peak : 1;
    for (let i = 0; i < total; i++) samples[i] *= gain;
    return samples;
}

function encodeWav(samples) {
    const dataSize = samples.length * 2;
    const buf = Buffer.alloc(44 + dataSize);
    buf.write('RIFF', 0);
    buf.writeUInt32LE(36 + dataSize, 4);
    buf.write('WAVE', 8);
    buf.write('fmt ', 12);
    buf.writeUInt32LE(16, 16);             // mida del bloc fmt
    buf.writeUInt16LE(1, 20);              // PCM
    buf.writeUInt16LE(1, 22);              // mono
    buf.writeUInt32LE(SAMPLE_RATE, 24);
    buf.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate
    buf.writeUInt16LE(2, 32);              // block align
    buf.writeUInt16LE(16, 34);             // bits per mostra
    buf.write('data', 36);
    buf.writeUInt32LE(dataSize, 40);
    for (let i = 0; i < samples.length; i++) {
        const s = Math.max(-1, Math.min(1, samples[i]));
        buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
    }
    return buf;
}

function generatePauseSound(outPath = path.resolve(__dirname, '..', 'pause_end.wav')) {
    const wav = encodeWav(renderSamples());
    fs.writeFileSync(outPath, wav);
    return { path: outPath, bytes: wav.length, seconds: DURATION };
}

if (require.main === module) {
    const out = generatePauseSound(process.argv[2]);
    console.log(`✅ ${out.path} (${out.bytes} bytes, ${out.seconds} s)`);
}

module.exports = { generatePauseSound, SAMPLE_RATE, DURATION };
