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
     * PESTANYA 1: Hores Extra Mensuals
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

        const currentMonthData = monthlySummary.find(m => m.month === this.selectedMonth) || monthlySummary[0];
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

        let monthsOptionsHtml = monthlySummary.map(m => `
            <option value="${m.month}" ${m.month === this.selectedMonth ? 'selected' : ''}>
                ${formatMonthName(m.month)} (${formatHoursMin(m.total_extra_hours)})
            </option>
        `).join('');

        let daysHtml = daysInMonth.map(d => {
            const dateObj = new Date(d.date + 'T12:00:00');
            const dayNames = ['Diumenge', 'Dilluns', 'Dimarts', 'Dimecres', 'Dijous', 'Divendres', 'Dissabte'];
            const dayName = dayNames[dateObj.getDay()];
            const [y, m, day] = d.date.split('-');
            const formattedDate = `${day}/${m}/${y}`;

            return `
                <div class="db-overtime-day-card">
                    <div class="db-ot-day-header">
                        <div class="db-ot-day-title">
                            <span class="db-day-badge">${dayName}</span>
                            <strong>${formattedDate}</strong>
                        </div>
                        <span class="db-extra-badge">+${formatHoursMin(d.extra_hours)}</span>
                    </div>
                    <div class="db-ot-day-details">
                        <span>🕒 Treballat: <b>${formatHoursMin(d.worked_hours)}</b></span>
                        <span>⏱️ Estàndard: <b>${d.standard_hours}h</b></span>
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

        container.innerHTML = `
            <div class="db-overtime-container">
                <div class="db-month-selector-row">
                    <label for="db-month-select">Mes seleccionat:</label>
                    <select id="db-month-select" class="db-select">
                        ${monthsOptionsHtml}
                    </select>
                </div>

                <div class="db-highlight-card">
                    <div class="db-highlight-left">
                        <span class="db-highlight-label">TOTAL HORES EXTRA (${formatMonthName(currentMonthData.month)})</span>
                        <h2 class="db-highlight-number">+${formatHoursMin(currentMonthData.total_extra_hours)}</h2>
                    </div>
                    <div class="db-highlight-right">
                        <span class="db-badge-count">📅 ${currentMonthData.days_with_extra} dies</span>
                    </div>
                </div>

                <h4 class="db-section-title">Desglossament per Dies</h4>
                <div class="db-overtime-list">
                    ${daysHtml}
                </div>
            </div>
        `;

        const selectElem = container.querySelector('#db-month-select');
        if (selectElem) {
            selectElem.onchange = (e) => {
                this.selectedMonth = e.target.value;
                this.renderActiveTab();
            };
        }
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

            return `
                <div class="db-jornada-card">
                    <div class="db-jornada-header">
                        <div>
                            <strong>${formattedDate}</strong>
                            <span class="db-jornada-type-badge">${j.type || 'JORNADA'}</span>
                        </div>
                        ${j.extra_hours > 0 ? `<span class="db-extra-badge">+${formatHoursMin(j.extra_hours)} extra</span>` : '<span class="db-normal-badge">Habitual</span>'}
                    </div>
                    <div class="db-jornada-body">
                        <div class="db-j-metric">
                            <span class="db-j-label">Horari</span>
                            <span class="db-j-val">${formatTimeOnly(j.start_time)} - ${formatTimeOnly(j.end_time)}</span>
                        </div>
                        <div class="db-j-metric">
                            <span class="db-j-label">Treballat</span>
                            <span class="db-j-val">${formatHoursMin(j.worked_hours)}</span>
                        </div>
                        <div class="db-j-metric">
                            <span class="db-j-label">Pauses</span>
                            <span class="db-j-val">${Math.round(j.pause_minutes)}m</span>
                        </div>
                    </div>
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
                <div class="db-section-header">
                    <h4>Historial de Jornades</h4>
                    <span class="db-badge-count">Total: ${jornadas.length}</span>
                </div>
                <div class="db-jornadas-list">
                    ${listHtml}
                </div>
            </div>
        `;
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
                    <p>Pots descarregar el fitxer real de la base de dades <code>.sqlite</code> per a visualitzar-lo amb SQLite Viewer, DBeaver o tenir còpia de seguretat externa.</p>
                    <button class="btn btn-start db-download-btn" id="db-download-file-btn">
                        📥 Descarregar Fitxer .sqlite
                    </button>
                </div>
            </div>
        `;

        const downloadBtn = container.querySelector('#db-download-file-btn');
        if (downloadBtn) {
            downloadBtn.onclick = async () => {
                downloadBtn.disabled = true;
                downloadBtn.textContent = 'Generant fitxer...';
                try {
                    await window.beta10DB.downloadDatabaseFile();
                } catch (e) {
                    alert('Error en descarregar: ' + e.message);
                } finally {
                    downloadBtn.disabled = false;
                    downloadBtn.textContent = '📥 Descarregar Fitxer .sqlite';
                }
            };
        }
    }
}

// Instància global
window.beta10DBUI = new Beta10DBUI();
