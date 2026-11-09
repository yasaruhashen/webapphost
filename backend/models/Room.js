const mongoose = require('mongoose');

const roomSchema = new mongoose.Schema({
  code: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    trim: true,
    index: true
  },
  title: {
    type: String,
    required: true,
    trim: true
  },
  category: {
    type: String,
    default: 'Study Group',
    trim: true
  },
  host_name: {
    type: String,
    required: true,
    trim: true
  },
  host_email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    index: true
  },
  user_id: {
    type: String,
    default: null
  },
  is_private: {
    type: Number,
    default: 0
  },
  passcode: {
    type: String,
    default: null
  },
  media_url: {
    type: String,
    default: 'https://www.youtube.com/watch?v=MsRSKLbz3ss'
  },
  media_title: {
    type: String,
    default: 'Data Structures & Algorithms - Dynamic Programming'
  },
  media_source: {
    type: String,
    default: 'YouTube (HD 1080p)'
  },
  current_time: {
    type: Number,
    default: 0
  },
  is_playing: {
    type: Number,
    default: 0
  },
  active_members: {
    type: Number,
    default: 1
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

roomSchema.virtual('id').get(function() {
  return this._id ? this._id.toString() : undefined;
});

module.exports = mongoose.models.Room || mongoose.model('Room', roomSchema);

