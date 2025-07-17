# 🏢 9T Beta10 Control - Versió Empresarial

## 👥 CONFIGURACIÓ PER MÚLTIPLES EMPLEATS

### ✅ Característiques
- **Login individual** - Cada empleat usa les seves credencials Beta10
- **Seguretat màxima** - No hi ha credencials fixades al servidor  
- **Escalable** - Funciona per a tota l'empresa
- **Multiidioma** - Interfície completament en català

### 🔐 Sistema d'Autenticació
- Cada empleat introdueix les seves credencials Beta10
- Les credencials es guarden localment (navegador)
- Login automàtic en sessions posteriors
- Logout manual disponible

### ⏰ Sistema d'Hores Extra CORREGIT
- **Jornada estàndard**: 9 hores (treball + pausa)
- **Hores extra**: A partir de +30 minuts després de 9h
- **Format observacions**: `+30min Joan Molina` o `+1h Recuperauto`
- **Increments**: De 30 en 30 minuts

### 📱 Distribució
1. **URL**: https://tu-proyecto.vercel.app  
2. **PWA**: Instal·lable com a app nativa
3. **Compatibilitat**: Tots els navegadors moderns

### 🔧 Manteniment
- **Sense variables d'entorn** - No cal configurar credencials al servidor
- **Deploy automàtic** - Git push → Vercel actualitza automàticament
- **Logs complets** - Vercel Dashboard per debugging

### 👨‍💼 Instruccions per Empleats
1. Obrir https://tu-proyecto.vercel.app
2. Introduir credencials Beta10 personals
3. Permetre GPS quan ho demani
4. Usar els botons per fitxar normalment

### 📊 Estats Disponibles
- **Fora de Jornada** → Estat inicial/final
- **En Magatzem** → Treballant al magatzem (punt 9)
- **En Jornada** → Treballant efectivament (punt J)  
- **En Pausa** → Descans/dinar (punt P)

### 🚨 Alarmes
- **10 minuts** → Pausa mínima completada (suau)
- **14 minuts** → Pausa excessiva (forta + vibració)

### 🔧 Millores V10 - Alarmes Ultra-Fiables
- **Wake Lock API** → Manté la pantalla activa durant la pausa
- **Notificacions del sistema** → Alarmes que funcionen encara que l'app estigui en background
- **Service Worker millorat** → Notificacions programades independents de l'app
- **Alarmes múltiples** → So + vibració + notificació + repetició cada 30s
- **Recuperació d'estat** → Reprograma alarmes si recarregues la pàgina
- **Detecció de background** → Avisa quan l'app pot perdre funcionament
- **Permisos automàtics** → Sol·licita permisos de notificació a l'inici
- **Instruccions clares** → Missatges visuals per mantenir l'app oberta

### 🔧 Millores V9 - Sistema de Pausas Diferenciades
- **Selecció de pausa** → Modal per triar: Esmorçar (10min) o Dinar (30min)
- **Observacions automàtiques** → S'afegeix "esmorçar" o "dinar" segons la pausa
- **Alarmes específiques** → Esmorçar: 10min, Dinar: 30min (soó fort únic)
- **Indicador visual** → Mostra el tipus de pausa actual a la UI
- **Sortida lliure** → Pots sortir de qualsevol pausa quan vulguis

### 🔧 Millores V8
- **Botó Finalitzar Jornada** → Deshabilitat durant pausa per evitar confusió
- **Sortir de pausa** → Sense temps mínim, sortida lliure quan vulguis
- **Flux correcte** → Pausa → Jornada → Finalitzar (seqüència obligatòria)

---

✅ **Sistema operatiu i llest per a ús empresarial - V10 Alarmes Ultra-Fiables**
