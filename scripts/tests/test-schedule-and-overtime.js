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
            if (!workStartTime) return { extraHours: 0, workedExtraHours: 0, remuneratedExtraHours: 0, totalHours: 0, extraBlocks: 0, standardWorkDay: 9 };

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

            let workedExtraHours = 0;
            if (standardWorkDay === 0) {
                workedExtraHours = totalJourneyTime;
            } else {
                workedExtraHours = extraTime;
            }

            // Blocs de 30 minuts per dia (>30m: 0.5h, 45m: 0.5h, <30m: 0h)
            const extraBlocks = Math.floor((workedExtraHours + 0.0001) / 0.5);
            const remuneratedExtraHours = extraBlocks * 0.5;

            return {
                extraHours: workedExtraHours,
                workedExtraHours,
                remuneratedExtraHours,
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
            assertEqual(result.workedExtraHours, 0, 'Under 9h standard must have 0 extra hours');
            assertEqual(result.remuneratedExtraHours, 0);
            assertEqual(result.extraBlocks, 0);
        });

        suite.test('Overtime threshold: 23min extra (<30min) -> 0h remunerated, 0.38h worked extra', () => {
            const start = new Date('2026-09-30T08:00:00Z');
            const end = new Date('2026-09-30T17:23:00Z'); // 9h 23min
            const result = calculateExtraHoursMock(start, 0, 'JORNADA', null, 9, end);

            assertEqual(Math.round(result.totalHours * 100) / 100, 9.38);
            assertEqual(Math.round(result.workedExtraHours * 100) / 100, 0.38, 'Worked extra must be 0.38h (23min)');
            assertEqual(result.remuneratedExtraHours, 0, 'Less than 30min extra must result in 0h remunerated');
            assertEqual(result.extraBlocks, 0);
        });

        suite.test('Overtime threshold: 45min extra -> 0.5h remunerated, 0.75h worked extra (15min discarded)', () => {
            const start = new Date('2026-09-30T08:00:00Z');
            const end = new Date('2026-09-30T17:45:00Z'); // 9h 45min
            const result = calculateExtraHoursMock(start, 0, 'JORNADA', null, 9, end);

            assertEqual(result.totalHours, 9.75);
            assertEqual(result.workedExtraHours, 0.75, 'Worked extra must be 0.75h (45min)');
            assertEqual(result.remuneratedExtraHours, 0.5, '45min extra must remunerate exactly 0.5h (1 block)');
            assertEqual(result.extraBlocks, 1);
        });

        suite.test('Overtime recognized: 9h 30min -> 1 block of 30min (0.5h remunerated)', () => {
            const start = new Date('2026-09-30T08:00:00Z');
            const end = new Date('2026-09-30T17:30:00Z'); // 9h 30min
            const result = calculateExtraHoursMock(start, 0, 'JORNADA', null, 9, end);

            assertEqual(result.totalHours, 9.5);
            assertEqual(result.workedExtraHours, 0.5);
            assertEqual(result.remuneratedExtraHours, 0.5);
            assertEqual(result.extraBlocks, 1);
        });

        suite.test('Overtime recognized: 1h 15min extra (10h 15min total) -> 1.0h remunerated (2 blocks)', () => {
            const start = new Date('2026-09-30T08:00:00Z');
            const end = new Date('2026-09-30T18:15:00Z'); // 10h 15min -> 1h 15min extra
            const result = calculateExtraHoursMock(start, 0, 'JORNADA', null, 9, end);

            assertEqual(result.totalHours, 10.25);
            assertEqual(result.workedExtraHours, 1.25);
            assertEqual(result.remuneratedExtraHours, 1.0, '1h 15m extra must remunerate 1.0h');
            assertEqual(result.extraBlocks, 2);
        });

        suite.test('Overtime recognized: 1h 45min extra (10h 45min total) -> 1.5h remunerated (3 blocks)', () => {
            const start = new Date('2026-09-30T08:00:00Z');
            const end = new Date('2026-09-30T18:45:00Z'); // 10h 45min -> 1h 45min extra
            const result = calculateExtraHoursMock(start, 0, 'JORNADA', null, 9, end);

            assertEqual(result.totalHours, 10.75);
            assertEqual(result.workedExtraHours, 1.75);
            assertEqual(result.remuneratedExtraHours, 1.5, '1h 45m extra must remunerate 1.5h');
            assertEqual(result.extraBlocks, 3);
        });

        suite.test('Overtime recognized: 11h total (2h extra) -> 4 blocks of 30min (2.0h)', () => {
            const start = new Date('2026-09-30T08:00:00Z');
            const end = new Date('2026-09-30T19:00:00Z'); // 11h
            const result = calculateExtraHoursMock(start, 0, 'JORNADA', null, 9, end);

            assertEqual(result.totalHours, 11);
            assertEqual(result.workedExtraHours, 2.0);
            assertEqual(result.remuneratedExtraHours, 2.0);
            assertEqual(result.extraBlocks, 4);
        });

        suite.test('Daily Reset / Non-accumulation: 2 days of 23min extra NEVER accumulate to 0.5h', () => {
            const day1Start = new Date('2026-09-28T08:00:00Z');
            const day1End = new Date('2026-09-28T17:23:00Z'); // 23min extra
            const day1 = calculateExtraHoursMock(day1Start, 0, 'JORNADA', null, 9, day1End);

            const day2Start = new Date('2026-09-29T08:00:00Z');
            const day2End = new Date('2026-09-29T17:23:00Z'); // 23min extra
            const day2 = calculateExtraHoursMock(day2Start, 0, 'JORNADA', null, 9, day2End);

            assertEqual(day1.remuneratedExtraHours, 0, 'Day 1 remunerated must be 0h');
            assertEqual(day2.remuneratedExtraHours, 0, 'Day 2 remunerated must be 0h');

            const totalRemuneratedMonth = day1.remuneratedExtraHours + day2.remuneratedExtraHours;
            const totalWorkedExtraMonth = day1.workedExtraHours + day2.workedExtraHours;

            assertEqual(totalRemuneratedMonth, 0, 'Total remunerated hours for month must remain 0h');
            assertEqual(Math.round(totalWorkedExtraMonth * 100) / 100, 0.77, 'Total worked extra captures 46min (~0.77h)');
        });

        suite.test('Weekend overtime: Saturday 4h total -> all 4h are overtime (8 blocks)', () => {
            const start = new Date('2026-10-03T08:00:00Z');
            const end = new Date('2026-10-03T12:00:00Z'); // 4h
            const result = calculateExtraHoursMock(start, 0, 'JORNADA', null, 0, end);

            assertEqual(result.totalHours, 4.0);
            assertEqual(result.workedExtraHours, 4.0, 'On weekend, entire duration is extra hours');
            assertEqual(result.remuneratedExtraHours, 4.0);
            assertEqual(result.extraBlocks, 8, '4 hours = 8 blocks of 30min');
        });
    });
};
