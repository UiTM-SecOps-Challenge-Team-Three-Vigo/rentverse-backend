const { prisma } = require('../../config/database');
const crypto = require('crypto'); // ✅ Added for hashing

class BookingsService {
  /**
   * Check if property is available for specific date range
   */
  async isPropertyAvailableForPeriod(
    propertyId,
    startDate,
    endDate,
    excludeLeaseId = null
  ) {
    const where = {
      propertyId,
      status: { in: ['APPROVED', 'ACTIVE'] },
      OR: [
        {
          AND: [
            { startDate: { lte: endDate } },
            { endDate: { gte: startDate } },
          ],
        },
      ],
    };

    if (excludeLeaseId) {
      where.id = { not: excludeLeaseId };
    }

    const overlappingLeases = await prisma.lease.findMany({ where });
    return overlappingLeases.length === 0;
  }

  /**
   * Create new booking/lease
   */
  async createBooking(bookingData, userId) {
    const {
      propertyId,
      startDate,
      endDate,
      rentAmount,
      securityDeposit,
      notes,
    } = bookingData;

    const bookingStartDate = new Date(startDate);
    const bookingEndDate = new Date(endDate);

    if (bookingStartDate >= bookingEndDate) {
      throw new Error('Start date must be before end date');
    }
    if (bookingStartDate < new Date()) {
      throw new Error('Start date cannot be in the past');
    }

    const property = await prisma.property.findUnique({
      where: { id: propertyId },
      include: { owner: true },
    });

    if (!property) throw new Error('Property not found');
    if (property.ownerId === userId) {
      throw new Error('You cannot book your own property');
    }
    if (!property.isAvailable) {
      throw new Error('Property is currently not available for booking');
    }

    const isAvailable = await this.isPropertyAvailableForPeriod(
      propertyId,
      bookingStartDate,
      bookingEndDate
    );

    if (!isAvailable) {
      throw new Error(`Property is already booked for the selected period`);
    }

    // 1. Create Lease (APPROVED)
    const booking = await prisma.lease.create({
      data: {
        propertyId,
        tenantId: userId,
        landlordId: property.ownerId,
        startDate: bookingStartDate,
        endDate: bookingEndDate,
        rentAmount: parseFloat(rentAmount),
        securityDeposit: securityDeposit ? parseFloat(securityDeposit) : null,
        status: 'APPROVED',
        notes: notes || null,
      },
      include: {
        property: true,
        tenant: true,
        landlord: true,
      },
    });

    // ===========================================
    // 🆕 MODULE 3 FIX: Initialize Digital Agreement Draft
    // ===========================================
    try {
      console.log(
        `📄 Initializing Digital Agreement Draft for booking: ${booking.id}`
      );

      // Generate Standard Legal Text
      const agreementText =
        `RENTAL AGREEMENT\n\n` +
        `Property: ${booking.property.title}\n` +
        `Address: ${booking.property.address}, ${booking.property.city}\n` +
        `Tenant: ${booking.tenant.name} (${booking.tenant.email})\n` +
        `Landlord: ${booking.landlord.name} (${booking.landlord.email})\n` +
        `Lease Term: ${booking.startDate.toISOString().split('T')[0]} to ${booking.endDate.toISOString().split('T')[0]}\n` +
        `Monthly Rent: ${booking.currencyCode} ${booking.rentAmount}\n` +
        `\nTerms: This agreement confirms the rental arrangement described above.`;

      // Generate Hash for Integrity
      const contentHash = crypto
        .createHash('sha256')
        .update(agreementText)
        .digest('hex');

      // Create the Agreement Record (PENDING_TENANT)
      await prisma.rentalAgreement.create({
        data: {
          leaseId: booking.id,
          agreementContent: agreementText,
          status: 'PENDING_TENANT', // Waiting for tenant signature
          contentHash: contentHash,
        },
      });

      console.log('✅ Digital Agreement Draft initialized successfully');
    } catch (err) {
      console.error('❌ Error initializing agreement draft:', err.message);
      // We do not fail the booking if agreement creation fails, but we log it.
    }

    return booking;
  }

  async getUserBookings(userId, page = 1, limit = 10) {
    const skip = (page - 1) * limit;
    const [bookings, total] = await Promise.all([
      prisma.lease.findMany({
        where: { tenantId: userId },
        include: {
          property: true,
          landlord: true,
          agreement: true, // ✅ Include agreement status so frontend knows to show "Sign" button
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.lease.count({ where: { tenantId: userId } }),
    ]);
    return {
      bookings,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  async getOwnerBookings(ownerId, page = 1, limit = 10, status = null) {
    const skip = (page - 1) * limit;
    const where = { landlordId: ownerId };
    if (status) where.status = status;

    const [bookings, total] = await Promise.all([
      prisma.lease.findMany({
        where,
        include: { property: true, tenant: true, agreement: true },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.lease.count({ where }),
    ]);
    return {
      bookings,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  async getBookingById(bookingId, userId) {
    const booking = await prisma.lease.findUnique({
      where: { id: bookingId },
      include: {
        property: {
          include: { amenities: { include: { amenity: true } } },
        },
        tenant: true,
        landlord: true,
        agreement: true, // ✅ Crucial: Include agreement details
      },
    });

    if (!booking) throw new Error('Booking not found');
    if (booking.tenantId !== userId && booking.landlordId !== userId) {
      throw new Error('Access denied');
    }
    return booking;
  }

  async getPropertyBookedPeriods(propertyId, startDate, endDate) {
    return await prisma.lease.findMany({
      where: {
        propertyId,
        status: { in: ['APPROVED', 'ACTIVE'] },
        OR: [
          {
            AND: [
              { startDate: { lte: endDate } },
              { endDate: { gte: startDate } },
            ],
          },
        ],
      },
      select: { id: true, startDate: true, endDate: true, status: true },
      orderBy: { startDate: 'asc' },
    });
  }

  // ✅ Updated: Returns correct nested structure for Frontend
  async getRentalAgreementPDF(bookingId, userId) {
    const booking = await this.getBookingById(bookingId, userId);

    if (!booking.agreement) {
      throw new Error('Rental agreement draft has not been initialized yet.');
    }

    if (booking.agreement.status !== 'COMPLETED') {
      // Return metadata so frontend knows it's pending signature
      return {
        success: true,
        data: {
          id: booking.agreement.id,
          status: booking.agreement.status,
          message: 'Agreement is pending signatures',
          pdf: null, // ✅ Explicitly null for frontend check
        },
      };
    }

    // ✅ FIXED: Return nested 'pdf' object to match frontend expectation
    return {
      success: true,
      message: 'Rental agreement PDF retrieved successfully',
      data: {
        bookingId: booking.id,
        status: booking.agreement.status,
        // ⬇️ This is the object your frontend looks for
        pdf: {
          url: booking.agreement.pdfUrl,
          fileName: booking.agreement.fileName,
          fileSize: booking.agreement.fileSize,
          generatedAt: booking.agreement.generatedAt,
        },
        // Flattened properties for other potential uses
        id: booking.agreement.id,
        publicId: booking.agreement.publicId,
      },
    };
  }

  // ✅ Updated: Helper for downloading
  async downloadRentalAgreementPDF(bookingId, userId) {
    const booking = await this.getBookingById(bookingId, userId);

    if (!booking.agreement || booking.agreement.status !== 'COMPLETED') {
      throw new Error('Agreement is not fully signed yet.');
    }

    const path = require('path');
    // Assuming local storage for simplicity as per your PDF service
    const filePath = path.join(
      __dirname,
      '../../../uploads/pdfs/',
      booking.agreement.fileName
    );

    return {
      isLocal: true,
      filePath,
      fileName: booking.agreement.fileName,
      url: booking.agreement.pdfUrl,
    };
  }

  // Legacy stubs to prevent crashes if referenced
  async approveBooking(bookingId, ownerId, notes = '') {
    return {};
  }
  async rejectBooking(bookingId, ownerId, reason) {
    return {};
  }
}

module.exports = new BookingsService();
