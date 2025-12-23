const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express(); // ✅ app defined FIRST
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Connection
const MONGODB_URI =
  process.env.MONGODB_URI || 'mongodb://localhost:27017/tiffin_mvp';

mongoose
  .connect(MONGODB_URI)
  .then(() => {
    console.log('Connected to MongoDB');
  })
  .catch((error) => {
    console.error('MongoDB connection error:', error);
  });

// Import routes (ONLY ONCE)
const providersRouter = require('./routes/providers');
const subscriptionsRouter = require('./routes/subscriptions');

// Use routes (ONLY AFTER app is defined)
app.use('/api/providers', providersRouter);
app.use('/api/subscriptions', subscriptionsRouter);

// Root route
app.get('/', (req, res) => {
  res.json({ message: 'TiffinMate API is running' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
