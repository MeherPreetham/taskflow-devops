const express = require('express');
const fetch = require('node-fetch');
const mongoose = require('mongoose');
const promClient = require('prom-client');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3002;

app.use(express.json());

// PROMETHEUS SETUP
const register = new promClient.Registry();
promClient.collectionDefaultMetrics({ register });

const httpRequestCounter = new promClient.Counter({
  name: 'task_service_http_requests_total',
  help: 'Total HTTP requests to task-service',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register]
});

const httpRequestDuration = new promClient.Histogram({
  name: 'task_service_http_request_duration_seconds',
  help: 'HTTP request duration for task-service',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2],
  registers: [register]
});

const activeTasksGauge = new promClient.Gauge({
  name: 'task_service_active_tasks_total',
  help: 'Current number of active tasks in DB',
  registers: [register]
});

const userServiceErrorCounter = new promClient.Counter({
  name: 'task_service_user_service_errors_total',
  help: 'Number of times user-service was unreachable',
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

// MongoDB connection
const MONGO_URL = process.env.MONGO_URL ||
  'mongodb://admin:password123@mongodb:27017/taskflow?authSource=admin';

mongoose.connect(MONGO_URL)
  .then(async () => {
    console.log('Connected to MongoDB');
    const count = await Task.countDocuments();
    activeTasksGauge.set(count);
  })
  .catch(err => console.error('MongoDB connection error:', err));

// Task Schema
const taskSchema = new mongoose.Schema({
  title:       { type: String, required: true },
  description: { type: String, default: '' },
  userId:      { type: String, required: true },
  status:      { type: String, default: 'pending' },
  createdAt:   { type: Date, default: Date.now },
  updatedAt:   { type: Date }
});

const Task = mongoose.model('Task', taskSchema);

// ----------------------------------ROUTES----------------------------------
// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'task-service' });
});

// Create task
app.post('/api/tasks', async (req, res) => {
  try {
    const { title, description, userId } = req.body;
    if (!title || !userId) {
      return res.status(400).json({ error: 'Title and userId are required' });
    }

    // Verify user exists
    try {
      const userResponse = await fetch(
        `http://user-service:3001/api/users/${userId}`
      );
      if (!userResponse.ok) {
        return res.status(400).json({ error: 'User does not exist' });
      }
    } catch (error) {
      // Track when user-service is unreachable — visible on Grafana
      userServiceErrorCounter.inc();
      return res.status(503).json({ error: 'User service unavailable' });
    }

    const task = new Task({ title, description: description || '', userId });
    await task.save();

// Update Gauge
    
    activeTasksGauge.inc();

    res.status(201).json({ message: 'Task created', task });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get all tasks
app.get('/api/tasks', async (req, res) => {
  try {
    const filter = req.query.userId ? { userId: req.query.userId } : {};
    const tasks = await Task.find(filter);
    res.json({ tasks });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get single task
app.get('/api/tasks/:id', async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json({ task });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Update task
app.put('/api/tasks/:id', async (req, res) => {
  try {
    const { title, description, status } = req.body;
    const updateData = {};
    if (title) updateData.title = title;
    if (description) updateData.description = description;
    if (status) updateData.status = status;
    updateData.updatedAt = new Date();

    const task = await Task.findByIdAndUpdate(req.params.id, updateData, { new: true });
    if (!task) return res.status(404).json({ error: 'Task not found' });

    res.json({ message: 'Task updated', task });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete task
app.delete('/api/tasks/:id', async (req, res) => {
  try {
    const task = await Task.findByIdAndDelete(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });

    // Update gauge — one less task
    activeTasksGauge.dec();

    res.json({ message: 'Task deleted' });
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
  console.log(`Task Service running on port ${PORT}`);
  console.log(`Metrics at http://localhost:${PORT}/metrics`);
});
