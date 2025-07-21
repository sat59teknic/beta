// ⚡ TEST RÁPIDO PARSER CORREGIDO
// Ejecutar: node test-parser.js

console.log('🚀 PROBANDO PARSER CORREGIDO...');

// Simular HTML real de Beta10 (basado en lo que vimos con Playwright)
const htmlReal = `
<div class="lista-partes">
    <ul>
        <li>
            <a href="/partes/28106/" class="enlace-parte">
                <h3>9TEKNIC BLANES S.L - (839) 9TEKNIC BLANES S.L (A25/2503 > 28106)</h3>
                <p><strong>AVIS ICO INTEGRAL</strong> - Test</p>
                <p>C/ CANIGÓ 21 - 08490 - TORDERA</p>
                <p>
                    <img src="/icono-hora.png" alt="Fecha fijada con el cliente">
                    <span class="texto-destacado">Fijado con el cliente para 20:48</span>
                </p>
            </a>
        </li>
    </ul>
</div>
`;

// Función extraerDatosDelEnlace (copiada del archivo)
function extraerDatosDelEnlace(contenido, numeroParteId) {
    try {
        const datos = {
            cliente: null,
            direccion: null,
            tipo: null,
            hora: null,
            subsistemas: [],
            codigoSistema: null,
            observaciones: ''
        };
        
        console.log(`🔍 Analizando contenido para parte ${numeroParteId}...`);
        
        // Extraer cliente desde <h3>
        const clienteMatch = contenido.match(/<h3[^>]*>([^<]+)<\/h3>/i);
        if (clienteMatch) {
            let clienteCompleto = clienteMatch[1].trim();
            console.log(`📋 Cliente completo encontrado: "${clienteCompleto}"`);
            
            // Extraer solo el nombre principal antes del primer " - "
            const nombrePrincipal = clienteCompleto.split(' - ')[0];
            datos.cliente = nombrePrincipal;
            
            // Extraer código entre paréntesis
            const codigoMatch = clienteCompleto.match(/\((\d+)\)/);
            if (codigoMatch) {
                datos.codigoSistema = codigoMatch[1];
            }
        }
        
        // Extraer tipo desde <p><strong>
        const tipoMatch = contenido.match(/<p><strong>([^<]+)<\/strong>([^<]*)<\/p>/i);
        if (tipoMatch) {
            datos.tipo = (tipoMatch[1] + (tipoMatch[2] || '')).trim();
        }
        
        // Extraer dirección
        const direccionMatch = contenido.match(/>([^<]*C\/[^<]+\d{5}[^<]*)</i);
        if (direccionMatch) {
            datos.direccion = direccionMatch[1].trim();
        }
        
        // Extraer hora
        const horaMatch = contenido.match(/Fijado con el cliente para (\d{1,2}:\d{2})/i);
        if (horaMatch) {
            datos.hora = horaMatch[1];
        }
        
        // Determinar subsistemas basado en el tipo
        if (datos.tipo) {
            const tipoUpper = datos.tipo.toUpperCase();
            if (tipoUpper.includes('ICO') || tipoUpper.includes('INTEGRAL')) {
                datos.subsistemas = ['INTRUSION', 'CCTV', 'INCENDI'];
            } else if (tipoUpper.includes('CCTV')) {
                datos.subsistemas = ['CCTV'];
            } else if (tipoUpper.includes('ALARMA') || tipoUpper.includes('INTRUSION')) {
                datos.subsistemas = ['INTRUSION'];
            } else {
                datos.subsistemas = ['GENERAL'];
            }
        }
        
        console.log(`✅ Datos extraídos exitosamente:`, datos);
        return datos;
        
    } catch (error) {
        console.error('❌ Error extrayendo datos del enlace:', error);
        return null;
    }
}

// EJECUTAR PRUEBA
console.log('\n🎯 EJECUTANDO PRUEBA...\n');

// Buscar enlace
const matches = htmlReal.match(/href=["']\/partes\/(\d+)\//g);
console.log('🔍 Enlaces encontrados:', matches);

if (matches && matches.length > 0) {
    const parteIdMatch = matches[0].match(/\/(\d+)\//);
    if (parteIdMatch) {
        const parteId = parteIdMatch[1];
        console.log(`🎯 Procesando parte ID: ${parteId}\n`);
        
        // Extraer datos
        const resultado = extraerDatosDelEnlace(htmlReal, parteId);
        
        if (resultado) {
            console.log('\n🎉 ¡PRUEBA EXITOSA!');
            console.log('📋 Resultado final:', {
                id: `parte_${parteId}`,
                cliente: resultado.cliente,
                direccion: resultado.direccion,
                tipo: resultado.tipo,
                hora: resultado.hora,
                subsistemas: resultado.subsistemas,
                codigo: resultado.codigoSistema
            });
        } else {
            console.log('\n❌ Error: No se pudieron extraer datos');
        }
    }
} else {
    console.log('❌ No se encontraron enlaces');
}

console.log('\n✅ TEST COMPLETADO');
