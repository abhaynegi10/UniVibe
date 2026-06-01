// routes/auth.js
const express = require('express');
const passport = require('passport');
const { registerUser, loginUser } = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User');

const router = express.Router();

// In-memory store for short-lived OAuth codes (keyed by random code string)
// Each entry expires after 60 seconds
const oauthCodeStore = {};

// --- Helper to generate JWT token ---
const generateToken = (id) => {
    return jwt.sign({ id }, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES_IN || '1d',
    });
};

// ============================================================
// PUBLIC ROUTES
// ============================================================

// @route   POST /api/auth/register
// @access  Public
router.post('/register', registerUser);

// @route   POST /api/auth/login
// @access  Public
router.post('/login', loginUser);

// ============================================================
// PROTECTED ROUTES
// ============================================================

// @route   GET /api/auth/me
// @desc    Get currently authenticated user's data
// @access  Protected (requires valid JWT)
router.get('/me', protect, (req, res) => {
    // req.user is attached by the protect middleware
    res.json({
        success: true,
        user: {
            _id: req.user._id,
            username: req.user.username,
            gender: req.user.gender,
            preference: req.user.preference,
        },
    });
});

// ============================================================
// GOOGLE OAUTH ROUTES
// ============================================================

// Step A: Redirect to Google for authentication
// GET /api/auth/google
router.get('/google', passport.authenticate('google', {
    scope: ['profile', 'email']
}));

// Step B: Google redirects back here after successful authentication
// GET /api/auth/google/callback
router.get(
    '/google/callback',
    passport.authenticate('google', {
        failureRedirect: `/login?error=google_auth_failed`,
        session: false
    }),
    async (req, res) => {
        if (!req.user) {
            console.error('Google callback success but req.user is missing!');
            return res.redirect(`/login?error=auth_failed`);
        }

        console.log(`Google auth successful for user: ${req.user.username} (ID: ${req.user._id})`);

        // Generate our JWT token
        const token = generateToken(req.user._id);

        // --- PRIORITY 4: Secure token handoff via short-lived one-time code ---
        // Instead of putting the JWT in the URL, we store it server-side
        // and give the frontend a random code to exchange for it.
        const code = crypto.randomBytes(24).toString('hex');
        oauthCodeStore[code] = {
            token,
            user: {
                _id: req.user._id,
                username: req.user.username,
                gender: req.user.gender,
                preference: req.user.preference,
            },
            expiresAt: Date.now() + 60_000, // Code valid for 60 seconds
        };

        console.log(`Redirecting to frontend with one-time code (code=${code.substring(0, 8)}...)`);
        // Redirect with just the code — no JWT in the URL
        res.redirect(`/auth/callback?code=${code}`);
    }
);

// Step C: Frontend exchanges the one-time code for the real JWT
// POST /api/auth/token-exchange
router.post('/token-exchange', (req, res) => {
    const { code } = req.body;

    if (!code) {
        return res.status(400).json({ success: false, message: 'No code provided' });
    }

    const entry = oauthCodeStore[code];

    if (!entry) {
        return res.status(401).json({ success: false, message: 'Invalid or already used code' });
    }

    if (Date.now() > entry.expiresAt) {
        delete oauthCodeStore[code];
        return res.status(401).json({ success: false, message: 'Code has expired, please sign in again' });
    }

    // One-time use: delete after retrieval
    const { token, user } = entry;
    delete oauthCodeStore[code];

    console.log(`Token exchanged successfully for user: ${user.username}`);
    res.json({ success: true, token, user });
});

module.exports = router;