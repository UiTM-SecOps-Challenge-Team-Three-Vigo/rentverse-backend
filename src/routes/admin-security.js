const express = require('express');
const router = express.Router();
const securityController = require('../modules/security/security.controller');
const { auth, authorize } = require('../middleware/auth');

// Protect all routes: Must be logged in AND have ADMIN role
router.use(auth, authorize('ADMIN'));

router.get('/stats', securityController.getStats);
router.get('/logs', securityController.getAllLogs);

module.exports = router;
