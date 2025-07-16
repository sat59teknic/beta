#!/bin/bash

echo "🇨🇹 TOTS ELS MISSATGES EN CATALÀ - VERSIÓ FINAL!"

git add .
git commit -m "🇨🇹 Fix: Tots els missatges traduïts a català (incluint alertes de pausa)"
git push origin main

echo "✅ TOTS ELS MISSATGES TRADUÏTS!"
echo ""
echo "🎯 Missatges corregits:"
echo "  ❌ ABANS: 'Failed to fetch'"
echo "  ✅ DESPRÉS: 'No tens connexió a internet'"
echo ""
echo "  ❌ ABANS: 'Cuando inicies una pausa, mantén la app abierta'"
echo "  ✅ DESPRÉS: 'Quan iniciis una pausa, mantén l'app oberta'"
echo ""
echo "  ❌ ABANS: 'Mi cuenta'"
echo "  ✅ DESPRÉS: 'El meu compte'"
echo ""
echo "  ❌ ABANS: 'Sesión cerrada'"
echo "  ✅ DESPRÉS: 'Sessió tancada'"
echo ""
echo "📱 Prova l'aplicació: https://beta-beta-five.vercel.app"
echo ""
echo "🔥 Ara TOTS els missatges apareixen en català!"
echo "✅ Experiència 100% catalana per als usuaris"
