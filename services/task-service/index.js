const express = require('express');
const fetch = require('node-fetch');
const mongoose = require('mongoose');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3002;

app.use(express.json());

// MongoDB connection
const MONGO_URL = process.env.MONGO_URL || 'mongodb://admin:password123@mongodb:27017/taskflow?authSource=admin';

mongoose.connect(MONGO_URL)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// Task Schema
const taskSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, default: '' },
  userId: { type: String, required: true },
  status: { type: String, default: 'pending' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date }
});

const Task = mongoose.model('Task', taskSchema);

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
      const userResponse = await fetch(`http://user-service:3001/api/users`);
      const userData = await userResponse.json();
      const userExists = userData.users.some(u => u._id === userId);
      
      if (!userExists) {
        return res.status(400).json({ error: 'User does not exist' });
      }
    } catch (error) {
      return res.status(503).json({ error: 'User service unavailable' });
    }

    const task = new Task({
      title,
      description: description || '',
      userId,
      status: 'pending'
    });

    await task.save();
    res.status(201).json({ message: 'Task created', task });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get all tasks
app.get('/api/tasks', async (req, res) => {
  try {
    const { userId } = req.query;
    
    const filter = userId ? { userId } : {};
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
    
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
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
    
    const task = await Task.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    );
    
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
    res.json({ message: 'Task updated', task });

  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete task
app.delete('/api/tasks/:id', async (req, res) => {
  try {
    const task = await Task.findByIdAndDelete(req.params.id);
    
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
    res.json({ message: 'Task deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.listen(PORT, () => {
  console.log(`Task Service running on port ${PORT}`);
});
