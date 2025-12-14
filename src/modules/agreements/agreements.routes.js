const express = require('express');
const router = express.Router();
const { auth } = require('../../middleware/auth');
const { uploadSingle } = require('../../middleware/upload');
const controller = require('./agreements.controller');

router.use(auth);

router.post('/generate', controller.createAgreement);
router.post(
  '/:agreementId/sign/tenant',
  uploadSingle('signature'),
  controller.signByTenant
);
router.post(
  '/:agreementId/sign/landlord',
  uploadSingle('signature'),
  controller.signByLandlord
);

module.exports = router;
