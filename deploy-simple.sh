#!/bin/bash

echo "🔧 Arreglant error de inicialització - VERSIÓ SIMPLE..."

git add .
git commit -m "🔧 Fix: Simplificat per evitar errors d'inicialització"
git push origin main

echo "✅ Error arreglat amb versió simplificada!"
echo "📱 Prova l'aplicació ara: https://beta-beta-five.vercel.app"
echo ""
echo "🎯 Canvis realitzats:"
echo "  ✅ Eliminat errorManager que causava problemes"
echo "  ✅ Tornat a sistema d'alerts simple però funcional"
echo "  ✅ Missatges traduïts a català dins del codi"
echo "  ✅ L'aplicació hauria de funcionar normalment ara"
echo ""
echo "⚠️  Nota: Els errors segueixen traduïts a català, però amb alerts en lloc de toasts"
