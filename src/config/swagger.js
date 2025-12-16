const swaggerJsdoc = require('swagger-jsdoc');
const path = require('path'); // <--- Import path

const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Rentverse Backend API',
      version: '1.0.0',
      description: 'API documentation for Rentverse backend application',
      contact: {
        name: 'API Support',
        email: 'support@rentverse.com',
      },
    },
    servers: [
      {
        // Auto-detects the current server (Works for Vercel & Local)
        url:
          process.env.SERVER_URL ||
          'https://rentverse-backend-d1k25woyg-shafiq-sazalis-projects.vercel.app',
        description: 'Production Server (Vercel)',
      },
      {
        url: `http://localhost:${process.env.PORT || 3005}`,
        description: 'Local Development',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
    security: [
      {
        bearerAuth: [],
      },
    ],
  },
  // Use path.join(process.cwd()) to correctly find files on Vercel
  apis: [
    path.join(process.cwd(), 'src/routes/*.js'),
    path.join(process.cwd(), 'src/modules/*/*.routes.js'),
    path.join(process.cwd(), 'src/app.js'),
  ],
};

const specs = swaggerJsdoc(swaggerOptions);

module.exports = specs;
