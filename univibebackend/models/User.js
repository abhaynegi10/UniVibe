// models/User.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const UserSchema = new mongoose.Schema({
  googleId: { // <-- Add Google ID field
    type: String,
    // Not required, only for Google users
  },
  username: {
    type: String,
    required: [true, 'Please provide a username'],
    unique: true,
    trim: true,
  },
  password: {
    type: String,
    required: [true, 'Please provide a password'],
    minlength: 6,
    select: false, // Prevent password from being sent back by default in queries
  },
  gender: {
    type: String,
    required: [true, 'Please specify your gender'],
    enum: ['male', 'female', 'other'], // Restrict possible values
    default: function() { return this.googleId ? 'other' : undefined; } // Default for Google users
  },
  preference: {
    type: String,
    required: [true, 'Please specify your preference'],
    enum: ['male', 'female', 'any'], // Restrict possible values
    default: function() { return this.googleId ? 'any' : 'any'; },
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// --- Mongoose Middleware (Hooks) ---

// Hash password BEFORE saving user to database (only if modified)
UserSchema.pre('save', async function (next) {
  if (!this.isModified('password') || !this.password) { // Check if password exists
    return next();
  }
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (err) {
    next(err);
  }
});

// --- Mongoose Instance Methods ---
UserSchema.methods.matchPassword = async function (enteredPassword) {
  if (!this.password) return false; // Cannot match if no password stored
  return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('User', UserSchema);