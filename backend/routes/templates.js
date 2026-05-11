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
       return res.status(400).json({
         success: false,
         message: 'Title and content are required',
         error: { code: 'VALIDATION_ERROR' }
       });
     }

     // Create new template
     const newTemplate = new Template({
       userId,
       title,
       content
     });

     await newTemplate.save();

     res.status(201).json({
       success: true,
       message: 'Template created successfully',
       data: {
         template: {
           id: newTemplate._id,
           title: newTemplate.title,
           content: newTemplate.content,
           segments: newTemplate.segments,
           encoding: newTemplate.encoding
         }
       }
     });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        details: error.message
      }
    });
  }
});

// Get user's templates
router.get('/', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    const templates = await Template.find({ userId }).sort({ createdAt: -1 });

    res.json({
      success: true,
      message: 'Templates retrieved successfully',
      data: templates
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve templates',
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        details: error.message
      }
    });
  }
});

// Get specific template
router.get('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

     const template = await Template.findOne({ _id: id, userId });
     if (!template) {
       return res.status(404).json({
         success: false,
         message: 'Template not found',
         error: { code: 'NOT_FOUND' }
       });
     }

     res.json({
       success: true,
       message: 'Template retrieved successfully',
       data: template
     });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        details: error.message
      }
    });
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
       return res.status(400).json({
         success: false,
         message: 'Title and content are required',
         error: { code: 'VALIDATION_ERROR' }
       });
     }

     const template = await Template.findOne({ _id: id, userId });
     if (!template) {
       return res.status(404).json({
         success: false,
         message: 'Template not found',
         error: { code: 'NOT_FOUND' }
       });
     }

     template.title = title;
     template.content = content;
     await template.save();

     res.json({
       success: true,
       message: 'Template updated successfully',
       data: {
         template: {
           id: template._id,
           title: template.title,
           content: template.content,
           segments: template.segments,
           encoding: template.encoding
         }
       }
     });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        details: error.message
      }
    });
  }
});

// Delete template
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

     const template = await Template.findOneAndDelete({ _id: id, userId });
     if (!template) {
       return res.status(404).json({
         success: false,
         message: 'Template not found',
         error: { code: 'NOT_FOUND' }
       });
     }

     res.json({
       success: true,
       message: 'Template deleted successfully'
     });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        details: error.message
      }
    });
  }
});

module.exports = router;