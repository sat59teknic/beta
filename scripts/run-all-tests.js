/**
 * scripts/run-all-tests.js
 * Master test runner for Beta10 application test suite.
 * STRICT NETWORK GUARD: Verifies 100% mocked, offline execution with zero server requests.
 */

const { TestRunner } = require('./test-harness.js');

// 1. STRICT NETWORK SECURITY GUARD
// If any function or module attempts an unmocked network request, throw immediately.
global.fetch = () => {
    throw new Error('SECURITY VIOLATION: Actual network call attempted! All external requests MUST be mocked to prevent touching the server or creating real records.');
};

async function main() {
    const runner = new TestRunner();

    // Register all test suites
    require('./tests/test-db.js')(runner);
    require('./tests/test-schedule-and-overtime.js')(runner);
    require('./tests/test-pause-and-resilience.js')(runner);
    require('./tests/test-alarm-and-notifications.js')(runner);
    require('./tests/test-autocorrection-and-ui.js')(runner);
    require('./tests/test-buttons-and-timers.js')(runner);
    require('./tests/test-whatsapp-modal-and-dual-stats.js')(runner);

    // Run suites
    await runner.run();
}

main().catch(err => {
    console.error('Fatal test runner error:', err);
    process.exit(1);
});
