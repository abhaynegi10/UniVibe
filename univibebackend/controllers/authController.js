// controllers/authController.js
const User = require('../models/User');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '1d', // Use expiration from .env or default to 1 day
  });
};

// @desc    Register a new user
// @route   POST /api/auth/register
// @access  Public
exports.registerUser = async (req, res) => {
  const { username, password, gender, preference } = req.body;

  try {
    // 1. Check if required fields are present
    if (!username || !password || !gender || !preference) {
      return res.status(400).json({ success: false, message: 'Please provide username, password, gender, and preference' });
    }

    // 2. Check if user already exists
    const userExists = await User.findOne({ username });
    if (userExists) {
      return res.status(400).json({ success: false, message: 'Username already exists' });
    }

    // 3. Create new user (password will be hashed by pre-save hook in model)
    const user = await User.create({
      username,
      password,
      gender,
      preference,
    });

    // 4. Respond with success and token (optional: log user in immediately)
    // For this example, we just confirm registration. Login is separate.
    if (user) {
      res.status(201).json({
        success: true,
        message: 'User registered successfully',
        // You could optionally generate and send a token here as well
        // token: generateToken(user._id),
        // user: { // Don't send password back!
        //     _id: user._id,
        //     username: user.username,
        //     gender: user.gender,
        //     preference: user.preference
        // }
      });
    } else {
      res.status(400).json({ success: false, message: 'Invalid user data' });
    }
  } catch (error) {
    console.error('Registration Error:', error);
    res.status(500).json({ success: false, message: 'Server Error during registration', error: error.message });
  }
};

// @desc    Authenticate user & get token (Login)
// @route   POST /api/auth/login
// @access  Public
exports.loginUser = async (req, res) => {
  const { username, password } = req.body;

  try {
    // 1. Check if username and password exist
    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Please provide username and password' });
    }

    // 2. Check for user by username & explicitly select password
    const user = await User.findOne({ username }).select('+password');

    // 3. Check if user exists AND password matches
    if (!user || !(await user.matchPassword(password))) {
        // Use generic message to avoid revealing which part was wrong
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    // 4. Respond with token and user info (excluding password)
    res.json({
      success: true,
      message: 'Login successful',
      token: generateToken(user._id),
      user: {
        _id: user._id,
        username: user.username,
        gender: user.gender,
        preference: user.preference
      },
    });
  } catch (error) {
    console.error('Login Error:', error);
    res.status(500).json({ success: false, message: 'Server Error during login' });
  }
};