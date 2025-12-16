const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const puppeteer = require('puppeteer-core');
const { prisma } = require('../config/database');
const {
  cloudinary,
  isCloudinaryConfigured,
  CLOUD_FOLDER_PREFIX,
} = require('../config/storage');
const { v4: uuidv4 } = require('uuid');

class PDFGenerationService {
  /**
   * ✅ NEW HELPER: Convert local file path to base64 for PDF embedding
   * Fixes the issue where Puppeteer cannot load local images via relative paths
   */
  imageToBase64(relativePath) {
    try {
      if (!relativePath) return null;

      // Remove leading slash if present to join correctly
      const cleanPath = relativePath.startsWith('/')
        ? relativePath.slice(1)
        : relativePath;

      // Construct absolute path.
      // Assumption: 'uploads' folder is at the root of your project, 2 levels up from services/
      const absolutePath = path.join(__dirname, '../../', cleanPath);

      if (fs.existsSync(absolutePath)) {
        const bitmap = fs.readFileSync(absolutePath);
        // Detect mime type simply based on extension or default to png
        const ext = path.extname(absolutePath).slice(1) || 'png';
        return `data:image/${ext};base64,${bitmap.toString('base64')}`;
      }

      console.warn(`⚠️ Signature file not found at: ${absolutePath}`);
      return null;
    } catch (error) {
      console.error(
        `❌ Error converting image to base64: ${relativePath}`,
        error.message
      );
      return null;
    }
  }

  /**
   * Upload PDF buffer to Cloudinary using signed upload
   * @param {Buffer} pdfBuffer
   * @param {string} fileName
   * @returns {Promise<Object>}
   */
  async uploadPDFToCloudinary(pdfBuffer, fileName) {
    if (!isCloudinaryConfigured) {
      throw new Error(
        'Cloudinary is not configured. Please check your environment variables.'
      );
    }

    return new Promise((resolve, reject) => {
      const fileTimestamp = new Date()
        .toISOString()
        .replace(/[-T:.Z]/g, '')
        .slice(0, 14);
      const shortId = uuidv4().split('-')[0];
      const publicId = `${CLOUD_FOLDER_PREFIX}/rental-agreements/${fileName}-${fileTimestamp}-${shortId}`;

      const signatureTimestamp = Math.round(new Date().getTime() / 1000);

      const uploadParams = {
        public_id: publicId,
        resource_type: 'raw',
        format: 'pdf',
        use_filename: false,
        unique_filename: false,
        overwrite: true,
        type: 'upload',
        access_mode: 'public',
        timestamp: signatureTimestamp,
      };

      // ✅ FIX: Exclude 'resource_type' from signature generation
      const paramsToSign = { ...uploadParams };
      delete paramsToSign.resource_type;

      const signature = cloudinary.utils.api_sign_request(
        paramsToSign,
        process.env.CLOUD_API_SECRET
      );

      const signedParams = {
        ...uploadParams,
        signature: signature,
        api_key: process.env.CLOUD_API_KEY,
      };

      console.log('🔐 Using signed upload for PDF to Cloudinary...');

      const uploadStream = cloudinary.uploader.upload_stream(
        signedParams,
        (error, result) => {
          if (error) {
            console.error('Cloudinary signed PDF upload error:', error);
            reject(error);
            return;
          }

          console.log('✅ PDF uploaded successfully to Cloudinary');

          resolve({
            publicId: result.public_id,
            fileName: `${fileName}.pdf`,
            size: result.bytes,
            url: result.secure_url,
            etag: result.etag,
            format: result.format,
            resourceType: result.resource_type,
          });
        }
      );

      uploadStream.end(pdfBuffer);
    });
  }

  /**
   * Fallback: Upload PDF as image resource type
   */
  async uploadPDFAsImageFallback(pdfBuffer, fileName) {
    if (!isCloudinaryConfigured) {
      throw new Error('Cloudinary is not configured.');
    }

    return new Promise((resolve, reject) => {
      const timestamp = new Date()
        .toISOString()
        .replace(/[-T:.Z]/g, '')
        .slice(0, 14);
      const shortId = uuidv4().split('-')[0];
      const publicId = `${CLOUD_FOLDER_PREFIX}/rental-agreements/${fileName}-${timestamp}-${shortId}`;

      console.log(
        '⚠️  Using fallback: uploading PDF as image resource type...'
      );

      const uploadStream = cloudinary.uploader.upload_stream(
        {
          public_id: publicId,
          resource_type: 'image',
          format: 'pdf',
          use_filename: false,
          unique_filename: false,
          overwrite: true,
          type: 'upload',
          access_mode: 'public',
        },
        (error, result) => {
          if (error) {
            console.error('Cloudinary PDF fallback upload error:', error);
            reject(error);
            return;
          }

          let accessUrl = result.secure_url;
          if (result.resource_type === 'image') {
            accessUrl = cloudinary.url(result.public_id, {
              resource_type: 'image',
              format: 'pdf',
              flags: 'attachment',
              secure: true,
            });
          }

          resolve({
            publicId: result.public_id,
            fileName: `${fileName}.pdf`,
            size: result.bytes,
            url: accessUrl,
            etag: result.etag,
            format: result.format,
            resourceType: result.resource_type,
          });
        }
      );

      uploadStream.end(pdfBuffer);
    });
  }

  /**
   * Chrome path detection
   */
  getChromePath() {
    if (process.env.CHROME_PATH) return process.env.CHROME_PATH;

    const macChromePaths = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/google-chrome',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
    ];

    for (const chromePath of macChromePaths) {
      if (fs.existsSync(chromePath)) return chromePath;
    }
    return null;
  }

  /**
   * Generate accessible PDF URL
   */
  generateAccessiblePDFUrl(publicId, resourceType = 'raw') {
    const baseUrl = `https://res.cloudinary.com/${process.env.CLOUD_NAME}`;
    return resourceType === 'raw'
      ? `${baseUrl}/raw/upload/${publicId}.pdf`
      : `${baseUrl}/image/upload/${publicId}.pdf`;
  }

  /**
   * Save PDF to local storage
   */
  async saveToLocalStorage(pdfBuffer, fileName) {
    const uploadsDir = path.join(__dirname, '../../uploads/pdfs');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    const timestamp = new Date()
      .toISOString()
      .replace(/[-T:.Z]/g, '')
      .slice(0, 14);
    const shortId = uuidv4().split('-')[0];
    const uniqueFileName = `${fileName}-${timestamp}-${shortId}.pdf`;
    const filePath = path.join(uploadsDir, uniqueFileName);

    fs.writeFileSync(filePath, pdfBuffer);

    const serverUrl = `${process.env.BASE_URL || 'http://localhost:3005'}/api/files/pdfs/${uniqueFileName}`;

    return {
      fileName: uniqueFileName,
      filePath: filePath,
      url: serverUrl,
      size: pdfBuffer.length,
      publicId: null,
    };
  }

  /**
   * ✅ MODIFIED: Generate Final PDF with Signatures and Update Agreement
   * @param {string} leaseId
   * @param {string} tenantSigPath - Path/URL to tenant signature
   * @param {string} landlordSigPath - Path/URL to landlord signature
   * @returns {Promise<Object>}
   */
  async generateAndUploadRentalAgreementPDF(
    leaseId,
    tenantSigPath,
    landlordSigPath
  ) {
    try {
      console.log(`🚀 Starting Final PDF generation for lease: ${leaseId}`);

      // 1. Get lease data with complete relations AND existing agreement
      const lease = await prisma.lease.findUnique({
        where: { id: leaseId },
        include: {
          property: {
            include: {
              propertyType: true,
              amenities: { include: { amenity: true } },
            },
          },
          tenant: true,
          landlord: true,
          agreement: true, // ✅ Include the existing agreement draft
        },
      });

      if (!lease || !lease.agreement) {
        throw new Error(`Lease or Agreement draft not found for ID ${leaseId}`);
      }

      console.log(
        `📋 Retrieved lease data for property: ${lease.property.title}`
      );

      // 2. PREPARE IMAGES: Convert paths to Base64
      // ✅ This fixes the "I can't see the signs" issue
      const tenantSigBase64 = tenantSigPath
        ? this.imageToBase64(tenantSigPath)
        : null;
      const landlordSigBase64 = landlordSigPath
        ? this.imageToBase64(landlordSigPath)
        : null;

      // 3. Prepare data for EJS template
      const templateData = {
        rentalAgreement: {
          id: `RA-${lease.id.slice(-8).toUpperCase()}-${new Date().getFullYear()}`,
          date: new Date().toLocaleDateString('en-GB'),
        },
        lease: lease,
        signatures: {
          landlord: {
            name: lease.landlord.name,
            signDate: new Date().toLocaleDateString('en-GB'),
            image: landlordSigBase64, // ✅ Pass Base64 data
          },
          tenant: {
            name: lease.tenant.name,
            signDate: lease.agreement.tenantSignedAt
              ? new Date(lease.agreement.tenantSignedAt).toLocaleDateString(
                  'en-GB'
                )
              : new Date().toLocaleDateString('en-GB'),
            image: tenantSigBase64, // ✅ Pass Base64 data
          },
        },
      };

      // 4. Read and render EJS template
      const templatePath = path.join(
        __dirname,
        '../../templates/rental-agreement.ejs'
      );
      if (!fs.existsSync(templatePath)) {
        throw new Error(`Template file not found: ${templatePath}`);
      }

      const templateContent = fs.readFileSync(templatePath, 'utf-8');
      const html = ejs.render(templateContent, templateData);

      // 5. Generate PDF using Puppeteer
      console.log('🌐 Launching browser for PDF generation...');
      const chromePath = this.getChromePath();
      const launchOptions = {
        headless: 'new',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
        ],
      };
      if (chromePath) launchOptions.executablePath = chromePath;

      const browser = await puppeteer.launch(launchOptions);
      const page = await browser.newPage();

      await page.setContent(html, {
        waitUntil: 'networkidle0',
        timeout: 30000,
      });
      console.log('📄 Generating PDF...');
      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '20px', bottom: '20px', left: '20px', right: '20px' },
        preferCSSPageSize: true,
      });

      await browser.close();
      console.log(
        `✅ PDF generated successfully! Size: ${Math.round(pdfBuffer.length / 1024)} KB`
      );

      // 6. Save PDF (Primary: Local, Backup: Cloudinary)
      const fileName = `final-agreement-${lease.id}`;
      let uploadResult;

      try {
        console.log('☁️ Attempting upload to Cloudinary...');
        // ✅ Try Cloudinary First
        uploadResult = await this.uploadPDFToCloudinary(pdfBuffer, fileName);
        console.log('✅ Final PDF uploaded to Cloudinary successfully.');
      } catch (cloudError) {
        console.warn(
          '⚠️ Cloudinary upload failed, switching to local backup...',
          cloudError.message
        );
        try {
          // Backup: Save Locally
          uploadResult = await this.saveToLocalStorage(pdfBuffer, fileName);
          console.log('✅ Final PDF saved to local storage (Backup).');
        } catch (localError) {
          throw new Error(
            `Failed to save PDF: Cloudinary (${cloudError.message}) | Local (${localError.message})`
          );
        }
      }

      console.log('📍 PDF URL:', uploadResult.url);

      // 7. ✅ UPDATE the Existing Agreement Record (Don't create new)
      console.log('💾 Updating rental agreement record with final PDF...');
      const updatedAgreement = await prisma.rentalAgreement.update({
        where: { leaseId },
        data: {
          pdfUrl: uploadResult.url,
          publicId: uploadResult.publicId,
          fileName: uploadResult.fileName,
          fileSize: uploadResult.size,
          status: 'COMPLETED',
          generatedAt: new Date(),
          updatedAt: new Date(),
        },
      });

      console.log('✅ Agreement finalized and database updated.');

      return {
        success: true,
        message: 'Rental agreement finalized successfully',
        data: updatedAgreement,
      };
    } catch (error) {
      console.error(
        '❌ Error generating final rental agreement PDF:',
        error.message
      );
      throw new Error(`Failed to generate final PDF: ${error.message}`);
    }
  }

  /**
   * Get rental agreement PDF for a lease
   */
  async getRentalAgreementPDF(leaseId) {
    try {
      const rentalAgreement = await prisma.rentalAgreement.findUnique({
        where: { leaseId },
        include: {
          lease: {
            include: {
              property: { select: { id: true, title: true } },
              tenant: { select: { id: true, name: true, email: true } },
              landlord: { select: { id: true, name: true, email: true } },
            },
          },
        },
      });

      if (!rentalAgreement)
        throw new Error('Rental agreement not found for this lease');

      let accessibleUrl = rentalAgreement.pdfUrl;
      if (rentalAgreement.publicId) {
        const resourceType = rentalAgreement.pdfUrl.includes('/image/upload/')
          ? 'image'
          : 'raw';
        accessibleUrl = this.generateAccessiblePDFUrl(
          rentalAgreement.publicId,
          resourceType
        );
      }

      return {
        success: true,
        data: { ...rentalAgreement, pdfUrl: accessibleUrl },
      };
    } catch (error) {
      throw new Error(`Failed to get rental agreement: ${error.message}`);
    }
  }

  /**
   * Check if rental agreement already exists for a lease
   */
  async rentalAgreementExists(leaseId) {
    const existing = await prisma.rentalAgreement.findUnique({
      where: { leaseId },
    });
    return !!existing;
  }
}

module.exports = new PDFGenerationService();
