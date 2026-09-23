#!/usr/bin/env node
// scripts/encrypt-credentials.js - Eina de línia de comandes per xifrar credencials de Beta10
const readline = require('readline');
const { encryptCredentials } = require('../api/crypto-helper');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function ask(question, hidden = false) {
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            resolve(answer.trim());
        });
    });
}

async function main() {
    console.log('\n======================================================');
    console.log(' 🔐 GENERADOR DE CREDENCIALS XIFRADES PER A BETA10');
    console.log('======================================================\n');
    console.log('Aquest script generarà la cadena xifrada amb AES-256-GCM');
    console.log('per configurar a les variables d\'entorn de Vercel.\n');

    const username = await ask('👤 Usuari Beta10: ');
    if (!username) {
        console.error('❌ L\'usuari no pot estar buit.');
        process.exit(1);
    }

    const password = await ask('🔑 Contrasenya Beta10: ');
    if (!password) {
        console.error('❌ La contrasenya no pot estar buida.');
        process.exit(1);
    }

    const secretKey = await ask('🛡️ Clau secreta de xifrat (passphrase a la teva elecció): ');
    if (!secretKey || secretKey.length < 6) {
        console.error('❌ La clau secreta ha de tenir almenys 6 caràcters.');
        process.exit(1);
    }

    try {
        const encryptedBase64 = encryptCredentials({ username, password }, secretKey);

        console.log('\n✅ Credencials xifrades amb èxit!\n');
        console.log('------------------------------------------------------');
        console.log('COPIA I ENGANXA AQUESTES VARIABLES A VERCEL O .env.local:');
        console.log('------------------------------------------------------\n');
        console.log(`BETA10_SECRET_KEY=${secretKey}`);
        console.log(`BETA10_ENCRYPTED_CREDS=${encryptedBase64}\n`);
        console.log('------------------------------------------------------');
        console.log('ℹ️  A Vercel: Project Settings -> Environment Variables');
        console.log('------------------------------------------------------\n');
    } catch (error) {
        console.error('❌ Error xifrant:', error.message);
    } finally {
        rl.close();
    }
}

main();
