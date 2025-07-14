// api/health.js - Health check per verificar connectivitat

module.exports = async function handler(req, res) {
    // Headers CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        const timestamp = new Date().toISOString();
        
        return res.status(200).json({
            success: true,
            message: 'Backend Beta10 operatiu',
            timestamp: timestamp,
            version: 'V7 Empresarial',
            status: 'healthy'
        });
        
    } catch (error) {
        return res.status(500).json({
            success: false,
            error: 'Error intern del servidor',
            timestamp: new Date().toISOString()
        });
    }
}
