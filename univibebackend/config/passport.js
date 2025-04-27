// config/passport.js
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const mongoose = require('mongoose');
const User = require('../models/User'); // Adjust path if needed
const jwt = require('jsonwebtoken'); // To generate our JWT

// Function to generate JWT token (same as in authController)
const generateToken = (id) => {
    return jwt.sign({ id }, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES_IN || '1d',
    });
};

module.exports = function (passport) {
    passport.use(
        new GoogleStrategy(
            {
                clientID: process.env.GOOGLE_CLIENT_ID,
                clientSecret: process.env.GOOGLE_CLIENT_SECRET,
                callbackURL: '/api/auth/google/callback', // Must match Google Console & routes/auth.js
                proxy: true // Important if behind a proxy (like on Render/Heroku)
            },
            async (accessToken, refreshToken, profile, done) => {
                // This function is called after Google successfully authenticates the user
                console.log('Google Profile Received:', profile);

                const newUser = {
                    googleId: profile.id,
                    username: profile.displayName || `user${profile.id.substring(0, 6)}`, // Use display name or generate one
                    // email: profile.emails ? profile.emails[0].value : null, // Optional: store email
                    // profilePicture: profile.photos ? profile.photos[0].value : null, // Optional: store picture

                    // Set default gender/preference - user MUST update these later!
                    gender: 'other', // Force a default
                    preference: 'any' // Force a default
                    // Note: We DON'T get password, gender, preference from Google
                };

                try {
                    // 1. Find user by Google ID
                    let user = await User.findOne({ googleId: profile.id });

                    if (user) {
                        // User exists - log them in
                        console.log('Google User Found:', user.username);
                        // Pass user object to serializeUser
                        done(null, user);
                    } else {
                        // User doesn't exist - Create new user
                        // Optional: Check if email exists first? (More complex linking logic)
                        console.log('Google User Not Found - Creating New User');
                        user = await User.create(newUser);
                        // Pass newly created user object to serializeUser
                        done(null, user);
                    }
                } catch (err) {
                    console.error('Error during Google Strategy:', err);
                    done(err, null); // Pass error to Passport
                }
            }
        )
    );

    // Used to store user ID in the session during OAuth flow
    passport.serializeUser((user, done) => {
        done(null, user.id); // Store MongoDB user ID
    });

    // Used to retrieve user details from the session using the stored ID
    passport.deserializeUser(async (id, done) => {
         try {
            const user = await User.findById(id);
            done(null, user); // Attach user object to req.user
         } catch (err) {
             done(err, null);
         }
    });
};