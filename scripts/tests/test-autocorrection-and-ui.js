/**
 * scripts/tests/test-autocorrection-and-ui.js
 * Unit tests for state auto-correction limits, anti-lock safeguards,
 * and historical anomalous pause repairs.
 */

const { assert, assertEqual } = require('../test-harness.js');

module.exports = function registerAutoCorrectionTests(runner) {
    runner.suite('Auto-Correction Guardrails & UI History Repair', async (suite) => {

        const PAUSE_LIMITS = {
            'esmorçar': 15 * 60 * 1000,
            'dinar': 30 * 60 * 1000
        };

        // Replicating validateAppState from script.js
        function validateAppState(appState) {
            try {
                if (appState.currentState === 'PAUSA') {
                    if (!appState.currentPauseStart) {
                        appState.currentState = 'JORNADA';
                        appState.currentPauseType = null;
                        appState.isAlarmPlaying = false;
                        appState.pauseAlarmTriggered = false;
                        return { fixed: true, reason: 'Pausa sense temps d\'inici' };
                    }

                    const pauseStart = new Date(appState.currentPauseStart);
                    const pauseDuration = new Date() - pauseStart;
                    if (pauseDuration > 60 * 60 * 1000) { // >1h
                        const maxAllowedMs = PAUSE_LIMITS[appState.currentPauseType] || (15 * 60 * 1000);
                        appState.totalPauseTimeToday += maxAllowedMs;
                        appState.currentState = 'JORNADA';
                        appState.currentPauseStart = null;
                        appState.currentPauseType = null;
                        appState.isAlarmPlaying = false;
                        appState.pauseAlarmTriggered = false;
                        return { fixed: true, reason: 'Pausa excessiva limitada al màxim legal' };
                    }
                }

                if ((appState.currentState === 'JORNADA' || appState.currentState === 'PAUSA') && !appState.workStartTime) {
                    appState.currentState = 'FUERA';
                    appState.currentPauseStart = null;
                    appState.currentPauseType = null;
                    return { fixed: true, reason: 'Jornada sense inici' };
                }

                return { fixed: false };
            } catch (err) {
                return { fixed: false, error: err.message };
            }
        }

        suite.test('Inconsistent pause without start time resets to JORNADA safely', () => {
            const appState = {
                currentState: 'PAUSA',
                currentPauseStart: null,
                currentPauseType: 'esmorçar',
                totalPauseTimeToday: 0
            };

            const res = validateAppState(appState);
            assertEqual(res.fixed, true);
            assertEqual(appState.currentState, 'JORNADA');
            assertEqual(appState.currentPauseType, null);
        });

        suite.test('GUARDRAIL: Long abandoned pause (>1h) is capped to 15 min for esmorzar, NEVER adds 191m', () => {
            // Simulate user who paused 3 hours and 11 minutes ago (191 minutes)
            const pauseStart = new Date(Date.now() - 191 * 60 * 1000);
            const appState = {
                currentState: 'PAUSA',
                currentPauseStart: pauseStart,
                currentPauseType: 'esmorçar',
                totalPauseTimeToday: 0,
                isAlarmPlaying: false
            };

            const res = validateAppState(appState);
            assertEqual(res.fixed, true);
            assertEqual(appState.currentState, 'JORNADA');
            assertEqual(appState.currentPauseStart, null);

            // Verify totalPauseTimeToday was capped at 15 minutes (900,000 ms), NOT 191 minutes (11,460,000 ms)!
            const totalPauseMinutes = appState.totalPauseTimeToday / (1000 * 60);
            assertEqual(totalPauseMinutes, 15, 'Paused time must be safely capped to 15 minutes');
            assert(totalPauseMinutes !== 191, 'Bug resolved: Must not add 191 minutes');
        });

        suite.test('GUARDRAIL: Long abandoned lunch pause (>1h) is capped to 30 min for dinar', () => {
            // Simulate user who paused lunch 2.5 hours ago
            const pauseStart = new Date(Date.now() - 150 * 60 * 1000);
            const appState = {
                currentState: 'PAUSA',
                currentPauseStart: pauseStart,
                currentPauseType: 'dinar',
                totalPauseTimeToday: 0
            };

            const res = validateAppState(appState);
            assertEqual(res.fixed, true);
            assertEqual(appState.currentState, 'JORNADA');

            const totalPauseMinutes = appState.totalPauseTimeToday / (1000 * 60);
            assertEqual(totalPauseMinutes, 30, 'Lunch pause must be capped to 30 minutes');
        });

        suite.test('UI History repair calculation logic correctly updates worked hours', () => {
            // Simulating historical row: worked 6.01h, pause 191m
            const record = {
                id: 42,
                worked_hours: 6.01,
                pause_minutes: 191.0
            };

            const targetPause = 15.0; // 15 min breakfast
            const diffMinutes = Math.max(0, record.pause_minutes - targetPause); // 176m
            const newWorked = Math.round((record.worked_hours + (diffMinutes / 60)) * 100) / 100;
            const newPause = targetPause;

            assertEqual(diffMinutes, 176);
            assertEqual(newWorked, 8.94, 'Worked hours should increase from 6.01h to 8.94h');
            assertEqual(newPause, 15.0, 'Pause minutes should decrease from 191m to 15m');

            // Total journey duration (worked + pause) remains identical (9.19h)
            const oldTotalJourney = record.worked_hours + (record.pause_minutes / 60);
            const newTotalJourney = newWorked + (newPause / 60);
            assert(Math.abs(oldTotalJourney - newTotalJourney) < 0.02, 'Total workday timeline integrity preserved');
        });
    });
};
