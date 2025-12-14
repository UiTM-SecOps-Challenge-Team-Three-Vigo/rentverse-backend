const agreementService = require('./agreements.service');

const createAgreement = async (req, res) => {
  try {
    const { leaseId } = req.body;
    const result = await agreementService.generateAgreement(
      leaseId,
      req.user.id
    );
    res.status(201).json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const signByTenant = async (req, res) => {
  try {
    const { agreementId } = req.params;
    const result = await agreementService.signByTenant(
      agreementId,
      req.user.id,
      req.file
    );
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const signByLandlord = async (req, res) => {
  try {
    const { agreementId } = req.params;
    const result = await agreementService.signByLandlord(
      agreementId,
      req.user.id,
      req.file
    );
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = { createAgreement, signByTenant, signByLandlord };
