const { prisma } = require('../../config/database');
const nodemailer = require('nodemailer');
const geoip = require('geoip-lite');
const UAParser = require('ua-parser-js');

// Configure Email Transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

class SecurityService {
  /**
   * 1. Log Activity with Enrichment (Location & Device)
   */
  async logActivity(req, userId, action, details = {}) {
    try {
      // Clean IP (Handle localhost)
      let ipAddress =
        req.headers['x-forwarded-for']?.split(',')[0] ||
        req.socket.remoteAddress ||
        '0.0.0.0';
      if (ipAddress === '::1') ipAddress = '127.0.0.1';

      // 🌍 GeoIP Lookup
      const geo = geoip.lookup(ipAddress);
      const location = geo ? `${geo.city}, ${geo.country}` : 'Unknown Location';

      // 📱 Device Parsing
      const userAgentRaw = req.headers['user-agent'] || '';
      const parser = new UAParser(userAgentRaw);
      const deviceName = `${parser.getBrowser().name || 'Unknown Browser'} on ${parser.getOS().name || 'Unknown OS'}`;

      // Enriched Details
      const enrichedDetails = {
        ...details,
        location,
        device: deviceName,
        browser: parser.getBrowser().name,
        os: parser.getOS().name,
      };

      // Save to DB
      const log = await prisma.activityLog.create({
        data: {
          userId,
          action,
          ipAddress,
          userAgent: userAgentRaw,
          details: enrichedDetails,
          riskScore: 0,
        },
      });

      // Analyze for threats
      this.detectSuspiciousPatterns(
        userId,
        ipAddress,
        action,
        enrichedDetails
      ).catch(err => console.error('Error during threat analysis:', err));

      return log;
    } catch (error) {
      console.error('Failed to log activity:', error);
      return null;
    }
  }

  /**
   * 2. Detect Patterns
   */
  async detectSuspiciousPatterns(userId, currentIp, action, details) {
    // A. Brute Force
    if (action === 'LOGIN_FAILED') {
      const failedAttempts = await prisma.activityLog.count({
        where: {
          ipAddress: currentIp,
          action: 'LOGIN_FAILED',
          createdAt: { gte: new Date(Date.now() - 15 * 60 * 1000) },
        },
      });

      if (failedAttempts >= 5) {
        console.warn(
          `🚨 BRUTE FORCE ALERT: IP ${currentIp} (${details.location})`
        );
        await this.sendAlertEmail(
          process.env.ADMIN_EMAIL || 'admin@rentverse.com',
          'Brute Force Attack Detected',
          'BRUTE_FORCE',
          {
            ip: currentIp,
            location: details.location,
            attempts: failedAttempts,
          }
        );
      }
    }

    // B. New Device Login
    if (action === 'LOGIN_SUCCESS' && userId) {
      const previousLogin = await prisma.activityLog.findFirst({
        where: {
          userId,
          action: 'LOGIN_SUCCESS',
          ipAddress: currentIp,
          id: { not: userId },
        },
      });

      if (!previousLogin) {
        console.warn(`⚠️ NEW DEVICE: User ${userId} from ${details.location}`);

        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (user) {
          await this.sendAlertEmail(
            user.email,
            'New Login Detected on RentVerse',
            'NEW_DEVICE',
            {
              ip: currentIp,
              location: details.location,
              device: details.device,
              time: new Date().toLocaleString(),
            }
          );
        }
      }
    }
  }

  /**
   * 3. Send Professional HTML Email
   */
  async sendAlertEmail(to, subject, type, data) {
    if (!process.env.EMAIL_USER) return;

    // Choose color based on severity
    const color = type === 'BRUTE_FORCE' ? '#ef4444' : '#f59e0b'; // Red or Orange
    const title =
      type === 'BRUTE_FORCE' ? 'System Security Alert' : 'New Login Detected';

    // Professional HTML Template
    const htmlContent = `
      <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
        <div style="background-color: #0f172a; padding: 24px; text-align: center;">
          <h2 style="color: #ffffff; margin: 0; letter-spacing: 1px;">RentVerse Security</h2>
        </div>

        <div style="padding: 32px; background-color: #ffffff;">
          <h3 style="color: ${color}; margin-top: 0; font-size: 20px;">${title}</h3>
          <p style="color: #475569; line-height: 1.6;">
            We detected the following activity on your account. If this was you, you can ignore this email.
          </p>

          <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 24px 0;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 0; color: #64748b; font-size: 14px;">Event Type</td>
                <td style="padding: 8px 0; color: #0f172a; font-weight: 600; text-align: right;">${type}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #64748b; font-size: 14px;">Location</td>
                <td style="padding: 8px 0; color: #0f172a; font-weight: 600; text-align: right;">${data.location || 'Unknown'}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #64748b; font-size: 14px;">Device</td>
                <td style="padding: 8px 0; color: #0f172a; font-weight: 600; text-align: right;">${data.device || 'N/A'}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #64748b; font-size: 14px;">IP Address</td>
                <td style="padding: 8px 0; color: #0f172a; font-weight: 600; text-align: right;">${data.ip}</td>
              </tr>
            </table>
          </div>

          <p style="color: #475569; font-size: 14px;">
            If you did not authorize this action, please secure your account immediately.
          </p>

          <div style="text-align: center; margin-top: 32px;">
            <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/account" 
               style="background-color: #0f172a; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: 600; display: inline-block;">
              Check Activity Log
            </a>
          </div>
        </div>

        <div style="background-color: #f1f5f9; padding: 16px; text-align: center; font-size: 12px; color: #94a3b8;">
          &copy; ${new Date().getFullYear()} RentVerse Inc. • Automated Security System
        </div>
      </div>
    `;

    try {
      await transporter.sendMail({
        from: '"RentVerse Security" <noreply@rentverse.com>',
        to: to,
        subject: `[Security] ${subject}`,
        html: htmlContent,
      });
      console.log(`📧 Sent Professional Email to ${to}`);
    } catch (err) {
      console.error('Email failed:', err);
    }
  }

  /**
   * 4. [ADMIN] Get Global Security Stats for Dashboard
   */
  async getDashboardStats() {
    const now = new Date();
    const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000);

    // Run parallel queries for performance
    const [totalLogs, failedLogins, recentThreats, topIps] = await Promise.all([
      // Count total activities today
      prisma.activityLog.count({
        where: { createdAt: { gte: twentyFourHoursAgo } },
      }),

      // Count failed logins today
      prisma.activityLog.count({
        where: {
          action: 'LOGIN_FAILED',
          createdAt: { gte: twentyFourHoursAgo },
        },
      }),

      // Get recent high-risk events
      prisma.activityLog.findMany({
        where: { action: { in: ['BRUTE_FORCE', 'NEW_DEVICE'] } },
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: { user: { select: { email: true } } },
      }),

      // Group by IP to find attackers (Raw SQL needed for GroupBy in some Prisma versions, but we'll use simplified logic here)
      prisma.activityLog.groupBy({
        by: ['ipAddress'],
        where: { action: 'LOGIN_FAILED' },
        _count: { action: true },
        orderBy: { _count: { action: 'desc' } },
        take: 5,
      }),
    ]);

    return {
      dailyTotal: totalLogs,
      dailyFailed: failedLogins,
      recentThreats: recentThreats.map(t => ({
        type: t.action,
        user: t.user?.email || 'Unknown',
        ip: t.ipAddress,
        time: t.createdAt,
      })),
      topAttackers: topIps.map(ip => ({
        ip: ip.ipAddress,
        count: ip._count.action,
      })),
    };
  }

  /**
   * 5. [ADMIN] Get Paginated All Logs
   */
  async getAllLogs(page = 1, limit = 20, filter = null) {
    const skip = (page - 1) * limit;
    const where = filter ? { action: filter } : {};

    const [logs, total] = await Promise.all([
      prisma.activityLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { email: true, name: true, role: true } },
        },
      }),
      prisma.activityLog.count({ where }),
    ]);

    return { logs, total, pages: Math.ceil(total / limit) };
  }
}

module.exports = new SecurityService();
