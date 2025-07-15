#!/bin/bash

echo "🌐 Deploying millores de connectivitat..."

git add .
git commit -m "🌐 Millor: Errors més comprensibles per l'usuari (No tens connexió a internet)"
git push origin main

echo "✅ Deploy completat!"
echo ""
echo "🔧 Millores implementades:"
echo "  ❌ 'Failed to fetch' → 'No tens connexió a internet'"
echo "  ❌ 'Timeout' → 'La connexió és massa lenta'"
echo "  ❌ 'HTTP 500' → 'Error del servidor'"
echo "  ❌ 'HTTP 401' → 'Credencials incorrectes'"
echo ""
echo "🧪 Testing URL: https://beta-beta-five.vercel.app"
