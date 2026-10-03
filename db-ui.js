/**
 * db-ui.js - Interfície d'Usuari per a visualitzar dades SQLite
 * Mostra hores extra mensuals totals, pauses diàries i gestió de la base de dades SQLite.
 */

class Beta10DBUI {
    constructor() {
        this.modalElement = null;
        this.activeTab = 'overtime'; // 'overtime', 'pauses', 'jornadas', 'db'
        this.selectedMonth = null;
    }

    init() {
        this.addHeaderButton();
    }

    addHeaderButton() {
        const header = document.querySelector('.header');
        if (!header) return;

        // Si ja existeix, no duplicar
        if (document.getElementById('db-stats-btn')) return;

        const statsBtn = document.createElement('button');
        statsBtn.id = 'db-stats-btn';
        statsBtn.className = 'account-btn stats-header-btn';
        statsBtn.innerHTML = '📊';
        statsBtn.title = 'Estadístiques & Historial SQLite';
        statsBtn.onclick = () => this.openStatsModal();

        // Inserir al costat del botó de compte o abans del gps
        const accountBtn = header.querySelector('.account-btn');
        if (accountBtn && accountBtn.nextSibling) {
            header.insertBefore(statsBtn, accountBtn.nextSibling);
        } else {
            const gpsStatus = document.getElementById('gps-status');
            header.insertBefore(statsBtn, gpsStatus);
        }
    }

    async openStatsModal() {
        await window.beta10DB.init();

        if (this.modalElement && document.body.contains(this.modalElement)) {
            document.body.removeChild(this.modalElement);
        }

        const modal = document.createElement('div');
        modal.className = 'modal-overlay db-modal-overlay';
        modal.id = 'db-stats-modal';
        modal.innerHTML = `
            <div class="modal-content db-modal-content">
                <div class="db-modal-header">
                    <div>
                        <h3>📊 Historial & Estadístiques</h3>
                        <p class="modal-subtitle">Base de dades local SQLite</p>
                    </div>
                    <button class="db-modal-close" id="db-modal-close-btn">&times;</button>
                </div>

                <div class="db-nav-tabs">
                    <button class="db-tab-btn active" data-tab="overtime">💰 Hores Extra</button>
                    <button class="db-tab-btn" data-tab="pauses">☕ Pauses Diàries</button>
                    <button class="db-tab-btn" data-tab="jornadas">📋 Jornades</button>
                    <button class="db-tab-btn" data-tab="db">💾 SQLite</button>
                </div>

                <div class="db-tab-content-container" id="db-tab-body">
                    <div class="db-loading-state">Carregant dades SQLite...</div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        this.modalElement = modal;

        // Listeners
        modal.querySelector('#db-modal-close-btn').onclick = () => this.closeStatsModal();
        modal.onclick = (e) => {
            if (e.target === modal) this.closeStatsModal();
        };

        const tabBtns = modal.querySelectorAll('.db-tab-btn');
        tabBtns.forEach(btn => {
            btn.onclick = () => {
                tabBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.activeTab = btn.getAttribute('data-tab');
                this.renderActiveTab();
            };
        });

        await this.renderActiveTab();
    }

    closeStatsModal() {
        if (this.modalElement && document.body.contains(this.modalElement)) {
            document.body.removeChild(this.modalElement);
            this.modalElement = null;
        }
    }

    async renderActiveTab() {
        const container = document.getElementById('db-tab-body');
        if (!container) return;

        container.innerHTML = '<div class="db-loading-state"><div class="spinner-small"></div> Carregant...</div>';

        try {
            switch (this.activeTab) {
                case 'overtime':
                    await this.renderOvertimeTab(container);
                    break;
                case 'pauses':
                    await this.renderPausesTab(container);
                    break;
                case 'jornadas':
                    await this.renderJornadasTab(container);
                    break;
                case 'db':
                    await this.renderDatabaseTab(container);
                    break;
            }
        } catch (err) {
            console.error('Error renderitzant pestanya:', err);
            container.innerHTML = `<div class="db-error-box">⚠️ Error carregant dades: ${err.message}</div>`;
        }
    }

    /**
     * PESTANYA 1: Hores Extra Mensuals amb Calendari Interactiu
     */
    async renderOvertimeTab(container) {
        const monthlySummary = await window.beta10DB.getMonthlyOvertimeSummary();

        if (monthlySummary.length === 0) {
            container.innerHTML = `
                <div class="db-empty-card">
                    <span class="db-empty-icon">⏳</span>
                    <h4>Sense Hores Extra</h4>
                    <p>Encara no s'ha registrat cap jornada amb hores extra (>30 min). Quan finalitzis jornades que superin l'horari habitual, apareixeran aquí sumades automàticament.</p>
                </div>
            `;
            return;
        }

        // Si no hi ha mes seleccionat, seleccionar el primer (més recent)
        if (!this.selectedMonth || !monthlySummary.some(m => m.month === this.selectedMonth)) {
            this.selectedMonth = monthlySummary[0].month;
        }

        const currentMonthIdx = monthlySummary.findIndex(m => m.month === this.selectedMonth);
        const currentMonthData = currentMonthIdx >= 0 ? monthlySummary[currentMonthIdx] : monthlySummary[0];
        const daysInMonth = await window.beta10DB.getOvertimeDaysForMonth(currentMonthData.month);

        const formatMonthName = (mStr) => {
            const [y, m] = mStr.split('-');
            const months = ['Gener', 'Febrer', 'Març', 'Abril', 'Maig', 'Juny', 'Juliol', 'Agost', 'Setembre', 'Octubre', 'Novembre', 'Desembre'];
            return `${months[parseInt(m, 10) - 1]} ${y}`;
        };

        const formatHoursMin = (decimalHours) => {
            const h = Math.floor(decimalHours);
            const m = Math.round((decimalHours % 1) * 60);
            if (h === 0) return `${m}min`;
            if (m === 0) return `${h}h`;
            return `${h}h ${m}min`;
        };

        let monthsOptionsHtml = monthlySummary.map(m => {
            const remH = m.total_remunerated_extra_hours !== undefined ? m.total_remunerated_extra_hours : m.total_extra_hours;
            const wrkH = m.total_worked_extra_hours !== undefined ? m.total_worked_extra_hours : m.total_extra_hours;
            return `
                <option value="${m.month}" ${m.month === this.selectedMonth ? 'selected' : ''}>
                    ${formatMonthName(m.month)} (💰 ${formatHoursMin(remH)} remunerades / 🕒 ${formatHoursMin(wrkH)} reals)
                </option>
            `;
        }).join('');

        // --- CONSTRUIR GRAELLA DE CALENDARI ---
        const [yNum, mNum] = currentMonthData.month.split('-').map(Number);
        const daysInCurrentMonth = new Date(yNum, mNum, 0).getDate();
        const firstDayIdx = new Date(yNum, mNum - 1, 1).getDay();
        const startDayOffset = firstDayIdx === 0 ? 6 : firstDayIdx - 1; // Dilluns = 0, Diumenge = 6

        // Mapa de dies amb hores extra
        const overtimeMap = new Map();
        daysInMonth.forEach(d => {
            overtimeMap.set(d.date, d);
        });

        const weekDayHeaders = ['Dl', 'Dm', 'Dc', 'Dj', 'Dv', 'Ds', 'Dg'];
        let calHeadersHtml = weekDayHeaders.map(w => `<div class="cal-th">${w}</div>`).join('');

        let calDaysHtml = '';
        // Cel·les buides abans del dia 1
        for (let i = 0; i < startDayOffset; i++) {
            calDaysHtml += `<div class="cal-day empty"></div>`;
        }

        for (let day = 1; day <= daysInCurrentMonth; day++) {
            const dayStr = String(day).padStart(2, '0');
            const dateStr = `${yNum}-${String(mNum).padStart(2, '0')}-${dayStr}`;
            const otData = overtimeMap.get(dateStr);
            const dateObj = new Date(yNum, mNum - 1, day);
            const isWeekend = dateObj.getDay() === 0 || dateObj.getDay() === 6;

            if (otData) {
                const wrkExt = Number(otData.extra_hours) || 0;
                const remExt = otData.remunerated_extra_hours !== undefined && otData.remunerated_extra_hours !== null
                    ? Number(otData.remunerated_extra_hours)
                    : Math.floor((wrkExt + 0.0001) / 0.5) * 0.5;

                calDaysHtml += `
                    <div class="cal-day has-overtime" data-date="${dateStr}" title="Dia ${day}: +${formatHoursMin(wrkExt)} treballades / +${formatHoursMin(remExt)} remunerades">
                        <span class="cal-date-num">${day}</span>
                        <span class="cal-ot-badge ${remExt > 0 ? 'cal-paid' : 'cal-unpaid'}">+${formatHoursMin(remExt > 0 ? remExt : wrkExt)}</span>
                        ${otData.observations ? '<span class="cal-dot-obs">💬</span>' : ''}
                    </div>
                `;
            } else {
                calDaysHtml += `
                    <div class="cal-day ${isWeekend ? 'is-weekend' : 'regular'}" data-date="${dateStr}">
                        <span class="cal-date-num">${day}</span>
                    </div>
                `;
            }
        }

        // --- CONSTRUIR TARGETES DE DETALL PER DIA ---
        let daysHtml = daysInMonth.map(d => {
            const dateObj = new Date(d.date + 'T12:00:00');
            const dayNames = ['Diumenge', 'Dilluns', 'Dimarts', 'Dimecres', 'Dijous', 'Divendres', 'Dissabte'];
            const dayName = dayNames[dateObj.getDay()];
            const [y, m, day] = d.date.split('-');
            const formattedDate = `${day}/${m}/${y}`;

            const workedExtra = Number(d.extra_hours) || 0;
            const remuneratedExtra = d.remunerated_extra_hours !== undefined && d.remunerated_extra_hours !== null
                ? Number(d.remunerated_extra_hours)
                : Math.floor((workedExtra + 0.0001) / 0.5) * 0.5;
            const unremuneratedMin = Math.max(0, Math.round((workedExtra - remuneratedExtra) * 60));

            return `
                <div class="db-overtime-day-card" data-card-date="${d.date}" id="card-date-${d.date}">
                    <div class="db-ot-day-header">
                        <div class="db-ot-day-title">
                            <span class="db-day-badge">${dayName}</span>
                            <strong>${formattedDate}</strong>
                        </div>
                        <div class="db-ot-badges-group">
                            <span class="db-extra-badge ${remuneratedExtra > 0 ? 'paid' : 'unpaid'}">💰 +${formatHoursMin(remuneratedExtra)} pagades</span>
                        </div>
                    </div>
                    <div class="db-ot-day-details">
                        <span>🕒 Treballat total: <b>${formatHoursMin(d.worked_hours)}</b></span>
                        <span>⏱️ Estàndard: <b>${d.standard_hours}h</b></span>
                        <span>⏳ Extra real: <b>+${formatHoursMin(workedExtra)}</b></span>
                        <span>💵 Extra remunerat: <b class="highlight-paid">+${formatHoursMin(remuneratedExtra)}</b></span>
                        ${unremuneratedMin > 0 ? `<span class="unremunerated-tag">⚠️ ${unremuneratedMin}m no remunerables</span>` : ''}
                        ${d.pause_minutes > 0 ? `<span>☕ Pauses: <b>${Math.round(d.pause_minutes)}m</b></span>` : ''}
                    </div>
                    ${d.observations ? `
                        <div class="db-ot-comment">
                            <span class="db-comment-icon">💬</span>
                            <span class="db-comment-text">${d.observations}</span>
                        </div>
                    ` : ''}
                </div>
            `;
        }).join('');

        const totalWorkedExtra = currentMonthData.total_worked_extra_hours ?? currentMonthData.total_extra_hours ?? 0;
        const totalRemuneratedExtra = currentMonthData.total_remunerated_extra_hours ?? currentMonthData.total_extra_hours ?? 0;

        container.innerHTML = `
            <div class="db-overtime-container">
                <div class="db-month-selector-row">
                    <label for="db-month-select">Mes seleccionat:</label>
                    <select id="db-month-select" class="db-select">
                        ${monthsOptionsHtml}
                    </select>
                </div>

                <!-- 🆕 2 APARTATS: HORES TREBALLADES I HORES REMUNERADES -->
                <div class="db-highlight-dual-grid">
                    <div class="db-highlight-card worked-card">
                        <div class="db-highlight-left">
                            <span class="db-highlight-label">🕒 Hores Extra Treballades</span>
                            <h2 class="db-highlight-number worked-num">+${formatHoursMin(totalWorkedExtra)}</h2>
                            <span class="db-highlight-subnote">Temps efectiu real per sobre de la jornada</span>
                        </div>
                        <div class="db-highlight-right">
                            <span class="db-badge-count">📅 ${currentMonthData.days_with_extra} dies</span>
                        </div>
                    </div>

                    <div class="db-highlight-card remunerated-card">
                        <div class="db-highlight-left">
                            <span class="db-highlight-label">💰 Hores Remunerades</span>
                            <h2 class="db-highlight-number remunerated-num">+${formatHoursMin(totalRemuneratedExtra)}</h2>
                            <span class="db-highlight-subnote">Blocs de 30m diaris (no acumulable entre dies)</span>
                        </div>
                        <div class="db-highlight-right">
                            <span class="db-badge-count remunerated-badge">💵 En nòmina</span>
                        </div>
                    </div>
                </div>

                <div class="db-rule-info-card">
                    <span class="db-info-icon">ℹ️</span>
                    <p><strong>Criteri de remuneració:</strong> Només es paguen blocs de 30 minuts per dia (>30m: 0,5h, 45m: 0,5h, <30m: 0h). Els minuts que no completen bloc es descarten i no s'acumulen entre dies.</p>
                </div>

                <!-- 📅 CALENDARI MENSUAL D'HORES EXTRA -->
                <div class="db-calendar-container">
                    <div class="db-cal-nav-bar">
                        <button id="db-cal-prev-month" class="db-cal-nav-btn" title="Mes anterior">◀</button>
                        <h4 class="db-cal-title">📅 ${formatMonthName(currentMonthData.month)}</h4>
                        <button id="db-cal-next-month" class="db-cal-nav-btn" title="Mes següent">▶</button>
                    </div>
                    <div class="db-calendar-grid">
                        ${calHeadersHtml}
                        ${calDaysHtml}
                    </div>
                    <div class="db-cal-legend">
                        <span class="legend-item"><span class="legend-dot ot"></span> Hores Extra (clic per veure detall)</span>
                        <span class="legend-item"><span class="legend-dot weekend"></span> Cap de setmana</span>
                    </div>
                </div>

                <h4 class="db-section-title">Desglossament per Dies (${daysInMonth.length})</h4>
                <div class="db-overtime-list">
                    ${daysHtml}
                </div>
            </div>
        `;

        // Navegació de mesos amb desplegable
        const selectElem = container.querySelector('#db-month-select');
        if (selectElem) {
            selectElem.onchange = (e) => {
                this.selectedMonth = e.target.value;
                this.renderActiveTab();
            };
        }

        // Navegació de mesos amb botons ◀ i ▶
        const prevBtn = container.querySelector('#db-cal-prev-month');
        const nextBtn = container.querySelector('#db-cal-next-month');
        if (prevBtn) {
            prevBtn.disabled = currentMonthIdx >= monthlySummary.length - 1;
            prevBtn.onclick = () => {
                if (currentMonthIdx < monthlySummary.length - 1) {
                    this.selectedMonth = monthlySummary[currentMonthIdx + 1].month;
                    this.renderActiveTab();
                }
            };
        }
        if (nextBtn) {
            nextBtn.disabled = currentMonthIdx <= 0;
            nextBtn.onclick = () => {
                if (currentMonthIdx > 0) {
                    this.selectedMonth = monthlySummary[currentMonthIdx - 1].month;
                    this.renderActiveTab();
                }
            };
        }

        // Clic a una cel·la del calendari amb hores extra: desplaçament suau i ressaltat
        container.querySelectorAll('.cal-day.has-overtime').forEach(el => {
            el.onclick = () => {
                const date = el.getAttribute('data-date');
                const targetCard = container.querySelector(`[data-card-date="${date}"]`);
                if (targetCard) {
                    targetCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    targetCard.classList.add('highlight-glow');
                    setTimeout(() => targetCard.classList.remove('highlight-glow'), 2000);
                }
            };
        });
    }

    /**
     * PESTANYA 2: Pauses Diàries
     */
    async renderPausesTab(container) {
        const pausesSummary = await window.beta10DB.getDailyPausesSummary(60);

        if (pausesSummary.length === 0) {
            container.innerHTML = `
                <div class="db-empty-card">
                    <span class="db-empty-icon">☕</span>
                    <h4>Sense Pauses Registrades</h4>
                    <p>Encara no s'ha guardat cap pausa a la base de dades SQLite. Quan facis pauses d'esmorzar o dinar, es guardaran i podran consultar-se aquí dia a dia.</p>
                </div>
            `;
            return;
        }

        const formatMin = (m) => {
            if (!m || m <= 0) return '0 min';
            const mins = Math.round(m);
            if (mins >= 60) {
                const hours = Math.floor(mins / 60);
                const rest = mins % 60;
                return rest > 0 ? `${hours}h ${rest}m` : `${hours}h`;
            }
            return `${mins} min`;
        };

        let listHtml = pausesSummary.map(day => {
            const dateObj = new Date(day.date + 'T12:00:00');
            const dayNames = ['Diumenge', 'Dilluns', 'Dimarts', 'Dimecres', 'Dijous', 'Divendres', 'Dissabte'];
            const dayName = dayNames[dateObj.getDay()];
            const [y, m, d] = day.date.split('-');
            const formattedDate = `${d}/${m}/${y}`;

            return `
                <div class="db-pause-day-card">
                    <div class="db-pause-header">
                        <div class="db-pause-date-group">
                            <span class="db-day-badge">${dayName}</span>
                            <strong>${formattedDate}</strong>
                        </div>
                        <span class="db-pause-total-badge">⏱️ Total: ${formatMin(day.total_pause_min)}</span>
                    </div>
                    <div class="db-pause-breakdown">
                        <div class="db-pause-item ${day.breakfast_min > 0 ? 'active-breakfast' : 'empty-item'}">
                            <span class="db-pause-icon">🥐</span>
                            <span class="db-pause-name">Esmorzar</span>
                            <span class="db-pause-val">${day.breakfast_min > 0 ? formatMin(day.breakfast_min) : 'No realitzat'}</span>
                        </div>
                        <div class="db-pause-item ${day.lunch_min > 0 ? 'active-lunch' : 'empty-item'}">
                            <span class="db-pause-icon">🍽️</span>
                            <span class="db-pause-name">Dinar</span>
                            <span class="db-pause-val">${day.lunch_min > 0 ? formatMin(day.lunch_min) : 'No realitzat'}</span>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        container.innerHTML = `
            <div class="db-pauses-container">
                <div class="db-section-header">
                    <h4>Temps de Pausa per Dia</h4>
                    <span class="db-badge-count">Últims ${pausesSummary.length} dies</span>
                </div>
                <div class="db-pauses-list">
                    ${listHtml}
                </div>
            </div>
        `;
    }

    /**
     * PESTANYA 3: Jornades
     */
    async renderJornadasTab(container) {
        const jornadas = await window.beta10DB.getRecentJornadas(40);

        if (jornadas.length === 0) {
            container.innerHTML = `
                <div class="db-empty-card">
                    <span class="db-empty-icon">📋</span>
                    <h4>Sense Jornades</h4>
                    <p>No hi ha jornades registrades encara a la base de dades SQLite.</p>
                </div>
            `;
            return;
        }

        const formatHoursMin = (decimalHours) => {
            const h = Math.floor(decimalHours);
            const m = Math.round((decimalHours % 1) * 60);
            if (h === 0) return `${m}min`;
            if (m === 0) return `${h}h`;
            return `${h}h ${m}min`;
        };

        const formatTimeOnly = (isoStr) => {
            if (!isoStr) return '--:--';
            try {
                const d = new Date(isoStr);
                return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            } catch (e) {
                return '--:--';
            }
        };

        let listHtml = jornadas.map(j => {
            const [y, m, d] = j.date.split('-');
            const formattedDate = `${d}/${m}/${y}`;
            const isAnomalousPause = j.pause_minutes > 60;

            return `
                <div class="db-jornada-card" data-jornada-id="${j.id}">
                    <div class="db-jornada-header">
                        <div>
                            <strong>${formattedDate}</strong>
                            <span class="db-jornada-type-badge">${j.type || 'JORNADA'}</span>
                        </div>
                        <div style="display:flex; align-items:center; gap:8px;">
                            ${j.extra_hours > 0 ? `<span class="db-extra-badge">+${formatHoursMin(j.extra_hours)} extra</span>` : '<span class="db-normal-badge">Habitual</span>'}
                            <button class="db-btn-delete-jornada" data-id="${j.id}" title="Eliminar registre" style="background:none; border:none; color:#ef4444; font-size:14px; cursor:pointer; padding:2px 6px;">🗑️</button>
                        </div>
                    </div>
                    <div class="db-jornada-body">
                        <div class="db-j-metric">
                            <span class="db-j-label">Horari</span>
                            <span class="db-j-val">${formatTimeOnly(j.start_time)} - ${formatTimeOnly(j.end_time)}</span>
                        </div>
                        <div class="db-j-metric">
                            <span class="db-j-label">Treballat</span>
                            <span class="db-j-val" id="val-worked-${j.id}">${formatHoursMin(j.worked_hours)}</span>
                        </div>
                        <div class="db-j-metric">
                            <span class="db-j-label">Pauses</span>
                            <span class="db-j-val ${isAnomalousPause ? 'val-anomalous' : ''}" id="val-pause-${j.id}">${Math.round(j.pause_minutes)}m</span>
                        </div>
                    </div>
                    ${isAnomalousPause ? `
                        <div style="margin: 8px 0; padding: 8px 12px; background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.4); border-radius: 8px; display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap;">
                            <span style="font-size: 12px; color: #fca5a5;">⚠️ Pausa excessiva (${Math.round(j.pause_minutes)}m detectats per error de xarxa)</span>
                            <button class="btn-fix-pause" data-id="${j.id}" data-worked="${j.worked_hours}" data-pause="${j.pause_minutes}" style="padding: 4px 10px; background: #22c55e; color: white; border: none; border-radius: 6px; font-size: 11.5px; font-weight: 700; cursor: pointer;">
                                🔧 Corregir a 15 min d'esmorzar
                            </button>
                        </div>
                    ` : ''}
                    ${j.observations ? `
                        <div class="db-ot-comment">
                            <span class="db-comment-icon">💬</span>
                            <span class="db-comment-text">${j.observations}</span>
                        </div>
                    ` : ''}
                </div>
            `;
        }).join('');

        container.innerHTML = `
            <div class="db-jornadas-container">
                <div class="db-section-header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                    <div>
                        <h4 style="margin:0;">Historial de Jornades</h4>
                        <span class="db-badge-count">Total: ${jornadas.length}</span>
                    </div>
                    <button class="btn btn-start" id="btn-add-manual-jornada" style="font-size:12px;padding:6px 12px;border-radius:8px;">
                        ➕ Afegir Manual
                    </button>
                </div>
                <div class="db-jornadas-list">
                    ${listHtml}
                </div>
            </div>
        `;

        const addManualBtn = container.querySelector('#btn-add-manual-jornada');
        if (addManualBtn) {
            addManualBtn.onclick = () => this.openAddManualJornadaModal();
        }

        // Listeners per corregir pauses anòmales (ex: 191m)
        container.querySelectorAll('.btn-fix-pause').forEach(btn => {
            btn.onclick = async () => {
                const id = btn.getAttribute('data-id');
                const oldWorked = parseFloat(btn.getAttribute('data-worked')) || 0;
                const oldPause = parseFloat(btn.getAttribute('data-pause')) || 0;
                const targetPause = 15; // 15 minuts d'esmorzar habitual
                const diffMinutes = Math.max(0, oldPause - targetPause);
                const newWorked = Math.round((oldWorked + (diffMinutes / 60)) * 100) / 100;

                if (confirm(`Vols corregir aquesta jornada?\n\n- Pausa: de ${Math.round(oldPause)}m a ${targetPause}m\n- Treballat: de ${formatHoursMin(oldWorked)} a ${formatHoursMin(newWorked)}`)) {
                    await window.beta10DB.updateJornada(id, {
                        worked_hours: newWorked,
                        extra_hours: 0,
                        pause_minutes: targetPause,
                        observations: '[Corregit desajust de xarxa a 15m pausa]'
                    });
                    await this.renderActiveTab();
                }
            };
        });

        // Listeners per eliminar jornades
        container.querySelectorAll('.db-btn-delete-jornada').forEach(btn => {
            btn.onclick = async () => {
                const id = btn.getAttribute('data-id');
                if (confirm('Segur que vols eliminar aquest registre de jornada de SQLite?')) {
                    await window.beta10DB.deleteJornada(id);
                    await this.renderActiveTab();
                }
            };
        });

    }

    /**
     * Modal per a afegir manualment una jornada (per si mai es vol registrar ahir o avui)
     */
    openAddManualJornadaModal() {
        const today = new Date().toISOString().split('T')[0];
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 420px; text-align: left;">
                <h3 style="margin-top:0;">➕ Afegir Jornada Manual</h3>
                <p class="modal-subtitle">Introdueix les dades de la jornada (ex: ahir o avui):</p>
                
                <div style="display:flex;flex-direction:column;gap:10px;margin:15px 0;">
                    <label style="font-size:13px;font-weight:600;">Data:
                        <input type="date" id="man-date" value="${today}" style="width:100%;padding:8px;border-radius:8px;border:1px solid #ccc;margin-top:4px;" />
                    </label>
                    <div style="display:flex;gap:10px;">
                        <label style="flex:1;font-size:13px;font-weight:600;">Inici (HH:MM):
                            <input type="time" id="man-start" value="08:00" style="width:100%;padding:8px;border-radius:8px;border:1px solid #ccc;margin-top:4px;" />
                        </label>
                        <label style="flex:1;font-size:13px;font-weight:600;">Final (HH:MM):
                            <input type="time" id="man-end" value="18:00" style="width:100%;padding:8px;border-radius:8px;border:1px solid #ccc;margin-top:4px;" />
                        </label>
                    </div>
                    <div style="display:flex;gap:10px;">
                        <label style="flex:1;font-size:13px;font-weight:600;">Hores Treballades:
                            <input type="number" step="0.1" id="man-worked" value="9.5" style="width:100%;padding:8px;border-radius:8px;border:1px solid #ccc;margin-top:4px;" />
                        </label>
                        <label style="flex:1;font-size:13px;font-weight:600;">Hores Extra Reals:
                            <input type="number" step="0.1" id="man-extra" value="0.5" style="width:100%;padding:8px;border-radius:8px;border:1px solid #ccc;margin-top:4px;" />
                        </label>
                    </div>
                    <label style="font-size:13px;font-weight:600;">Observacions / Feina:
                        <input type="text" id="man-obs" placeholder="Ex: Feina client XYZ" style="width:100%;padding:8px;border-radius:8px;border:1px solid #ccc;margin-top:4px;" />
                    </label>
                </div>

                <div class="modal-buttons" style="display:flex;gap:10px;justify-content:flex-end;">
                    <button class="btn btn-secondary" id="btn-cancel-man">Cancel·lar</button>
                    <button class="btn btn-start" id="btn-save-man">💾 Desar Jornada</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        modal.querySelector('#btn-cancel-man').onclick = () => modal.remove();
        modal.onclick = (e) => { if (e.target === modal) modal.remove(); };

        modal.querySelector('#btn-save-man').onclick = async () => {
            const dateVal = modal.querySelector('#man-date').value;
            const startVal = modal.querySelector('#man-start').value;
            const endVal = modal.querySelector('#man-end').value;
            const workedVal = parseFloat(modal.querySelector('#man-worked').value) || 0;
            const extraVal = parseFloat(modal.querySelector('#man-extra').value) || 0;
            const obsVal = modal.querySelector('#man-obs').value.trim();

            if (!dateVal) {
                alert('La data és obligatòria');
                return;
            }

            const startTime = new Date(`${dateVal}T${startVal || '08:00'}:00`);
            const endTime = new Date(`${dateVal}T${endVal || '17:00'}:00`);
            const remExtra = Math.floor((extraVal + 0.0001) / 0.5) * 0.5;

            await window.beta10DB.recordJornada({
                user: 'usuari',
                date: dateVal,
                startTime,
                endTime,
                type: 'JORNADA',
                dayType: 'Manual',
                standardHours: 9,
                workedHours: workedVal,
                extraHours: extraVal,
                remuneratedExtraHours: remExtra,
                pauseMinutes: 30,
                observations: obsVal || '[Jornada afegida manualment]'
            });

            modal.remove();
            alert('✅ Jornada desada correctament a la base de dades!');
            await this.renderActiveTab();
        };
    }

    /**
     * PESTANYA 4: Gestió Base de Dades SQLite
     */
    async renderDatabaseTab(container) {
        const stats = await window.beta10DB.getDatabaseStats();

        container.innerHTML = `
            <div class="db-manage-container">
                <div class="db-status-banner">
                    <span class="db-status-dot"></span>
                    <div>
                        <strong>SQLite Activa & Operativa</strong>
                        <p>sql.js (WebAssembly) amb emmagatzematge local segur</p>
                    </div>
                </div>

                <div class="db-stats-grid">
                    <div class="db-stat-box">
                        <span class="db-stat-number">${stats.jornadasCount}</span>
                        <span class="db-stat-label">Jornades Guardades</span>
                    </div>
                    <div class="db-stat-box">
                        <span class="db-stat-number">${stats.pausasCount}</span>
                        <span class="db-stat-label">Pauses Guardades</span>
                    </div>
                    <div class="db-stat-box">
                        <span class="db-stat-number">${stats.fichajesCount}</span>
                        <span class="db-stat-label">Fitxatges Registrats</span>
                    </div>
                    <div class="db-stat-box">
                        <span class="db-stat-number">${stats.sizeKb} KB</span>
                        <span class="db-stat-label">Mida Fitxer SQLite</span>
                    </div>
                </div>

                <div class="db-actions-box">
                    <h4>Exportació i Còpia de Seguretat</h4>
                    <p>Fes una còpia de seguretat o restaura-la per no perdre mai cap jornada ni hora extra encara que canviïs de mòbil o reinstal·lis.</p>
                    
                    <div style="display: flex; gap: 10px; flex-wrap: wrap; margin-top: 14px;">
                        <button class="btn btn-start db-download-btn" id="db-download-file-btn" style="flex: 1; min-width: 160px;">
                            📥 Descarregar Fitxer (.sqlite)
                        </button>
                        <button class="btn db-copy-btn" id="db-copy-base64-btn" style="flex: 1; min-width: 160px; background: #6366f1; color: white;">
                            📋 Copiar Còpia (Text)
                        </button>
                    </div>

                    <h4 style="margin-top: 20px;">Restaurar Dades</h4>
                    <p>Restaura la teva base de dades a partir d'un fitxer <code>.sqlite</code> o enganxant el text de la còpia:</p>

                    <div style="display: flex; gap: 10px; flex-wrap: wrap; margin-top: 10px;">
                        <button class="btn btn-secondary db-upload-btn" id="db-upload-file-btn" style="flex: 1; min-width: 160px; background: #0284c7; color: white;">
                            📤 Restaurar Fitxer (.sqlite)
                        </button>
                        <button class="btn db-restore-text-btn" id="db-restore-text-btn" style="flex: 1; min-width: 160px; background: #059669; color: white;">
                            📋 Restaurar des de Text
                        </button>
                        <input type="file" id="db-file-input" accept=".sqlite,.db" style="display: none;" />
                    </div>
                </div>
            </div>
        `;

        const downloadBtn = container.querySelector('#db-download-file-btn');
        if (downloadBtn) {
            downloadBtn.onclick = async () => {
                downloadBtn.disabled = true;
                downloadBtn.textContent = 'Preparant...';
                try {
                    const res = await window.beta10DB.downloadDatabaseFile();
                    if (res && res.method === 'share') {
                        // Obert menú natiu de compartir / desar d'Android
                    } else {
                        alert('✅ Còpia de seguretat .sqlite preparada per a la descàrrega!');
                    }
                } catch (e) {
                    alert('Error en descarregar: ' + e.message);
                } finally {
                    downloadBtn.disabled = false;
                    downloadBtn.textContent = '📥 Descarregar Fitxer (.sqlite)';
                }
            };
        }

        const copyBase64Btn = container.querySelector('#db-copy-base64-btn');
        if (copyBase64Btn) {
            copyBase64Btn.onclick = async () => {
                try {
                    const b64 = await window.beta10DB.exportDatabaseAsBase64();
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                        await navigator.clipboard.writeText(b64);
                        alert('✅ Còpia de seguretat copiada al portapapers en text! Pots enganxar-la a WhatsApp, Bloc de notes o correu per a guardar-la.');
                    } else {
                        prompt('Copia aquest text per desar la teva còpia de seguretat:', b64);
                    }
                } catch (e) {
                    alert('Error en copiar: ' + e.message);
                }
            };
        }

        const restoreTextBtn = container.querySelector('#db-restore-text-btn');
        if (restoreTextBtn) {
            restoreTextBtn.onclick = async () => {
                const text = prompt('Enganxa aquí el text de la còpia de seguretat (Base64) que vas copiar anteriorment:');
                if (!text || !text.trim()) return;

                try {
                    await window.beta10DB.importDatabaseFromBase64(text);
                    alert('✅ Base de dades restaurada correctament des del text! Totes les jornades i hores extra s\'han recuperat.');
                    await this.renderActiveTab();
                } catch (e) {
                    alert('❌ Error restaurant des de text: ' + e.message);
                }
            };
        }

        const uploadBtn = container.querySelector('#db-upload-file-btn');
        const fileInput = container.querySelector('#db-file-input');
        if (uploadBtn && fileInput) {
            uploadBtn.onclick = () => fileInput.click();
            fileInput.onchange = async () => {
                const file = fileInput.files[0];
                if (!file) return;

                if (!confirm(`Vols restaurar la base de dades des del fitxer "${file.name}"? Això recuperarà totes les jornades i hores extra d'aquesta còpia.`)) {
                    fileInput.value = '';
                    return;
                }

                uploadBtn.disabled = true;
                uploadBtn.textContent = 'Restaurant dades...';
                try {
                    const arrayBuffer = await file.arrayBuffer();
                    await window.beta10DB.importDatabaseFile(arrayBuffer);
                    alert('✅ Base de dades restaurada amb èxit! Totes les teves jornades i hores extra s\'han recuperat.');
                    await this.renderActiveTab();
                } catch (err) {
                    alert('❌ Error restaurant la còpia: ' + err.message);
                } finally {
                    uploadBtn.disabled = false;
                    uploadBtn.textContent = '📤 Restaurar Fitxer (.sqlite)';
                    fileInput.value = '';
                }
            };
        }
    }
}

// Instància global
window.beta10DBUI = new Beta10DBUI();
