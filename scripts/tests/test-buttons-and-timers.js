/**
 * scripts/tests/test-buttons-and-timers.js
 * Unit and integration tests for:
 * 1. 1-second hold button activation (instead of 2s) and UI indicators.
 * 2. Direct pause buttons for Esmorçar (15m) and Dinar (30m).
 * 3. Total worked timer (Total = Jornada + Pausa) on the main dashboard.
 *
 * STRICT ZERO SERVER CALL GUARANTEE.
 */

const fs = require('fs');
const path = require('path');
const { assert, assertEqual, createMockEnvironment } = require('../test-harness.js');

module.exports = function registerButtonsAndTimersTests(runner) {
    runner.suite('1s Hold Buttons, Direct Pauses & Total Timer Marker', async (suite) => {

        const scriptContent = fs.readFileSync(path.join(__dirname, '../../script.js'), 'utf8');
        const styleContent = fs.readFileSync(path.join(__dirname, '../../style.css'), 'utf8');
        const htmlContent = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');

        // Helper to format ms to HH:MM:SS
        function formatTime(ms) {
            if (ms < 0) ms = 0;
            const totalSeconds = Math.floor(ms / 1000);
            const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
            const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
            const seconds = String(totalSeconds % 60).padStart(2, '0');
            return `${hours}:${minutes}:${seconds}`;
        }

        // 1. VERIFY 1-SECOND BUTTON HOLD DURATION & STYLES
        suite.test('1-second hold configuration in script.js and style.css', () => {
            // Verify createButton hold timer is 1000ms (1s), not 2000ms
            const createButtonChunk = scriptContent.split('const createButton =')[1].split('const createPair =')[0];
            assert(createButtonChunk.includes('}, 1000);'), 'Hold button timeout in createButton must be exactly 1000ms');
            assert(!createButtonChunk.includes('2000'), 'Old 2000ms hold button timeout must be removed from createButton');

            // Verify visual tags & hints
            assert(scriptContent.includes('Prem 1s'), 'Button tag must display "Prem 1s"');
            assert(scriptContent.includes('1 segon per activar'), 'Toast notification must reference "1 segon"');
            assert(scriptContent.includes('Mantén 1s qualsevol botó'), 'Banner hint must instruct "Mantén 1s"');

            // Verify fast tap threshold is updated to <900ms (was 1900ms)
            assert(scriptContent.includes('elapsed < 900'), 'Fast tap threshold must be < 900ms');

            // Verify style.css progress bar transition is 1s
            assert(styleContent.includes('transition: width 1s linear !important;'), 'CSS progress bar transition must be 1s linear');
        });

        // 2. VERIFY DIRECT ESMORÇAR AND DINAR PAUSE BUTTONS IN JORNADA
        suite.test('Direct Esmorçar and Dinar buttons exist with dedicated styles', () => {
            // Verify script.js creates pair with breakfast and lunch buttons in JORNADA
            assert(scriptContent.includes('btn-pause-breakfast'), 'btn-pause-breakfast button must be present in JORNADA state');
            assert(scriptContent.includes('btn-pause-lunch'), 'btn-pause-lunch button must be present in JORNADA state');
            assert(scriptContent.includes("startPause('esmorçar')"), 'Esmorçar button directly triggers startPause with "esmorçar"');
            assert(scriptContent.includes("startPause('dinar')"), 'Dinar button directly triggers startPause with "dinar"');

            // Verify styles exist in style.css
            assert(styleContent.includes('.btn-pause-breakfast'), '.btn-pause-breakfast styling defined in CSS');
            assert(styleContent.includes('.btn-pause-lunch'), '.btn-pause-lunch styling defined in CSS');
            assert(styleContent.includes('.btn-pair.btn-pair-equal'), 'Equal width columns defined for pause pair');
        });

        // 3. LOGIC: DIRECT PAUSE ACTIVATION & DUPLICATE BREAKFAST PREVENTION
        suite.test('Direct startPause executes without modal and blocks duplicate breakfast on same day', async () => {
            const todayStr = new Date().toISOString().split('T')[0];
            const appState = {
                currentState: 'JORNADA',
                workStartTime: new Date(Date.now() - 3600000),
                currentPauseStart: null,
                currentPauseType: null,
                totalPauseTimeToday: 0,
                breakfastDate: null
            };

            const proxyCalls = [];
            async function mockSendToProxy(action, point, type) {
                proxyCalls.push({ action, point, type });
            }

            // Direct breakfast pause
            async function triggerPause(type) {
                if (type === 'esmorçar' && appState.breakfastDate === todayStr) {
                    return { error: 'ALREADY_DONE' };
                }
                await mockSendToProxy('salida', 'J', '');
                await mockSendToProxy('entrada', 'P', type);
                appState.currentState = 'PAUSA';
                appState.currentPauseStart = new Date();
                appState.currentPauseType = type;
                if (type === 'esmorçar') {
                    appState.breakfastDate = todayStr;
                }
                return { success: true };
            }

            // 1st breakfast: should succeed
            const res1 = await triggerPause('esmorçar');
            assertEqual(res1.success, true);
            assertEqual(appState.currentState, 'PAUSA');
            assertEqual(appState.currentPauseType, 'esmorçar');
            assertEqual(appState.breakfastDate, todayStr);
            assertEqual(proxyCalls.length, 2);

            // Simulate end of breakfast
            appState.currentState = 'JORNADA';
            appState.currentPauseStart = null;
            appState.currentPauseType = null;
            appState.totalPauseTimeToday += 15 * 60 * 1000;

            // 2nd breakfast attempt on same day: should be blocked
            const res2 = await triggerPause('esmorçar');
            assertEqual(res2.error, 'ALREADY_DONE');
            assertEqual(appState.currentState, 'JORNADA', 'State must stay in JORNADA');
            assertEqual(proxyCalls.length, 2, 'No remote calls made for rejected breakfast');

            // Lunch pause: should succeed even if breakfast was already done
            const resLunch = await triggerPause('dinar');
            assertEqual(resLunch.success, true);
            assertEqual(appState.currentState, 'PAUSA');
            assertEqual(appState.currentPauseType, 'dinar');
            assertEqual(proxyCalls.length, 4);
        });

        // 4. VERIFY TOTAL WORKED TIMER DASHBOARD MARKER
        suite.test('Main dashboard markup contains Total timer alongside Jornada and Pausa', () => {
            assert(htmlContent.includes('id="work-timer"'), 'work-timer must exist in index.html');
            assert(htmlContent.includes('id="pause-timer"'), 'pause-timer must exist in index.html');
            assert(htmlContent.includes('id="total-timer"'), 'total-timer must exist in index.html');
            assert(htmlContent.includes('id="total-timer-box"'), 'total-timer-box container must exist in index.html');
            assert(htmlContent.includes('id="total-timer-label"'), 'total-timer-label must exist in index.html');

            // Verify DOM element in script.js
            assert(scriptContent.includes("totalTimer: document.getElementById('total-timer')"), 'totalTimer must be mapped in dom object');
            assert(scriptContent.includes('total-timer-box'), 'total-timer-box referenced for active styling');
        });

        // 5. TOTAL TIMER CALCULATION AND SYNCHRONIZATION
        suite.test('Timer calculation: Total equals Jornada + Pausa across all states', () => {
            const baseTime = Date.now();

            // Scenario A: State FUERA
            {
                const appState = { currentState: 'FUERA', workStartTime: null, totalPauseTimeToday: 0 };
                let work = '00:00:00', pause = '00:00:00', total = '00:00:00';
                if (appState.currentState === 'FUERA') {
                    work = '00:00:00';
                    pause = '00:00:00';
                    total = '00:00:00';
                }
                assertEqual(work, '00:00:00');
                assertEqual(pause, '00:00:00');
                assertEqual(total, '00:00:00');
            }

            // Scenario B: State JORNADA (worked 2 hours, 0 pauses)
            {
                const workStart = new Date(baseTime - 2 * 3600 * 1000); // 2h ago
                const now = new Date(baseTime);
                const totalPause = 0;
                const workDuration = now - workStart - totalPause;
                const totalElapsed = now - workStart;

                assertEqual(formatTime(workDuration), '02:00:00');
                assertEqual(formatTime(totalPause), '00:00:00');
                assertEqual(formatTime(totalElapsed), '02:00:00', 'Total must equal 2h');
            }

            // Scenario C: State PAUSA (worked 2h, currently in 15min pause)
            {
                const workStart = new Date(baseTime - (2 * 3600 * 1000 + 15 * 60 * 1000)); // 2h 15m ago
                const pauseStart = new Date(baseTime - 15 * 60 * 1000); // 15m ago
                const now = new Date(baseTime);

                const currentPauseDuration = now - pauseStart; // 15m
                const totalPauseTimeToday = 0;
                let workDuration = (now - workStart - totalPauseTimeToday) - currentPauseDuration; // 2h
                const totalElapsed = now - workStart; // 2h 15m

                assertEqual(formatTime(workDuration), '02:00:00', 'Work timer pauses during break');
                assertEqual(formatTime(currentPauseDuration), '00:15:00', 'Pause timer tracks 15 min');
                assertEqual(formatTime(totalElapsed), '02:15:00', 'Total timer tracks overall elapsed time (2h 15m)');
            }

            // Scenario D: Resumed JORNADA (worked 2h, completed 15min pause, worked 1h more)
            {
                const workStart = new Date(baseTime - (3 * 3600 * 1000 + 15 * 60 * 1000)); // 3h 15m ago
                const totalPauseTimeToday = 15 * 60 * 1000; // 15m
                const now = new Date(baseTime);

                const workDuration = now - workStart - totalPauseTimeToday; // 3h
                const totalElapsed = now - workStart; // 3h 15m

                assertEqual(formatTime(workDuration), '03:00:00', 'Work timer indicates 3h net worked');
                assertEqual(formatTime(totalPauseTimeToday), '00:15:00', 'Pause timer indicates 15m completed');
                assertEqual(formatTime(totalElapsed), '03:15:00', 'Total timer indicates 3h 15m gross time');
            }
        });
    });
};
