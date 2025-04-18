// models/User.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const UserSchema = new mongoose.Schema({
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
  },
  preference: {
    type: String,
    required: [true, 'Please specify your preference'],
    enum: ['male', 'female', 'any'], // Restrict possible values
    default: 'any',
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// --- Mongoose Middleware (Hooks) ---

// Hash password BEFORE saving user to database (only if modified)
UserSchema.pre('save', async function (next) {
  // Check if password field was actually modified (or is new)
  if (!this.isModified('password')) {
    return next();
  }

  // Hash password
  try {
    const salt = await bcrypt.genSalt(10); // Generate salt
    this.password = await bcrypt.hash(this.password, salt); // Hash password with salt
    next();
  } catch (err) {
    next(err); // Pass error to next middleware/handler
  }
});

// --- Mongoose Instance Methods ---

// Method to compare entered password with hashed password in database
UserSchema.methods.matchPassword = async function (enteredPassword) {
  // 'this.password' refers to the password field of the user document
  return await bcrypt.compare(enteredPassword, this.password);
};


module.exports = mongoose.model('User', UserSchema);