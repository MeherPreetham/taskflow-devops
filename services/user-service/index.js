const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const promClient = require('prom-client');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;
app.use(express.json());

// PROMETHEUS SETUP
const register = new promClient.Registry();
promClient.collectDefaultMetrics({ register });

const httpRequestCounter = new promClient.Counter({
  name: 'user_service_http_requests_total',
  help: 'Total HTTP requests to user-service',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register]
});

const httpRequestDuration = new promClient.Histogram({
  name: 'user_service_http_request_duration_seconds',
  help: 'HTTP request duration for user-service',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2],
  registers: [register]
});

const registeredUsersGauge = new promClient.Gauge({
  name: 'user_service_registered_users_total',
  help: 'Total number of registered users',
  registers: [register]
});

const failedLoginsCounter = new promClient.Counter({
  name: 'user_service_failed_logins_total',
  help: 'Total number of failed login attempts',
  registers: [register]
});

// MIDDLEWARE
app.use((req, res, next) => {
  const end = httpRequestDuration.startTimer();
  res.on('finish', () => {
    const labels = {
      method: req.method,
      route: req.route ? req.route.path : req.path,
      status_code: res.statusCode
    };
    httpRequestCounter.inc(labels);
    end(labels);
  });
  next();
});

// MONGODB CONNECTION
const MONGO_URL = process.env.MONGO_URL || 
  'mongodb://admin:password123@mongodb:27017/taskflow?authSource=admin';

mongoose.connect(MONGO_URL)
  .then(async () => {
    console.log('Connected to MongoDB');
    // Set initial gauge value on startup
    const count = await User.countDocuments();
    registeredUsersGauge.set(count);
  })
  .catch(err => console.error('MongoDB connection error:', err));

// USER SCHEMA
const userSchema = new mongoose.Schema({
  username: { type: String, required: true },
  email:    { type: String, required: true, unique: true },
  password: { type: String, required: true },
  createdAt:{ type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

// JWT MIDDLEWARE 
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // "Bearer TOKEN"

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key', (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid or expired token' });
    req.user = user;
    next();
  });
};

// ROUTES
// HEALTH CHECK
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'user-service' });
});

// REGISTER
app.post('/api/users/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ username, email, password: hashedPassword });
    await user.save();

    // Update gauge — new user registered
    registeredUsersGauge.inc();

    res.status(201).json({
      message: 'User registered successfully',
      user: { id: user._id, username: user.username, email: user.email }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

// LOGIN
app.post('/api/users/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });

    if (!user) {
      failedLoginsCounter.inc(); // Track failed attempt
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      failedLoginsCounter.inc(); // Track failed attempt
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { userId: user._id, email: user.email },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '24h' }
    );

    res.json({
      message: 'Login successful',
      token,
      user: { id: user._id, username: user.username, email: user.email }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET ALL USERS
app.get('/api/users', authenticateToken, async (req, res) => {
  try {
    const users = await User.find({}, '-password');
    res.json({ users });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// METRICS ENDPOINT
app.get('/metrics', async (req, res) => {
  res.setHeader('Content-Type', register.contentType);
  res.send(await register.metrics());
});

app.listen(PORT, () => {
  console.log(`User Service running on port ${PORT}`);
  console.log(`Metrics at http://localhost:${PORT}/metrics`);
});
