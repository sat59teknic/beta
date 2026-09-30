/**
 * scripts/tests/test-schedule-and-overtime.js
 * Unit tests for work schedule, weekday detection, and overtime blocks calculations.
 */

const { assert, assertEqual, assertDeepEqual } = require('../test-harness.js');

module.exports = function registerScheduleTests(runner) {
    runner.suite('Workday Schedules & Overtime Calculation', async (suite) => {

        // Pure functions replicated from script.js
        function getStandardWorkDay(date = new Date()) {
            const dayOfWeek = date.getDay();
            if (dayOfWeek >= 1 && dayOfWeek <= 4) { // Lunes a Jueves
                return 9;
            } else if (dayOfWeek === 5) { // Viernes
                return 9;
            } else if (dayOfWeek === 6 || dayOfWeek === 0) { // Sábado o Domingo
                return 0; // Todo son horas extra
            }
            return 9;
        }

        function getDayTypeName(date = new Date()) {
            const dayOfWeek = date.getDay();
            if (dayOfWeek === 5) return "Divendres";
            if (dayOfWeek >= 1 && dayOfWeek <= 4) return "Dilluns-Dijous";
            if (dayOfWeek === 6) return "Dissabte";
            if (dayOfWeek === 0) return "Diumenge";
            return "Desconegut";
        }

        function calculateExtraHoursMock(workStartTime, totalPauseMs, currentState, currentPauseStart, standardWorkDay, fakeNow) {
            if (!workStartTime) return { extraHours: 0, totalHours: 0, extraBlocks: 0, standardWorkDay: 9 };

            const now = fakeNow || new Date();
            const workDuration = now - workStartTime - totalPauseMs;
            let currentPauseDuration = 0;

            if (currentState === 'PAUSA' && currentPauseStart) {
                currentPauseDuration = now - currentPauseStart;
            }

            const totalWorkTime = workDuration / (1000 * 60 * 60);
            const totalPauseTime = (totalPauseMs + currentPauseDuration) / (1000 * 60 * 60);
            const totalJourneyTime = totalWorkTime + totalPauseTime;

            const extraTime = Math.max(0, totalJourneyTime - standardWorkDay);

            let extraHours = 0;
            if (standardWorkDay === 0) {
                // Fin de semana: todo es hora extra si >= 30min
                extraHours = totalJourneyTime;
            } else {
                extraHours = extraTime >= 0.5 ? extraTime : 0;
            }

            const extraBlocks = Math.floor(extraHours / 0.5);

            return {
                extraHours,
                totalHours: totalJourneyTime,
                extraBlocks,
                standardWorkDay
            };
        }

        suite.test('Standard workday: 9h for Monday through Friday', () => {
            // Monday
            const monday = new Date('2026-09-28T10:00:00');
            assertEqual(getStandardWorkDay(monday), 9, 'Monday should have 9h standard');
            assertEqual(getDayTypeName(monday), 'Dilluns-Dijous');

            // Friday
            const friday = new Date('2026-10-02T10:00:00');
            assertEqual(getStandardWorkDay(friday), 9, 'Friday should have 9h standard');
            assertEqual(getDayTypeName(friday), 'Divendres');
        });

        suite.test('Weekend standard workday: 0h for Saturday and Sunday', () => {
            // Saturday
            const saturday = new Date('2026-10-03T10:00:00');
            assertEqual(getStandardWorkDay(saturday), 0, 'Saturday should have 0h standard (all overtime)');
            assertEqual(getDayTypeName(saturday), 'Dissabte');

            // Sunday
            const sunday = new Date('2026-10-04T10:00:00');
            assertEqual(getStandardWorkDay(sunday), 0, 'Sunday should have 0h standard (all overtime)');
            assertEqual(getDayTypeName(sunday), 'Diumenge');
        });

        suite.test('Overtime: Normal 8h workday (no overtime)', () => {
            const start = new Date('2026-09-30T08:00:00Z');
            const end = new Date('2026-09-30T16:00:00Z'); // 8h
            const result = calculateExtraHoursMock(start, 0, 'JORNADA', null, 9, end);

            assertEqual(result.totalHours, 8);
            assertEqual(result.extraHours, 0, 'Under 9h standard must have 0 extra hours');
            assertEqual(result.extraBlocks, 0);
        });

        suite.test('Overtime threshold: 15min extra (<30min) is not counted as overtime', () => {
            const start = new Date('2026-09-30T08:00:00Z');
            const end = new Date('2026-09-30T17:15:00Z'); // 9h 15min
            const result = calculateExtraHoursMock(start, 0, 'JORNADA', null, 9, end);

            assertEqual(result.totalHours, 9.25);
            assertEqual(result.extraHours, 0, 'Less than 30min extra should result in 0 recognized extra hours');
            assertEqual(result.extraBlocks, 0);
        });

        suite.test('Overtime recognized: 9h 30min -> 1 block of 30min (0.5h)', () => {
            const start = new Date('2026-09-30T08:00:00Z');
            const end = new Date('2026-09-30T17:30:00Z'); // 9h 30min
            const result = calculateExtraHoursMock(start, 0, 'JORNADA', null, 9, end);

            assertEqual(result.totalHours, 9.5);
            assertEqual(result.extraHours, 0.5, '9.5h total on 9h standard = 0.5h extra');
            assertEqual(result.extraBlocks, 1, 'Should equal exactly 1 block of 30min');
        });

        suite.test('Overtime recognized: 11h total -> 4 blocks of 30min (2.0h)', () => {
            const start = new Date('2026-09-30T08:00:00Z');
            const end = new Date('2026-09-30T19:00:00Z'); // 11h
            const result = calculateExtraHoursMock(start, 0, 'JORNADA', null, 9, end);

            assertEqual(result.totalHours, 11);
            assertEqual(result.extraHours, 2.0);
            assertEqual(result.extraBlocks, 4);
        });

        suite.test('Weekend overtime: Saturday 4h total -> all 4h are overtime (8 blocks)', () => {
            const start = new Date('2026-10-03T08:00:00Z');
            const end = new Date('2026-10-03T12:00:00Z'); // 4h
            const result = calculateExtraHoursMock(start, 0, 'JORNADA', null, 0, end);

            assertEqual(result.totalHours, 4.0);
            assertEqual(result.extraHours, 4.0, 'On weekend, entire duration is extra hours');
            assertEqual(result.extraBlocks, 8, '4 hours = 8 blocks of 30min');
        });
    });
};
