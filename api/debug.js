// api/debug.js - Diagnòstic de xarxa entre Vercel i 9teknic.movbeta10.es:9000
const dns = require('dns').promises;
const net = require('net');

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');

    const report = {
        timestamp: new Date().toISOString(),
        region: process.env.VERCEL_REGION || 'desconeguda',
        dns: null,
        tcp: null,
        http: null
    };

    // 1. Prova DNS
    try {
        const dnsStart = Date.now();
        const addresses = await dns.lookup('9teknic.movbeta10.es');
        report.dns = {
            ok: true,
            address: addresses.address,
            durationMs: Date.now() - dnsStart
        };
    } catch (e) {
        report.dns = { ok: false, error: e.message, code: e.code };
    }

    // 2. Prova TCP Socket directe al port 9000
    if (report.dns && report.dns.address) {
        report.tcp = await new Promise((resolve) => {
            const socket = new net.Socket();
            const start = Date.now();
            socket.setTimeout(8000);

            socket.connect(9000, report.dns.address, () => {
                const durationMs = Date.now() - start;
                socket.destroy();
                resolve({ ok: true, durationMs, message: 'Port 9000 obert i accessible des de Vercel' });
            });

            socket.on('timeout', () => {
                socket.destroy();
                resolve({ ok: false, durationMs: Date.now() - start, error: 'TIMEOUT (8s): Port 9000 no respon' });
            });

            socket.on('error', (err) => {
                socket.destroy();
                resolve({ ok: false, durationMs: Date.now() - start, error: err.message, code: err.code });
            });
        });

        // 2b. Prova port 9001
        report.tcp9001 = await new Promise((resolve) => {
            const socket = new net.Socket();
            const start = Date.now();
            socket.setTimeout(8000);

            socket.connect(9001, report.dns.address, () => {
                const durationMs = Date.now() - start;
                socket.destroy();
                resolve({ ok: true, durationMs, message: 'Port 9001 obert i accessible des de Vercel' });
            });

            socket.on('timeout', () => {
                socket.destroy();
                resolve({ ok: false, durationMs: Date.now() - start, error: 'TIMEOUT (8s): Port 9001 no respon' });
            });

            socket.on('error', (err) => {
                socket.destroy();
                resolve({ ok: false, durationMs: Date.now() - start, error: err.message, code: err.code });
            });
        });
    }

    // 3. Prova HTTP fetch
    try {
        const fetchStart = Date.now();
        const controller = new AbortController();
        const to = setTimeout(() => controller.abort(), 8000);
        const resp = await fetch('https://9teknic.movbeta10.es:9000/app/index.html', {
            method: 'GET',
            signal: controller.signal
        });
        clearTimeout(to);
        report.http = {
            ok: resp.ok || resp.status === 200 || resp.status === 302,
            status: resp.status,
            durationMs: Date.now() - fetchStart
        };
    } catch (e) {
        report.http = { ok: false, error: e.message };
    }

    return res.status(200).json(report);
};
