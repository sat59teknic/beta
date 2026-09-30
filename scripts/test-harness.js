/**
 * scripts/test-harness.js
 * Test framework & mock environment for Beta10 unit and integration tests.
 * STRICT NETWORK GUARD: Any real HTTP call throws an error to prevent touching the server.
 */

const fs = require('fs');
const path = require('path');
const initSqlJs = require('../sql-wasm.js');

// --- ASSERTION UTILITIES ---
class AssertionError extends Error {
    constructor(message) {
        super(message);
        this.name = 'AssertionError';
    }
}

function assert(condition, message) {
    if (!condition) {
        throw new AssertionError(message || 'Assertion failed: expected true, got false');
    }
}

function assertEqual(actual, expected, message) {
    if (actual !== expected) {
        throw new AssertionError(`${message || 'Assertion failed'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
}

function assertDeepEqual(actual, expected, message) {
    const actStr = JSON.stringify(actual);
    const expStr = JSON.stringify(expected);
    if (actStr !== expStr) {
        throw new AssertionError(`${message || 'Assertion failed'}: expected ${expStr}, got ${actStr}`);
    }
}

async function assertThrowsAsync(fn, message) {
    let threw = false;
    try {
        await fn();
    } catch (e) {
        threw = true;
    }
    if (!threw) {
        throw new AssertionError(message || 'Expected function to throw, but it succeeded');
    }
}

// --- TEST RUNNER ---
class TestRunner {
    constructor() {
        this.suites = [];
        this.totalTests = 0;
        this.passed = 0;
        this.failed = 0;
        this.failures = [];
    }

    suite(name, fn) {
        this.suites.push({ name, fn });
    }

    async run() {
        console.log('\n======================================================');
        console.log('🧪 RUNNING BETA10 TEST SUITE (100% OFFLINE / MOCKED)');
        console.log('======================================================\n');

        const startTime = Date.now();

        for (const s of this.suites) {
            console.log(`📦 Suite: ${s.name}`);
            const ctx = new SuiteContext();
            try {
                await s.fn(ctx);
                for (const t of ctx.tests) {
                    this.totalTests++;
                    try {
                        await t.fn();
                        this.passed++;
                        console.log(`  ✓ ${t.name}`);
                    } catch (err) {
                        this.failed++;
                        this.failures.push({ suite: s.name, test: t.name, error: err });
                        console.log(`  ❌ ${t.name}: ${err.message}`);
                    }
                }
            } catch (err) {
                console.log(`  ❌ Suite initialization failed: ${err.message}`);
            }
            console.log('');
        }

        const duration = Date.now() - startTime;
        console.log('======================================================');
        console.log(`📊 RESULTS: ${this.passed} passed, ${this.failed} failed (${this.totalTests} total) in ${duration}ms`);
        console.log('======================================================\n');

        if (this.failures.length > 0) {
            console.log('❌ FAILURES SUMMARY:');
            for (const f of this.failures) {
                console.log(`- [${f.suite}] ${f.test}:`);
                console.log(`  ${f.error.stack || f.error.message}\n`);
            }
            process.exit(1);
        } else {
            console.log('🎉 ALL TESTS PASSED SUCCESSFULLY! ZERO NETWORK CALLS TO SERVER.\n');
            process.exit(0);
        }
    }
}

class SuiteContext {
    constructor() {
        this.tests = [];
    }

    test(name, fn) {
        this.tests.push({ name, fn });
    }
}

// --- MOCK ENVIRONMENT BUILDER ---
function createMockEnvironment() {
    const memoryStore = {};

    const localStorageMock = {
        getItem: (k) => (k in memoryStore ? memoryStore[k] : null),
        setItem: (k, v) => { memoryStore[k] = String(v); },
        removeItem: (k) => { delete memoryStore[k]; },
        clear: () => { Object.keys(memoryStore).forEach(k => delete memoryStore[k]); }
    };

    const listeners = {};
    const scheduledNotifications = [];
    const deliveredNotifications = [];
    const registeredChannels = [];
    const registeredActionTypes = [];

    const capacitorMock = {
        Plugins: {
            LocalNotifications: {
                schedule: async (options) => {
                    scheduledNotifications.push(...options.notifications);
                    return { notifications: options.notifications };
                },
                cancel: async (options) => {
                    const idsToCancel = options.notifications.map(n => n.id);
                    for (let i = scheduledNotifications.length - 1; i >= 0; i--) {
                        if (idsToCancel.includes(scheduledNotifications[i].id)) {
                            scheduledNotifications.splice(i, 1);
                        }
                    }
                    return {};
                },
                removeDeliveredNotifications: async (options) => {
                    const idsToRemove = options.notifications.map(n => n.id);
                    for (let i = deliveredNotifications.length - 1; i >= 0; i--) {
                        if (idsToRemove.includes(deliveredNotifications[i].id)) {
                            deliveredNotifications.splice(i, 1);
                        }
                    }
                    return {};
                },
                createChannel: async (channel) => {
                    registeredChannels.push(channel);
                    return {};
                },
                deleteChannel: async (channel) => {
                    return {};
                },
                registerActionTypes: async (types) => {
                    registeredActionTypes.push(...types.types);
                    return {};
                },
                requestPermissions: async () => ({ display: 'granted' }),
                addListener: (event, handler) => {
                    if (!listeners[event]) listeners[event] = [];
                    listeners[event].push(handler);
                    return { remove: () => {} };
                },
                // Test helper to simulate firing a notification event
                __triggerEvent: (event, data) => {
                    if (listeners[event]) {
                        listeners[event].forEach(fn => fn(data));
                    }
                },
                __getScheduled: () => scheduledNotifications,
                __getChannels: () => registeredChannels,
                __getActionTypes: () => registeredActionTypes
            }
        }
    };

    let audioSrc = null;
    let audioPlaying = false;
    let audioVolume = 1.0;

    const audioPlayerMock = {
        get src() { return audioSrc; },
        set src(v) { audioSrc = v; },
        get volume() { return audioVolume; },
        set volume(v) { audioVolume = v; },
        loop: false,
        play: async () => { audioPlaying = true; return Promise.resolve(); },
        pause: () => { audioPlaying = false; },
        removeAttribute: (attr) => { if (attr === 'src') audioSrc = null; },
        load: () => {}
    };

    const elements = {
        'pause-audio-player': audioPlayerMock,
        'connection-status': { className: '' },
        'gps-status': { className: '' },
        'current-state-text': { textContent: '' },
        'work-timer': { textContent: '00:00:00' },
        'pause-timer': { textContent: '00:00:00' },
        'work-timer-label': { textContent: '💼 Jornada' },
        'pause-timer-label': { textContent: '☕ Pausa' },
        'work-timer-box': { classList: { toggle: () => {} } },
        'pause-timer-box': { classList: { toggle: () => {} } },
        'button-container': { innerHTML: '', appendChild: () => {} },
        'log-container': { innerHTML: '', appendChild: () => {}, insertBefore: () => {} },
        'loading-overlay': { style: { display: 'none' } },
        'loading-text': { textContent: '' },
        'info-message': { textContent: '', className: '', innerHTML: '', classList: { add: () => {}, remove: () => {}, contains: () => false } },
        'status-card': { className: '' },
        'status-live-badge': { querySelector: () => ({ textContent: '' }) },
        'alarm-banner': { style: { display: 'none' } },
        'alarm-banner-sub': { textContent: '' },
        'btn-stop-alarm-banner': { onclick: null }
    };

    const domMock = {
        getElementById: (id) => elements[id] || null,
        createElement: (tag) => ({
            tagName: tag,
            className: '',
            style: {},
            classList: { add: () => {}, remove: () => {} },
            appendChild: () => {},
            addEventListener: () => {}
        }),
        body: {
            setAttribute: () => {},
            appendChild: () => {}
        }
    };

    return {
        localStorage: localStorageMock,
        capacitor: capacitorMock,
        audioPlayer: audioPlayerMock,
        dom: domMock,
        getAudioState: () => ({ audioSrc, audioPlaying }),
        // STRICT NETWORK GUARD
        guardFetch: () => {
            return () => {
                throw new Error('SECURITY VIOLATION: Actual network call attempted! All external requests MUST be mocked.');
            };
        }
    };
}

module.exports = {
    assert,
    assertEqual,
    assertDeepEqual,
    assertThrowsAsync,
    TestRunner,
    createMockEnvironment
};
