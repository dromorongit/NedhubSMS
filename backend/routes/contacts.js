const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const Contact = require('../models/Contact');
const validator = require('validator');

// Create contact
router.post('/', authenticate, async (req, res) => {
  try {
    const { name, phoneNumber, groupName } = req.body;
    const userId = req.user.userId;

    // Validate input
    if (!name || !phoneNumber) {
      return res.status(400).json({ error: 'Name and phone number are required' });
    }

    // Validate Ghana phone number format
    if (!validator.isMobilePhone(phoneNumber, 'any', { strictMode: false })) {
      return res.status(400).json({ error: 'Invalid phone number format' });
    }

    // Create contact
    const contactId = await Contact.create(userId, name, phoneNumber, groupName);

    res.status(201).json({ contactId, message: 'Contact created successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all contacts for user
router.get('/', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    const contacts = await Contact.findByUserId(userId);
    res.json(contacts);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update contact
router.put('/:id', authenticate, async (req, res) => {
  try {
    const { name, phoneNumber, groupName } = req.body;
    const contactId = req.params.id;
    const userId = req.user.userId;

    // Validate input
    if (!name || !phoneNumber) {
      return res.status(400).json({ error: 'Name and phone number are required' });
    }

    // Check if contact exists and belongs to user
    const contact = await Contact.findById(contactId);
    if (!contact || contact.user_id !== userId) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    // Update contact
    await Contact.update(contactId, name, phoneNumber, groupName);

    res.json({ message: 'Contact updated successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete contact
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const contactId = req.params.id;
    const userId = req.user.userId;

    // Check if contact exists and belongs to user
    const contact = await Contact.findById(contactId);
    if (!contact || contact.user_id !== userId) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    // Delete contact
    await Contact.delete(contactId);

    res.json({ message: 'Contact deleted successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;