const { prisma } = require('../../config/database');

const createAgreement = async data => {
  return await prisma.rentalAgreement.create({ data });
};

const findAgreementById = async id => {
  return await prisma.rentalAgreement.findUnique({
    where: { id },
    include: {
      lease: {
        include: {
          property: true,
          tenant: true,
          landlord: true,
        },
      },
    },
  });
};

const findAgreementByLeaseId = async leaseId => {
  return await prisma.rentalAgreement.findUnique({
    where: { leaseId },
    include: { lease: true },
  });
};

const updateAgreement = async (id, data) => {
  return await prisma.rentalAgreement.update({
    where: { id },
    data,
  });
};

module.exports = {
  createAgreement,
  findAgreementById,
  findAgreementByLeaseId,
  updateAgreement,
};
