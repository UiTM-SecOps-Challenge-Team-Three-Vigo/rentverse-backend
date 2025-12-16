require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const hpp = require('hpp');
const xss = require('xss-clean');
const morgan = require('morgan');
const swaggerUi = require('swagger-ui-express');
const path = require('path');

// Security Middleware
const { globalLimiter } = require('./middleware/rateLimiter');

// Config & Middleware Imports
const { connectDB } = require('./config/database');
const swaggerSpecs = require('./config/swagger');
const sessionMiddleware = require('./middleware/session');

// Import Routes
const authRoutes = require('./routes/auth');
const uploadRoutes = require('./routes/upload');
const userRoutes = require('./modules/users/users.routes');
const propertyRoutes = require('./modules/properties/properties.routes');
const bookingRoutes = require('./modules/bookings/bookings.routes');
const propertyTypeRoutes = require('./modules/propertyTypes/propertyTypes.routes');
const amenityRoutes = require('./modules/amenities/amenities.routes');
const predictionRoutes = require('./modules/predictions/predictions.routes');
const twoFactorAuthRoutes = require('./routes/2fa');
const agreementRoutes = require('./modules/agreements/agreements.routes');
const adminSecurityRoutes = require('./routes/admin-security');

const app = express();

// ==========================================
// 1. PROXY & ENVIRONMENT SETUP
// ==========================================

// Trust ngrok and other proxies (Important for rate limiting & secure cookies)
app.set('trust proxy', 1);

// Handle ngrok/proxy headers
app.use((req, res, next) => {
  if (req.headers['x-forwarded-proto']) {
    req.protocol = req.headers['x-forwarded-proto'];
  }
  if (req.headers['x-forwarded-host']) {
    req.headers.host = req.headers['x-forwarded-host'];
  }
  next();
});

// Connect to database
connectDB();

// ==========================================
// 2. SECURITY MIDDLEWARE STACK (Module 2)
// ==========================================

// A. Helmet: Set secure HTTP headers (ALWAYS FIRST)
app.use(
  helmet({
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

// B. Strict CORS Configuration (MUST BE BEFORE RATE LIMITER)
// This handles the OPTIONS preflight request immediately
app.use(
  cors({
    origin: function (origin, callback) {
      const allowedOrigins = [
        process.env.FRONTEND_URL || 'http://localhost:3000',
        'http://localhost:8000',
        'http://127.0.0.1:3000',
        'https://curious-lively-monster.ngrok-free.app',
        'https://rentverse-backend-production-1e27.up.railway.app', // Add your Vercel URL explicitly here just in case
      ];

      // Allow requests with no origin (mobile apps, curl) or allowed origins
      if (
        !origin ||
        allowedOrigins.indexOf(origin) !== -1 ||
        process.env.NODE_ENV === 'development' ||
        origin.match(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/)
      ) {
        callback(null, true);
      } else {
        console.warn(`Blocked CORS request from: ${origin}`);
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'Accept',
      'Origin',
      'Access-Control-Request-Method',
      'Access-Control-Request-Headers',
      'X-Forwarded-Proto',
      'X-Forwarded-Host',
    ],
    exposedHeaders: [
      'Content-Range',
      'X-Content-Range',
      'RateLimit-Limit',
      'RateLimit-Remaining',
    ],
    maxAge: 86400,
  })
);

// C. Rate Limiting: Prevent DDoS/Brute Force
app.use('/api', globalLimiter);

// D. HPP: Prevent HTTP Parameter Pollution
app.use(hpp());

// E. XSS: Data Sanitization
app.use(xss());

// ==========================================
// 3. STANDARD MIDDLEWARE
// ==========================================

app.use(morgan('combined'));
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(sessionMiddleware);

// ==========================================
// 4. STATIC FILES
// ==========================================

app.use(express.static('public'));

app.use(
  '/api/files/pdfs',
  express.static(path.join(__dirname, '../uploads/pdfs'), {
    setHeaders: (res, path) => {
      if (path.endsWith('.pdf')) {
        res.set('Content-Type', 'application/pdf');
        res.set('Content-Disposition', 'inline');
        res.set('Cache-Control', 'public, max-age=31536000');
        res.set('X-Content-Type-Options', 'nosniff');
      } else {
        res.status(404).end();
      }
    },
  })
);

// ==========================================
// 5. DOCUMENTATION (Swagger) - [FIXED FOR VERCEL]
// ==========================================

// Define robust options that use Public CDNs for CSS/JS
// This prevents Vercel 404s when looking for node_modules files
const swaggerUiOptions = {
  explorer: true,
  customCssUrl:
    'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.0.0/swagger-ui.min.css',
  customJs: [
    'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.0.0/swagger-ui-bundle.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.0.0/swagger-ui-standalone-preset.min.js',
  ],
  customSiteTitle: 'Rentverse API Documentation',
  customfavIcon: '/favicon.ico',
  swaggerOptions: { persistAuthorization: true },
};

app.use(
  '/docs',
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpecs, swaggerUiOptions)
);

// ==========================================
// 6. ROUTES
// ==========================================

app.use('/api/auth', authRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/users', userRoutes);
app.use('/api/properties', propertyRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/property-types', propertyTypeRoutes);
app.use('/api/amenities', amenityRoutes);
app.use('/api/predictions', predictionRoutes);
app.use('/api/2fa', twoFactorAuthRoutes);
app.use('/api/agreements', agreementRoutes);
app.use('/api/admin/security', adminSecurityRoutes);

// ==========================================
// 7. UTILITY ROUTES
// ==========================================

app.get('/', (req, res) => {
  res.json({
    message: 'Welcome to Rentverse Backend API (Secured)',
    version: '1.0.0',
    docs: 'Visit /docs for API documentation',
    database: 'Connected to PostgreSQL via Prisma',
    environment: process.env.NODE_ENV || 'development',
    security: {
      rateLimit: 'Enabled',
      cors: 'Strict',
      headers: 'Helmet Secured',
    },
  });
});

app.get('/health', async (req, res) => {
  try {
    const { prisma } = require('./config/database');
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      status: 'OK',
      timestamp: new Date().toISOString(),
      database: 'Connected',
    });
  } catch (error) {
    res.status(503).json({ status: 'ERROR', error: error.message });
  }
});

// ==========================================
// 8. ERROR HANDLING
// ==========================================

app.use('*', (req, res) => {
  res.status(404).json({ success: false, error: 'Route not found' });
});

app.use((err, req, res, _next) => {
  console.error('Global error handler:', err.stack);
  if (err.code?.startsWith('P')) {
    return res.status(400).json({ success: false, error: 'Database error' });
  }
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      error: 'Validation error',
      message: err.message,
    });
  }
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      error: 'Authentication error',
      message: 'Invalid token',
    });
  }
  res.status(err.status || 500).json({
    success: false,
    error: 'Internal Server Error',
    message:
      process.env.NODE_ENV === 'production'
        ? 'Something went wrong!'
        : err.message,
  });
});

module.exports = app;
