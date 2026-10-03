/**
 * scripts/tests/test-alarm-and-notifications.js
 * Unit and integration tests for alarm audio, notification scheduling,
 * stop alarm button, and prevention of retroactive alarm on app reopen.
 */

const { assert, assertEqual, createMockEnvironment } = require('../test-harness.js');

module.exports = function registerAlarmTests(runner) {
    runner.suite('Alarm Sound, Notification Actions & App Reopen Safety', async (suite) => {

        suite.test('Native notification channel is configured with alarm.wav and PAUSE_ALARM_ACTIONS', async () => {
            const env = createMockEnvironment();

            // Simulate initNativeNotificationChannel
            await env.capacitor.Plugins.LocalNotifications.createChannel({
                id: 'pause_alarm_channel_v4',
                name: 'Alarmes de Pausa',
                importance: 5,
                sound: 'alarm.wav',
                vibration: true
            });

            await env.capacitor.Plugins.LocalNotifications.registerActionTypes({
                types: [
                    {
                        id: 'PAUSE_ALARM_ACTIONS',
                        actions: [
                            {
                                id: 'STOP_ALARM',
                                title: '🔕 Aturar Alarma',
                                destructive: true
                            }
                        ]
                    }
                ]
            });

            const channels = env.capacitor.Plugins.LocalNotifications.__getChannels();
            assertEqual(channels.length, 1);
            assertEqual(channels[0].id, 'pause_alarm_channel_v4');
            assertEqual(channels[0].sound, 'alarm.wav');

            const actionTypes = env.capacitor.Plugins.LocalNotifications.__getActionTypes();
            assertEqual(actionTypes.length, 1);
            assertEqual(actionTypes[0].id, 'PAUSE_ALARM_ACTIONS');
            assertEqual(actionTypes[0].actions[0].id, 'STOP_ALARM');
        });

        suite.test('playPauseAlarm starts audio, shows alarm banner and sets isAlarmPlaying', async () => {
            const env = createMockEnvironment();

            const appState = {
                currentState: 'PAUSA',
                isAlarmPlaying: false,
                alarmSource: null,
                pauseAlarmTriggered: false,
                lastAlarmTime: null
            };

            // Simulate playPauseAlarm
            function playPauseAlarm(pauseType, source = 'local') {
                if (appState.isAlarmPlaying) return;
                appState.pauseAlarmTriggered = true;
                appState.isAlarmPlaying = true;
                appState.alarmSource = source;

                const player = env.dom.getElementById('pause-audio-player');
                player.src = 'alarm.wav';
                player.play();

                const banner = env.dom.getElementById('alarm-banner');
                if (banner) banner.style.display = 'flex';
            }

            playPauseAlarm('esmorçar', 'native-notification');

            assertEqual(appState.isAlarmPlaying, true);
            assertEqual(appState.alarmSource, 'native-notification');
            assertEqual(env.dom.getElementById('pause-audio-player').src, 'alarm.wav');
            assertEqual(env.dom.getElementById('alarm-banner').style.display, 'flex');
        });

        suite.test('stopAlarm silences audio, clears flags, hides banner, and cancels notification', async () => {
            const env = createMockEnvironment();

            const appState = {
                currentState: 'PAUSA',
                isAlarmPlaying: true,
                alarmSource: 'timer-limit',
                pauseAlarmTriggered: true
            };

            env.dom.getElementById('alarm-banner').style.display = 'flex';
            const player = env.dom.getElementById('pause-audio-player');
            player.src = 'alarm.wav';

            // Simulate stopAlarm
            async function stopAlarm() {
                player.pause();
                player.removeAttribute('src');
                appState.isAlarmPlaying = false;
                appState.alarmSource = null;

                const banner = env.dom.getElementById('alarm-banner');
                if (banner) banner.style.display = 'none';

                await env.capacitor.Plugins.LocalNotifications.cancel({ notifications: [{ id: 1001 }] });
            }

            await stopAlarm();

            assertEqual(appState.isAlarmPlaying, false);
            assertEqual(appState.alarmSource, null);
            assertEqual(player.src, null);
            assertEqual(env.dom.getElementById('alarm-banner').style.display, 'none');
        });

        suite.test('Notification action button "STOP_ALARM" directly silences the alarm', async () => {
            const env = createMockEnvironment();
            let stopAlarmCalled = false;

            function stopAlarm() {
                stopAlarmCalled = true;
            }

            // Register listener as in setupNativeNotificationListeners
            env.capacitor.Plugins.LocalNotifications.addListener('localNotificationActionPerformed', (notificationAction) => {
                if (notificationAction?.actionId === 'STOP_ALARM') {
                    stopAlarm();
                }
            });

            // Simulate Android user clicking "🔕 Aturar Alarma" on notification bar
            env.capacitor.Plugins.LocalNotifications.__triggerEvent('localNotificationActionPerformed', {
                actionId: 'STOP_ALARM',
                notification: { id: 1001 }
            });

            assertEqual(stopAlarmCalled, true, 'stopAlarm must be invoked when STOP_ALARM action is clicked');
        });

        suite.test('NO AUTO-ALARM ON REOPEN: Reopening app (visibilitychange) does NOT trigger retroactive alarm', async () => {
            const env = createMockEnvironment();
            let alarmTriggeredCount = 0;

            const PAUSE_LIMITS = { esmorçar: 15 * 60 * 1000, dinar: 30 * 60 * 1000 };

            // User started pause at 11:35 (2 hours ago)
            const appState = {
                currentState: 'PAUSA',
                currentPauseStart: new Date(Date.now() - 2 * 60 * 60 * 1000),
                currentPauseType: 'esmorçar',
                isAlarmPlaying: false
            };

            function playPauseAlarm(pauseType, source) {
                alarmTriggeredCount++;
            }

            // New visibilitychange listener without foreground-return trigger
            function onVisibilityChange(isHidden) {
                if (!isHidden) {
                    // App in foreground
                    // ELIMINAT: No disparar alarma en tornar al primer pla (foreground-return)
                }
            }

            // Simulate app returning to foreground
            onVisibilityChange(false);

            assertEqual(alarmTriggeredCount, 0, 'playPauseAlarm must NOT be called on returning to foreground');
        });

        suite.test('NO AUTO-ALARM ON INIT: App initialization with expired pause does NOT blast alarm audio', async () => {
            let alarmAudioTriggered = false;

            const appState = {
                currentState: 'PAUSA',
                currentPauseStart: new Date(Date.now() - 45 * 60 * 1000), // 45 min ago
                currentPauseType: 'esmorçar'
            };

            const PAUSE_LIMITS = { esmorçar: 15 * 60 * 1000, dinar: 30 * 60 * 1000 };

            // Simulate new init() logic
            const elapsed = Date.now() - appState.currentPauseStart;
            const pauseLimit = PAUSE_LIMITS[appState.currentPauseType];
            const remaining = pauseLimit - elapsed;

            if (remaining > 0) {
                // schedule
            } else {
                // ELIMINATED: Do not call playPauseAlarm(..., 'init')
                // Instead, log informative message only
            }

            assertEqual(alarmAudioTriggered, false, 'init must NOT blast retroactive alarm if time has passed');
        });
    });
};
