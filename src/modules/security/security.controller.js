const securityService = require('./security.service');

class SecurityController {
  async getStats(req, res) {
    try {
      const stats = await securityService.getDashboardStats();
      res.json({ success: true, data: stats });
    } catch (error) {
      console.error('Stats Error:', error);
      res
        .status(500)
        .json({ success: false, message: 'Failed to fetch stats' });
    }
  }

  async getAllLogs(req, res) {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 20;
      const filter = req.query.filter || null;

      const result = await securityService.getAllLogs(page, limit, filter);
      res.json({ success: true, data: result });
    } catch (error) {
      console.error('Logs Error:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch logs' });
    }
  }
}

module.exports = new SecurityController();
