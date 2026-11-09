const mongoose = require('mongoose');

const queueItemSchema = new mongoose.Schema({
  room_code: {
    type: String,
    required: true,
    uppercase: true,
    trim: true,
    index: true
  },
  title: {
    type: String,
    required: true,
    trim: true
  },
  media_url: {
    type: String,
    required: true,
    trim: true
  },
  duration: {
    type: String,
    default: '03:45'
  },
  added_by: {
    type: String,
    default: 'Guest',
    trim: true
  },
  position: {
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

queueItemSchema.virtual('id').get(function() {
  return this._id ? this._id.toString() : undefined;
});

module.exports = mongoose.models.QueueItem || mongoose.model('QueueItem', queueItemSchema);

