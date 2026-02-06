require('dotenv').config();

console.log('🚀 Starting The Home Kitchen Backend Server...');

// Defensive imports with error handling
let express, cors, helmet, compression, morgan, http;
try {
  express = require('express');
  cors = require('cors');
  helmet = require('helmet');
  compression = require('compression');
  morgan = require('morgan');
  http = require('http');
  console.log('✅ Core dependencies loaded');
} catch (error) {
  console.error('❌ Failed to load core dependencies:', error.message);
  process.exit(1);
}

// Initialize Express app
const app = express();
app.set('trust proxy', 1);
console.log('✅ Express app initialized');

// Apply security and utility middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true
}));
app.use(compression());
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

console.log('✅ Middleware applied');

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development'
  });
});

console.log('✅ Health endpoint added');

// Import and apply routes with defensive loading
console.log('🔄 Loading routes...');

try {
  const authRoutes = require('./routes/authRoutes');
  app.use('/api/auth', authRoutes);
  console.log('✅ authRoutes loaded');
} catch (error) {
  console.error('❌ Failed to load authRoutes:', error.message);
  // Continue without exiting - auth is critical but let's try others
}

try {
  const userRoutes = require('./routes/userRoutes');
  app.use('/api/users', userRoutes);
  console.log('✅ userRoutes loaded');
} catch (error) {
  console.error('❌ Failed to load userRoutes:', error.message);
}

try {
  const subscriptionRoutes = require('./routes/subscriptionRoutes');
  app.use('/api/subscriptions', subscriptionRoutes);
  console.log('✅ subscriptionRoutes loaded');
} catch (error) {
  console.error('❌ Failed to load subscriptionRoutes:', error.message);
}

// Service area routes - optional, wrap in try/catch as per requirements
try {
  const serviceAreaRoutes = require('./routes/serviceAreaRoutes');
  app.use('/api/service-areas', serviceAreaRoutes);
  console.log('✅ serviceAreaRoutes loaded');
} catch (error) {
  console.warn('⚠️ serviceAreaRoutes failed to load (optional):', error.message);
  console.log('🚨 Server will continue without service area functionality');
}

// Load remaining routes
const routesToLoad = [
  { path: '/api/subscription-plans', file: 'subscriptionPlanRoutes' },
  { path: '/api/payments', file: 'paymentRoutes' },
  { path: '/api/meals', file: 'mealRoutes' },
  { path: '/api/deliveries', file: 'deliveryRoutes' },
  { path: '/api/notifications', file: 'notificationRoutes' },
  { path: '/api/app-notifications', file: 'appNotificationRoutes' },
  { path: '/api/leads', file: 'leadRoutes' },
  { path: '/api/calendar', file: 'calendarRoutes' },
  { path: '/api/access-requests', file: 'accessRequestRoutes' }
];

routesToLoad.forEach(({ path, file }) => {
  try {
    const route = require(`./routes/${file}`);
    app.use(path, route);
    console.log(`✅ ${file} loaded`);
  } catch (error) {
    console.warn(`⚠️ Failed to load ${file}:`, error.message);
  }
});

// Load admin routes with improved logging
try {
  const adminRoutes = require('./routes/adminRoutes');
  app.use('/api/admin', adminRoutes);
  console.log('✅ adminRoutes loaded');
} catch (error) {
  console.error('❌ adminRoutes failed:', error);
}

console.log('✅ Route loading completed');

// Global error handler
app.use((err, req, res, next) => {
  console.error('Global error:', err);
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

// Connect to database
console.log('🔄 Connecting to MongoDB...');
const connectDB = require('./config/database');

connectDB().then(() => {
  console.log('✅ Database connected successfully');

  // Start cron jobs only after DB connection
  if (process.env.ENABLE_CRON === 'true') {
    try {
      console.log('🔄 Starting cron jobs...');
      const cronService = require('./services/cronService');
      cronService.startAllJobs();
      console.log('✅ Cron jobs started');
    } catch (error) {
      console.error('❌ Failed to start cron jobs:', error.message);
      // Don't exit - server can run without cron jobs
    }
  } else {
    console.log('⏭️ Cron jobs disabled (ENABLE_CRON != true)');
  }

  // Create HTTP server
  const server = http.createServer(app);
  const PORT = process.env.PORT || 5000;

  // Initialize Socket.IO after server creation
  try {
    console.log('🔄 Initializing Socket.IO...');
    const socketService = require('./services/socketService');
    socketService.initialize(server);
    console.log('✅ Socket.IO initialized');
  } catch (error) {
    console.error('❌ Failed to initialize Socket.IO:', error.message);
    // Continue without Socket.IO
  }

  // Start server
  server.listen(PORT, () => {
    console.log(`🎉 Server running on port ${PORT}`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🏥 Health check: http://localhost:${PORT}/health`);
    console.log('✅ Startup completed successfully!');
  });

  // Handle server errors
  server.on('error', (error) => {
    console.error('❌ Server error:', error);
    process.exit(1);
  });

}).catch((error) => {
  console.error('❌ Database connection failed:', error.message);
  process.exit(1);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT received, shutting down gracefully...');
  process.exit(0);
});
