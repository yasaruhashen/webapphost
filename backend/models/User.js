const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  password_hash: {
    type: String,
    required: true
  },
  faculty: {
    type: String,
    default: 'Faculty of Computing & Technology'
  },
  role: {
    type: String,
    default: 'host'
  },
  avatar: {
    type: String,
    default: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=80&q=80'
  },
  display_name: {
    type: String,
    default: ''
  },
  institution: {
    type: String,
    default: 'University of Sri Jayewardenepura'
  },
  phone: {
    type: String,
    default: ''
  },
  bio: {
    type: String,
    default: ''
  },
  degree: {
    type: String,
    default: 'BSc (Hons) Computer Science'
  },
  created_at: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  toJSON: {
    virtuals: true,
    transform: (doc, ret) => {
      ret.id = ret._id ? ret._id.toString() : ret.id;
      return ret;
    }
  },
  toObject: {
    virtuals: true,
    transform: (doc, ret) => {
      ret.id = ret._id ? ret._id.toString() : ret.id;
      return ret;
    }
  }
});

// Backward-compatible virtual id
userSchema.virtual('id').get(function() {
  return this._id ? this._id.toString() : undefined;
});

module.exports = mongoose.models.User || mongoose.model('User', userSchema);

