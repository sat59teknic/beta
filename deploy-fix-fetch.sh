#!/bin/bash

echo "🌐 SOLUCIONANT ERROR 'FAILED TO FETCH' DEFINITIVAMENT..."

git add .
git commit -m "🌐 Fix: Traductor automàtic d'errors - Failed to fetch → 'No tens connexió'"
git push origin main

echo "✅ ERROR 'FAILED TO FETCH' SOLUCIONAT!"
echo "🎯 Ara quan no tinguis internet veuràs:"
echo "    ❌ ABANS: 'Failed to fetch'"
echo "    ✅ DESPRÉS: 'No tens connexió a internet. Comprova la xarxa i torna-ho a intentar.'"
echo ""
echo "📱 Prova l'aplicació: https://beta-beta-five.vercel.app"
echo ""
echo "🧪 Per provar el fix:"
echo "  1. Desconnecta WiFi/dades mòbils"
echo "  2. Prova fer un fitxatge"
echo "  3. Ara veuràs el missatge en català clar!"
echo ""
echo "🔥 Altres errors també traduïts:"
echo "  📍 GPS denegat → 'Has denegat el permís de localització'"
echo "  ⏱️ GPS timeout → 'El GPS triga massa temps'"
echo "  🔐 Credencials → 'Usuari o contrasenya incorrectes'"
echo "  🖥️ Servidor → 'El servidor Beta10 té problemes'"
