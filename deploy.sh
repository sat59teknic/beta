#!/bin/bash

echo "🚀 Deploying Beta10 amb debugging millorat..."

git add .
git commit -m "🔧 Debug: Millorat test-auth amb més logging i validacions"
git push origin main

echo "✅ Deploy completat!"
echo "🧪 Testing URLs:"
echo "  Health: https://beta-beta-five.vercel.app/api/health"
echo "  App: https://beta-beta-five.vercel.app"
echo ""
echo "📋 Per debuggar:"
echo "  1. Obre https://beta-beta-five.vercel.app"
echo "  2. Prem F12 → Console"
echo "  3. Intenta fer login"
echo "  4. Revisa logs de Vercel Dashboard → Functions → View Logs"
