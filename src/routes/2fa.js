const express = require('express');
const router = express.Router();
const { generateSecret, verifyToken } = require('2fa-util');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { auth } = require('../middleware/auth');

// Generate 2FA secret
router.post('/generate-secret', auth, async (req, res) => {
  try {
    const secret = await generateSecret(req.user.email, 'RentVerse');
    await prisma.user.update({
      where: { id: req.user.id },
      data: { twoFactorSecret: secret.secret },
    });
    res.json({ secret: secret.secret, qrCode: secret.qrcode });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Verify OTP and enable 2FA
router.post('/verify-otp', auth, async (req, res) => {
  try {
    const { token } = req.body;
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user || !user.twoFactorSecret) {
      return res.status(400).json({ message: '2FA not enabled' });
    }
    const isValid = await verifyToken(user.twoFactorSecret, token);
    if (isValid) {
      await prisma.user.update({
        where: { id: req.user.id },
        data: { twoFactorEnabled: true },
      });
      res.json({ message: '2FA enabled successfully' });
    } else {
      res.status(400).json({ message: 'Invalid OTP' });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;
