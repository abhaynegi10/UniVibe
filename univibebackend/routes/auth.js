// routes/auth.js
const express = require('express');
const passport = require('passport');
const { registerUser, loginUser } = require('../controllers/authController'); // Keep your existing controllers
const jwt = require('jsonwebtoken'); // Need JWT again
const User = require('../models/User'); // Need User model

const router = express.Router();

// --- Helper to generate token ---
const generateToken = (id) => {
    return jwt.sign({ id }, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES_IN || '1d',
    });
};

// --- Existing Password Routes ---
router.post('/register', registerUser);
router.post('/login', loginUser);

// --- Google Auth Routes ---

// Step A: Redirect to Google for authentication
// GET /api/auth/google
router.get('/google', passport.authenticate('google', {
    scope: ['profile', 'email'] // Request profile and email info from Google
}));

// Step B: Google redirects back here after successful authentication
// GET /api/auth/google/callback
router.get(
    '/google/callback',
    passport.authenticate('google', {
        failureRedirect: `${process.env.FRONTEND_URL || 'http://localhost:8080'}/login?error=google_auth_failed`, // Redirect to frontend login on failure
        session: false // We aren't using server sessions for the client, just JWT
    }),
    async (req, res) => {
        // Successful authentication! req.user is populated by Passport's deserializeUser
        if (!req.user) {
            console.error("Google callback success but req.user is missing!");
            return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:8080'}/login?error=auth_failed`);
        }

        console.log(`Google auth successful for user: ${req.user.username} (ID: ${req.user._id})`);

        // Generate our JWT token for the user
        const token = generateToken(req.user._id);

        // Fetch minimal user data to send back (or rely on frontend to fetch after redirect)
        // Selecting necessary fields to avoid sending sensitive data accidentally
         const userData = {
             _id: req.user._id,
             username: req.user.username,
             gender: req.user.gender, // May be default 'other'
             preference: req.user.preference // May be default 'any'
         };

        // Redirect back to the frontend, passing the token and user data
        // Using query parameters for simplicity (can be insecure if URL is logged/shared)
        // Consider using cookies or having frontend fetch user data after redirect
        const frontendRedirectUrl = new URL(process.env.FRONTEND_URL || 'http://localhost:8080');
        frontendRedirectUrl.pathname = '/auth/callback'; // Specific frontend path to handle redirect
        frontendRedirectUrl.searchParams.set('token', token);
        frontendRedirectUrl.searchParams.set('user', JSON.stringify(userData)); // Stringify user data

        console.log(`Redirecting to frontend: ${frontendRedirectUrl.toString()}`);
        res.redirect(frontendRedirectUrl.toString());
    }
);

module.exports = router;