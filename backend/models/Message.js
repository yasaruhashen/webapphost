const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  room_code: {
    type: String,
    required: true,
    uppercase: true,
    trim: true,
    index: true
  },
  user_name: {
    type: String,
    required: true,
    trim: true
  },
  user_avatar: {
    type: String,
    default: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=80&q=80'
  },
  message: {
    type: String,
    required: true,
    trim: true
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

messageSchema.virtual('id').get(function() {
  return this._id ? this._id.toString() : undefined;
});

module.exports = mongoose.models.Message || mongoose.model('Message', messageSchema);

