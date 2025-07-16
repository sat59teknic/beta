#!/bin/bash

echo "🔧 Arreglando error de inicialización..."

git add .
git commit -m "🔧 Fix: Arreglat error d'inicialització de DOM"
git push origin main

echo "✅ Error arreglat!"
echo "📱 Prova l'aplicació ara: https://beta-beta-five.vercel.app"
echo ""
echo "🎯 L'error 'Cannot access dom before initialization' ja està solucionat"
echo "✅ Ara el sistema d'errors funcionarà correctament"
