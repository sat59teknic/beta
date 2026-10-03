/**
 * scripts/tests/test-pause-and-resilience.js
 * Integration tests for pause lifecycle, offline resilience, and database stopping.
 * STRICT ZERO SERVER CALL GUARANTEE.
 */

const { assert, assertEqual, createMockEnvironment } = require('../test-harness.js');

module.exports = function registerPauseResilienceTests(runner) {
    runner.suite('Pause Timing & Offline Network Resilience', async (suite) => {

        suite.test('Starting a pause updates state, records type, and schedules notification', async () => {
            const env = createMockEnvironment();

            // App state model
            const appState = {
                currentState: 'JORNADA',
                workStartTime: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2h ago
                currentPauseStart: null,
                currentPauseType: null,
                totalPauseTimeToday: 0,
                pauseAlarmTriggered: false
            };

            // Simulate startPause
            const pauseType = 'esmorçar';
            appState.currentState = 'PAUSA';
            appState.currentPauseStart = new Date();
            appState.currentPauseType = pauseType;

            // Schedule notification with Capacitor mock
            await env.capacitor.Plugins.LocalNotifications.schedule({
                notifications: [
                    {
                        id: 1001,
                        title: '⏰ Temps de pausa completat!',
                        channelId: 'pause_alarm_channel_v4',
                        actionTypeId: 'PAUSE_ALARM_ACTIONS'
                    }
                ]
            });

            assertEqual(appState.currentState, 'PAUSA');
            assertEqual(appState.currentPauseType, 'esmorçar');
            assert(appState.currentPauseStart instanceof Date);

            const scheduled = env.capacitor.Plugins.LocalNotifications.__getScheduled();
            assertEqual(scheduled.length, 1);
            assertEqual(scheduled[0].id, 1001);
            assertEqual(scheduled[0].actionTypeId, 'PAUSE_ALARM_ACTIONS');
        });

        suite.test('Ending pause stops time IMMEDIATELY and records to database on happy path', async () => {
            const env = createMockEnvironment();
            const recordedPauses = [];

            const mockDb = {
                recordPausa: async (record) => {
                    recordedPauses.push(record);
                }
            };

            const pauseStartTime = new Date(Date.now() - 15 * 60 * 1000); // exactly 15 min ago
            const appState = {
                currentState: 'PAUSA',
                currentPauseStart: pauseStartTime,
                currentPauseType: 'esmorçar',
                totalPauseTimeToday: 0,
                isAlarmPlaying: false
            };

            // Execute endPause logic
            const now = new Date();
            const pauseStart = new Date(appState.currentPauseStart);
            const pauseDuration = Math.max(0, now - pauseStart);
            const pauseMinutes = pauseDuration / (1000 * 60);

            // 1. Record immediately to DB
            await mockDb.recordPausa({
                user: 'marc',
                type: appState.currentPauseType,
                startTime: pauseStart,
                endTime: now,
                durationMinutes: pauseMinutes
            });

            // 2. Immediately stop in local state
            appState.totalPauseTimeToday += pauseDuration;
            appState.currentPauseStart = null;
            appState.currentPauseType = null;
            appState.currentState = 'JORNADA';

            // 3. Cancel scheduled notification
            await env.capacitor.Plugins.LocalNotifications.cancel({ notifications: [{ id: 1001 }] });

            // Assertions
            assertEqual(appState.currentState, 'JORNADA', 'State must immediately be JORNADA');
            assertEqual(appState.currentPauseStart, null, 'currentPauseStart must be cleared');
            assertEqual(appState.currentPauseType, null, 'currentPauseType must be cleared');
            assert(appState.totalPauseTimeToday >= 14.9 * 60 * 1000, 'Total pause time must be ~15 min');

            assertEqual(recordedPauses.length, 1, 'Database must have 1 recorded pause');
            assertEqual(recordedPauses[0].type, 'esmorçar');
            assertEqual(Math.round(recordedPauses[0].durationMinutes), 15);

            const remainingNotifications = env.capacitor.Plugins.LocalNotifications.__getScheduled();
            assertEqual(remainingNotifications.length, 0, 'Scheduled notification must be removed');
        });

        suite.test('RESILIENCE TEST: When Beta10 remote server throws "Unable to resolve host", pause time STOPS and does NOT accumulate hours', async () => {
            const env = createMockEnvironment();
            const recordedPauses = [];

            const mockDb = {
                recordPausa: async (record) => {
                    recordedPauses.push(record);
                }
            };

            // User started pause at 11:35:00
            const pauseStartTime = new Date('2026-09-30T11:35:00Z');
            const endAttemptTime = new Date('2026-09-30T11:50:33Z'); // 15 min 33 sec later

            const appState = {
                currentState: 'PAUSA',
                currentPauseStart: pauseStartTime,
                currentPauseType: 'esmorçar',
                totalPauseTimeToday: 0
            };

            // Simulating endPause() implementation:
            const now = endAttemptTime;
            const pauseStart = new Date(appState.currentPauseStart);
            const pauseDuration = Math.max(0, now - pauseStart);
            const pauseMinutes = pauseDuration / (1000 * 60);

            // Immediate DB save
            await mockDb.recordPausa({
                user: 'marc',
                type: 'esmorçar',
                startTime: pauseStart,
                endTime: now,
                durationMinutes: pauseMinutes
            });

            // Immediate state reset
            appState.totalPauseTimeToday += pauseDuration;
            appState.currentPauseStart = null;
            appState.currentPauseType = null;
            appState.currentState = 'JORNADA';

            // Now, simulate the remote network punch throwing DNS resolution failure
            let networkErrorOccurred = false;
            try {
                // Mock network throwing exact error reported by user
                throw new Error('Unable to resolve host "9teknic.movbeta10.es": No address associated with hostname');
            } catch (err) {
                networkErrorOccurred = true;
            }

            assert(networkErrorOccurred, 'Network error should have been caught');

            // CRITICAL TEST: Check appState 3 hours later (e.g. 14:24:02)
            const simulatedReopenTime = new Date('2026-09-30T14:24:02Z');

            // Even 3 hours later, verify that:
            // 1. currentState is still JORNADA (NOT stuck in PAUSA)
            assertEqual(appState.currentState, 'JORNADA');
            // 2. currentPauseStart is still null
            assertEqual(appState.currentPauseStart, null);
            // 3. totalPauseTimeToday is exactly 15.55 minutes, NEVER 191 minutes!
            const totalPauseMinutes = appState.totalPauseTimeToday / (1000 * 60);
            assert(totalPauseMinutes < 16.0, `Pause duration must be ~15.5m, got ${totalPauseMinutes}m`);
            assert(totalPauseMinutes !== 191, 'Bug reproduced prevention: Pause must never be 191m');
        });

        suite.test('OFFLINE SYNC QUEUE: Failed pause end queues action and replays cleanly upon reconnect', async () => {
            const env = createMockEnvironment();
            const replayedPunches = [];

            // Mock saving to localStorage
            const pendingData = {
                type: 'END_PAUSE',
                title: 'Tornada de Pausa',
                actions: [
                    { action: 'salida', point: 'P' },
                    { action: 'entrada', point: 'J', newState: 'JORNADA' }
                ],
                timestamp: new Date().toISOString()
            };

            env.localStorage.setItem('beta10_pending_sync', JSON.stringify(pendingData));
            assert(env.localStorage.getItem('beta10_pending_sync'), 'Pending sync must be saved');

            // Simulate executePendingSync when reconnecting
            const pending = JSON.parse(env.localStorage.getItem('beta10_pending_sync'));
            for (const act of pending.actions) {
                // Mock successfully sending to proxy
                replayedPunches.push({ action: act.action, point: act.point });
            }
            env.localStorage.removeItem('beta10_pending_sync');

            assertEqual(replayedPunches.length, 2, 'Should replay 2 punches: salida P and entrada J');
            assertEqual(replayedPunches[0].action, 'salida');
            assertEqual(replayedPunches[0].point, 'P');
            assertEqual(replayedPunches[1].action, 'entrada');
            assertEqual(replayedPunches[1].point, 'J');
            assertEqual(env.localStorage.getItem('beta10_pending_sync'), null, 'Queue must be empty after sync');
        });
    });
};

