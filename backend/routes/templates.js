const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const Template = require('../models/Template');

// Create new template
router.post('/', authenticate, async (req, res) => {
  try {
    const { title, content } = req.body;
    const userId = req.user.userId;

    // Validate input
    if (!title || !content) {
      return res.status(400).json({ error: 'Title and content are required' });
    }

    // Create new template
    const newTemplate = new Template({
      userId,
      title,
      content
    });

    await newTemplate.save();

    res.status(201).json({
      message: 'Template created successfully',
      template: {
        id: newTemplate._id,
        title: newTemplate.title,
        content: newTemplate.content,
        segments: newTemplate.segments,
        encoding: newTemplate.encoding
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Get user's templates
router.get('/', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    const templates = await Template.find({ userId }).sort({ createdAt: -1 });

    res.json(templates);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get specific template
router.get('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    const template = await Template.findOne({ _id: id, userId });
    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    res.json(template);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update template
router.put('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;
    const userId = req.user.userId;

    // Validate input
    if (!title || !content) {
      return res.status(400).json({ error: 'Title and content are required' });
    }

    const template = await Template.findOne({ _id: id, userId });
    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    template.title = title;
    template.content = content;
    await template.save();

    res.json({
      message: 'Template updated successfully',
      template: {
        id: template._id,
        title: template.title,
        content: template.content,
        segments: template.segments,
        encoding: template.encoding
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Delete template
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    const template = await Template.findOneAndDelete({ _id: id, userId });
    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    res.json({ message: 'Template deleted successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;