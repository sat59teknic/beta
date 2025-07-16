#!/bin/bash

echo "🚀 Deploying Beta10 V11 - Sistema d'errors millorat..."

git add .
git commit -m "🚨 Sistema d'errors millorat V11 - Missatges clars en català"
git push origin main

echo "✅ Deploy completat!"
echo "🎉 Millores V11 - Sistema d'Errors:"
echo "  ✅ Missatges clars en català"
echo "  ✅ Notificacions toast elegants"
echo "  ✅ Errors traduïts automàticament"
echo "  ✅ Suggeriments de solució"
echo ""
echo "🗺 Testing URLs:"
echo "  Health: https://beta-beta-five.vercel.app/api/health"
echo "  App: https://beta-beta-five.vercel.app"
echo ""
echo "📋 Proves a fer:"
echo "  1. Desconnecta WiFi i prova fitxar (error de xarxa)"
echo "  2. Denega permisos GPS (error de localització)"
echo "  3. Introdueix credencials incorrectes (error d'autenticació)"
echo "  4. Tots els errors ara apareixen en català amb solucions"
