// Preloaded only by test-isolated.cjs in the test process and its workers.
// Individual tests may still set process.env explicitly.
require('dotenv').config = () => ({ parsed: {} });
