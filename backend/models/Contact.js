const mongoose = require('mongoose');
const ContactGroup = require('./ContactGroup');

const contactSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  recipientName: {
    type: String,
    required: [true, 'Please add a recipient name'],
    trim: true
  },
  phoneNumber: {
    type: String,
    required: [true, 'Please add a phone number'],
    match: [
      /^(?:\+233|233|0)(?:20|50|24|54|27|57|26|56|23|53|28|58|25|55|59)[0-9]{7}$/,
      'Please add a valid Ghana phone number'
    ],
    index: true
  },
  normalizedPhoneNumber: {
    type: String,
    required: true,
    index: true
  },
  groupIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ContactGroup',
    index: true
  }],
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
  }, {
    toJSON: {
      transform: function(doc, ret) {
        // Add groupName as comma-separated string from groupIds
        if (ret.groupIds && ret.groupIds.length > 0) {
          // groupIds will be populated if populate() was used, otherwise just show IDs
          if (Array.isArray(ret.groupIds)) {
            if (ret.groupIds[0] && ret.groupIds[0].name) {
              ret.groupName = ret.groupIds.map(g => g.name).join(', ');
            } else {
              ret.groupName = 'General'; // Default if not populated
            }
          }
        } else {
          ret.groupName = 'General';
        }
        return ret;
      }
    }
  });

    // Add unique compound index to prevent duplicate phone numbers per user
    contactSchema.index({ userId: 1, normalizedPhoneNumber: 1 }, { unique: true });

    // Static method to find contacts by user ID (with group population)
    contactSchema.statics.findByUserId = function(userId) {
      return this.find({ userId: userId })
        .populate('groupIds', 'name')
        .sort({ createdAt: -1 });
    };

// Static method to find contact by ID (with group population)
contactSchema.statics.findById = function(id) {
  return this.findOne({ _id: id }).populate('groupIds', 'name');
};

// Static method to create contact with proper group handling
// Uses findOneAndUpdate with upsert for atomic duplicate prevention
contactSchema.statics.create = async function(userId, recipientName, phoneNumber, groupName) {
  console.log('[Contacts] Creating contact', { userId, recipientName, phoneNumber, groupName });
  
  const ContactGroup = mongoose.model('ContactGroup');
  
  // Normalize phone number before checking for duplicates
  let normalized = phoneNumber.replace(/\D/g, '');
  if (normalized.startsWith('233') && normalized.length === 12) {
    // Already in 233 format
  } else if (normalized.startsWith('0') && normalized.length === 10) {
    normalized = '233' + normalized.substring(1);
  } else if (normalized.length === 9) {
    normalized = '233' + normalized;
  }
  
  // Resolve groupName to groupIds array
  let groupIds = [];
  if (groupName && groupName.trim()) {
    // Find or create group for this user
    let group = await ContactGroup.findByUserAndName(userId, groupName.trim());
    if (!group) {
      group = new ContactGroup({
        userId,
        name: groupName.trim(),
        description: `Created for contact ${recipientName}`
      });
      await group.save();
      console.log('[Contacts] Created new group', { groupName });
    }
    groupIds = [group._id];
  } else {
    // Default to 'General' group (find or create)
    let generalGroup = await ContactGroup.findByUserAndName(userId, 'General');
    if (!generalGroup) {
      generalGroup = new ContactGroup({
        userId,
        name: 'General',
        description: 'Default group for contacts'
      });
      await generalGroup.save();
      console.log('[Contacts] Created default General group');
    }
    groupIds = [generalGroup._id];
  }
  
  // Use findOneAndUpdate with upsert for atomic duplicate prevention
  const contact = await this.findOneAndUpdate(
    { userId, normalizedPhoneNumber: normalized },
    { 
      userId, 
      recipientName, 
      phoneNumber,
      normalizedPhoneNumber: normalized,
      groupIds,
      updatedAt: new Date()
    },
    { 
      upsert: true, 
      new: true, 
      setDefaultsOnInsert: true 
    }
  );
  
  console.log('[Contacts] Contact created', { 
    contactId: contact._id, 
    recipientName, 
    phoneNumber,
    normalizedPhoneNumber: normalized,
    groupIds 
  });
  return contact._id;
};

// Static method to update contact with proper group handling
contactSchema.statics.update = async function(id, recipientName, phoneNumber, groupName) {
  const ContactGroup = mongoose.model('ContactGroup');
  const contact = await this.findById(id);
  if (!contact) {
    throw new Error('Contact not found');
  }
  const userId = contact.userId;
  
  // Normalize phone number
  let normalized = phoneNumber.replace(/\D/g, '');
  if (normalized.startsWith('233') && normalized.length === 12) {
    // Already in 233 format
  } else if (normalized.startsWith('0') && normalized.length === 10) {
    normalized = '233' + normalized.substring(1);
  } else if (normalized.length === 9) {
    normalized = '233' + normalized;
  }
  
  // Resolve groupName to groupIds array
  let groupIds;
  if (groupName && groupName.trim()) {
    // Find or create group for this user
    let group = await ContactGroup.findByUserAndName(userId, groupName.trim());
    if (!group) {
      group = new ContactGroup({
        userId,
        name: groupName.trim(),
        description: `Updated for contact ${recipientName}`
      });
      await group.save();
    }
    groupIds = [group._id];
  } else {
    // Default to 'General' group
    let generalGroup = await ContactGroup.findByUserAndName(userId, 'General');
    if (!generalGroup) {
      generalGroup = new ContactGroup({
        userId,
        name: 'General',
        description: 'Default group for contacts'
      });
      await generalGroup.save();
    }
    groupIds = [generalGroup._id];
  }
  
  return this.findByIdAndUpdate(id, {
    recipientName,
    phoneNumber,
    normalizedPhoneNumber: normalized,
    groupIds,
    updatedAt: new Date()
  }, { new: true });
};

// Auto-normalize phone number before validation (so required field is set)
contactSchema.pre('validate', function(next) {
  if (this.phoneNumber) {
    let normalized = this.phoneNumber.replace(/\D/g, '');
    
    if (normalized.startsWith('233') && normalized.length === 12) {
      // Already in 233 format
    } else if (normalized.startsWith('0') && normalized.length === 10) {
      // Convert 0XXXXXXXXX to 233XXXXXXXXX
      normalized = '233' + normalized.substring(1);
    } else if (normalized.length === 9) {
      // Add country code
      normalized = '233' + normalized;
    }
    
    this.normalizedPhoneNumber = normalized;
  }
  next();
});

// Ensure normalizedPhoneNumber is set before save
contactSchema.pre('save', function(next) {
  if (this.phoneNumber && !this.normalizedPhoneNumber) {
    let normalized = this.phoneNumber.replace(/\D/g, '');
    if (normalized.startsWith('233') && normalized.length === 12) {
      // Already in 233 format
    } else if (normalized.startsWith('0') && normalized.length === 10) {
      normalized = '233' + normalized.substring(1);
    } else if (normalized.length === 9) {
      normalized = '233' + normalized;
    }
    this.normalizedPhoneNumber = normalized;
  }
  next();
});

// Update the updatedAt field on save
contactSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Static method to delete contact
contactSchema.statics.delete = function(id) {
  return this.findByIdAndDelete(id);
};

module.exports = mongoose.model('Contact', contactSchema);
