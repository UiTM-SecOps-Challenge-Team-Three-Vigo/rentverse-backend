const agreementRepo = require('./agreements.repository');
const { prisma } = require('../../config/database');
const pdfService = require('../../services/pdfGeneration.service');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const generateHash = content => {
  return crypto.createHash('sha256').update(content).digest('hex');
};

/**
 * ✅ Helper to save the file buffer to disk
 * Since Multer is in memory mode, we must write the file manually.
 */
const saveSignatureFile = file => {
  // Go up 3 levels from src/modules/agreements to root, then into uploads/signatures
  const uploadsDir = path.join(__dirname, '../../../uploads/signatures');

  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  // Generate a unique filename (e.g., sig-1234abcd.png)
  // Use mime type to detect extension (image/png -> png)
  const ext = file.mimetype.split('/')[1] || 'png';
  const filename = `sig-${uuidv4()}.${ext}`;
  const filepath = path.join(uploadsDir, filename);

  // Write the buffer to disk
  fs.writeFileSync(filepath, file.buffer);

  // Return the relative path to be stored in DB
  return `/uploads/signatures/${filename}`;
};

// 1. Generate Draft
const generateAgreement = async (leaseId, userId) => {
  const lease = await prisma.lease.findUnique({
    where: { id: leaseId },
    include: { property: true },
  });

  if (!lease) throw new Error('Lease not found');

  const existing = await agreementRepo.findAgreementByLeaseId(leaseId);
  if (existing) return existing;

  const agreementText = `RENTAL AGREEMENT for ${lease.property.title}. Rent: ${lease.rentAmount}`;

  return await agreementRepo.createAgreement({
    leaseId,
    agreementContent: agreementText,
    status: 'PENDING_TENANT',
    contentHash: generateHash(agreementText),
  });
};

// 2. Tenant Sign
const signByTenant = async (agreementId, userId, signatureFile) => {
  const agreement = await agreementRepo.findAgreementById(agreementId);
  if (!agreement) throw new Error('Agreement not found');

  if (agreement.lease.tenantId !== userId)
    throw new Error('Unauthorized: Not the tenant');

  if (!signatureFile) throw new Error('Signature required');

  // ✅ SAVE FILE TO DISK
  const signatureUrl = saveSignatureFile(signatureFile);

  return await agreementRepo.updateAgreement(agreementId, {
    tenantSignatureUrl: signatureUrl,
    tenantSignedAt: new Date(),
    status: 'PENDING_LANDLORD',
  });
};

// 3. Landlord Sign & Finalize
const signByLandlord = async (agreementId, userId, signatureFile) => {
  const agreement = await agreementRepo.findAgreementById(agreementId);
  if (!agreement) throw new Error('Agreement not found');

  if (agreement.lease.landlordId !== userId)
    throw new Error('Unauthorized: Not the landlord');
  if (!signatureFile) throw new Error('Signature required');

  // ✅ SAVE FILE TO DISK
  const landlordSigUrl = saveSignatureFile(signatureFile);

  // Update DB first
  await agreementRepo.updateAgreement(agreementId, {
    landlordSignatureUrl: landlordSigUrl,
    landlordSignedAt: new Date(),
  });

  // Trigger Final PDF Generation
  // We pass the new landlord URL and the existing tenant URL from DB
  const finalResult = await pdfService.generateAndUploadRentalAgreementPDF(
    agreement.leaseId,
    agreement.tenantSignatureUrl, // Already saved from previous step
    landlordSigUrl // Newly saved
  );

  return finalResult.data;
};

module.exports = { generateAgreement, signByTenant, signByLandlord };
