/**
 * scripts/tests/test-pause-end-sound.js
 * El sonido de fin de pausa (pause_end.wav, "CLINK CLINK CLINK") y los restos de la alarma antigua.
 * Sin red: solo lee y genera ficheros locales (en un directorio temporal).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { assert, assertEqual } = require('../test-harness.js');
const { generatePauseSound, SAMPLE_RATE } = require('../generate-pause-sound.js');

const ROOT = path.join(__dirname, '..', '..');

function parseWav(buf) {
    return {
        riff: buf.toString('ascii', 0, 4), wave: buf.toString('ascii', 8, 12), fmt: buf.toString('ascii', 12, 16),
        format: buf.readUInt16LE(20), channels: buf.readUInt16LE(22), rate: buf.readUInt32LE(24),
        bits: buf.readUInt16LE(34), data: buf.toString('ascii', 36, 40), dataSize: buf.readUInt32LE(40)
    };
}

module.exports = function registerPauseEndSoundTests(runner) {
    runner.suite('Sonido de fin de pausa (pause_end.wav) y retirada de la alarma antigua', async (suite) => {

        suite.test('pause_end.wav es un WAV PCM 16-bit mono valido y CORTO (aviso, no alarma): entre 0,8 y 2 s', async () => {
            const buf = fs.readFileSync(path.join(ROOT, 'pause_end.wav'));
            const w = parseWav(buf);
            assertEqual(w.riff, 'RIFF'); assertEqual(w.wave, 'WAVE'); assertEqual(w.fmt, 'fmt '); assertEqual(w.data, 'data');
            assertEqual(w.format, 1, 'PCM'); assertEqual(w.channels, 1); assertEqual(w.bits, 16);
            assertEqual(w.dataSize, buf.length - 44);
            const seconds = w.dataSize / 2 / w.rate;
            assert(seconds >= 0.8 && seconds <= 2, 'duracion ' + seconds);
        });

        suite.test('Suenan exactamente 3 golpes ("CLINK CLINK CLINK") separados, sin saturar', async () => {
            const buf = fs.readFileSync(path.join(ROOT, 'pause_end.wav'));
            const n = (buf.length - 44) / 2;
            const win = Math.round(SAMPLE_RATE * 0.02);
            const env = [];
            let peak = 0;
            for (let i = 0; i + win <= n; i += win) {
                let m = 0;
                for (let j = i; j < i + win; j++) m = Math.max(m, Math.abs(buf.readInt16LE(44 + j * 2)));
                env.push(m); peak = Math.max(peak, m);
            }
            assert(peak < 32767, 'sin clipping');
            // Ataques: la envolvente salta por encima del 60% del pico viniendo de por debajo del 35%
            let hits = 0, armed = true;
            for (const v of env) {
                if (armed && v > peak * 0.6) { hits++; armed = false; }
                else if (v < peak * 0.35) armed = true;
            }
            assertEqual(hits, 3);
        });

        suite.test('El generador es determinista: regenerar produce el mismo fichero que el commiteado', async () => {
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'beta10-sound-'));
            try {
                const out = path.join(dir, 'x.wav');
                generatePauseSound(out);
                assert(Buffer.compare(fs.readFileSync(out), fs.readFileSync(path.join(ROOT, 'pause_end.wav'))) === 0);
            } finally { fs.rmSync(dir, { recursive: true, force: true }); }
        });

        suite.test('La alarma antigua ya no existe: sin alarm.wav en el repo, en la build, en el SW ni en script.js; el SW no fuerza interaccion ni ofrece "Silenciar Alarma"', async () => {
            assert(!fs.existsSync(path.join(ROOT, 'alarm.wav')), 'alarm.wav eliminado');
            const sw = fs.readFileSync(path.join(ROOT, 'service-worker.js'), 'utf8');
            const script = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
            const build = fs.readFileSync(path.join(ROOT, 'scripts/build-www.js'), 'utf8');
            for (const [name, src] of [['service-worker.js', sw], ['script.js', script], ['build-www.js', build]]) {
                assert(!src.includes('alarm.wav'), name + ' aun referencia alarm.wav');
            }
            assert(!sw.includes('STOP_ALARM') && !script.includes('STOP_ALARM'), 'sin accion STOP_ALARM');
            assert(!sw.includes('requireInteraction: true'), 'el aviso web no exige interaccion');
            assert(!sw.includes("addEventListener('notificationclose'"), 'cerrar la notificacion ya no "para" nada');
            assert(sw.includes("'/pause_end.wav'"));
            assert(build.includes("'pause_end.wav'"));
        });
    });
};
