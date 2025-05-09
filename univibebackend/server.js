// univibebackend/server.js

const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const http = require('http');
const { Server } = require("socket.io");
const jwt = require('jsonwebtoken');

// +++ ADD these lines +++
const session = require('express-session'); // Import express-session
const passport = require('passport'); // Import passport
// +++ END ADD +++
const User = require('./models/User'); // Assuming models/User.js exists
const connectDB = require('./config/db'); // Assuming config/db.js exists
// +++ ADD this line +++ (If not already importing routes separately)
const authRoutes = require('./routes/auth'); // Import auth routes
// +++ END ADD +++


dotenv.config();
connectDB();

const app = express();
const server = http.createServer(app);



// --- Middleware ---
// Replace your existing app.use(cors()); with this block:
const corsOptions = {
    // Allow your specific frontend origin(s)
    origin: process.env.FRONTEND_URL || ["http://localhost:8080", "http://127.0.0.1:8080"],
    methods: ["GET", "POST"],
    credentials: true // Important for sessions/cookies if used later
};
app.use(cors(corsOptions));
// --- END MODIFY CORS --- // TODO: Configure CORS options for production
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// +++ ADD Session and Passport Middleware HERE (Order Matters!) +++
// --- Session Configuration (BEFORE Passport and API Routes) ---
app.use(session({
    secret: process.env.SESSION_SECRET || 'fallback_super_secret_key_change_me', // Use env variable, provide a fallback
    resave: false, // Don't save session if unmodified
    saveUninitialized: false, // Don't create session until something stored
    // Consider adding cookie settings for production (secure, httpOnly, sameSite)
    // cookie: {
    //    secure: process.env.NODE_ENV === 'production', // Requires HTTPS
    //    httpOnly: true, // Prevent client-side JS access
    //    sameSite: 'lax' // Adjust as needed ('strict', 'lax', 'none')
    // }
}));

// --- Passport Middleware (AFTER Session) ---
app.use(passport.initialize()); // Initialize Passport
app.use(passport.session()); // Allow Passport to use express-session
// +++ END ADD +++

// +++ ADD Passport Configuration Loading HERE (AFTER Passport Middleware) +++
// --- Passport Configuration (Import and Execute) ---
// This line assumes you have created the 'config/passport.js' file
require('./config/passport')(passport); // Pass the passport instance to your config file
// +++ END ADD +++

// --- In-memory store (Replace with Redis for production/scalability) ---
const onlineUsers = {};
// --- Socket.IO Server Initialization ---
const io = new Server(server, {
    // MODIFY Socket.IO CORS to reuse the options from above
    cors: corsOptions
    // END MODIFY Socket.IO CORS
});
// --- Socket.IO Authentication Middleware (Keep as is) ---
io.use(async (socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) { return next(new Error('Auth: No token')); }
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.id).select('username gender preference').lean(); // Ensure required fields selected
        if (!user) { return next(new Error('Auth: User not found')); }
        socket.user = user; socket.userId = user._id.toString(); next();
    } catch (err) {
        const msg = (err.name === 'JsonWebTokenError') ? 'Invalid token' : (err.name === 'TokenExpiredError') ? 'Token expired' : 'Auth failed';
        console.error(`Socket Auth Error (${socket.handshake.address}): ${msg}`);
        return next(new Error(`Authentication error: ${msg}`));
    }
});

// --- Socket.IO Connection Handler ---
io.on('connection', (socket) => {
    console.log(`✅ Connect: ${socket.user.username} (${socket.userId}) | ${socket.id}`);

    // Handle simultaneous connections (keep latest)
    const existingUser = onlineUsers[socket.userId];
    if (existingUser && existingUser.socketId !== socket.id) {
        console.warn(`User ${socket.user.username} reconnected. Disconnecting old socket ${existingUser.socketId}.`);
        const oldSocket = io.sockets.sockets.get(existingUser.socketId);
        if (oldSocket) { oldSocket.emit('force-disconnect', 'Connected elsewhere.'); setTimeout(() => oldSocket.disconnect(true), 500); }
    }

    // Store user state
    onlineUsers[socket.userId] = {
        socketId: socket.id, username: socket.user.username, gender: socket.user.gender,
        preference: socket.user.preference, isSearching: false, currentPeerId: null
    };
    console.log(`Online: ${Object.keys(onlineUsers).length}`);

    // Confirm connection to client
    socket.emit('connection-success', {
        message: `Welcome, ${socket.user.username}!`,
        onlineUserCount: Object.keys(onlineUsers).length
    });

    // --- Assign Event Handlers ---
    socket.on('start-looking', () => handleStartLooking(socket));
    socket.on('stop-looking', () => handleStopLooking(socket));
    socket.on('skip', () => handleSkip(socket));
    socket.on('webrtc-signal', (data) => handleWebRTCSignal(socket, data));
   
    // +++ ADD Handler for Text Messages HERE +++
    socket.on('send-message', ({ toId, message }) => {
        const senderId = socket.userId;
        const recipient = onlineUsers[toId]; // Find recipient in our store

        console.log(`[MsgRelay] User ${senderId} attempting to send message to ${toId}`);

        // Basic validation: Check if recipient exists in our online list
        if (!recipient) {
            console.warn(`[MsgRelay] Recipient ${toId} not found in onlineUsers.`);
            // Optional: Notify sender the user is offline
            // socket.emit('error-occurred', { message: 'Could not send message: User is offline.' });
            return;
        }

        // Security/State Check: Ensure sender and recipient are actually paired according to server state
        const senderUser = onlineUsers[senderId];
        if (!senderUser || senderUser.currentPeerId !== toId || recipient.currentPeerId !== senderId) {
             console.warn(`[MsgRelay] Message attempt between users not currently peered by server: ${senderId} -> ${toId}. Current peers: Sender=${senderUser?.currentPeerId}, Recipient=${recipient.currentPeerId}`);
             // Optional: Notify sender they aren't connected
             // socket.emit('error-occurred', { message: 'Cannot send message: Not connected to this user.' });
             return;
        }

        // Find the specific socket instance for the recipient
        const recipientSocket = io.sockets.sockets.get(recipient.socketId);
        if (recipientSocket) {
            // Relay the message ONLY to the recipient's socket
            console.log(`[MsgRelay] Relaying message from ${senderId} (Socket: ${socket.id}) to ${toId} (Socket: ${recipient.socketId})`);
            recipientSocket.emit('receive-message', {
                fromId: senderId, // Tell the recipient who it's from
                message: message   // The actual message content
            });
        } else {
            // This might happen if the recipient disconnected just moments ago
            console.warn(`[MsgRelay] Socket instance for recipient ${toId} (ID: ${recipient.socketId}) not found, though user is in onlineUsers list.`);
        }
    });
    // +++ END ADD +++





    socket.on('disconnect', (reason) => handleDisconnect(socket, reason));

});

// --- Event Handler Functions ---
function handleStartLooking(socket) {
    const currentUser = onlineUsers[socket.userId];
    if (!currentUser) { console.error(`[SL] Error: User ${socket.userId} not found.`); return; }

    console.log(`[SL] User ${socket.userId} req search. State: peer=${currentUser.currentPeerId}, searching=${currentUser.isSearching}`);
    if (currentUser.currentPeerId) {
        console.warn(`[SL] State mismatch for ${socket.userId}! Clearing stale peerId ${currentUser.currentPeerId}.`);
        currentUser.currentPeerId = null; // Force clear potentially stale state
    }

    if (currentUser.isSearching) { console.log(`[SL] User ${currentUser.username} already searching.`); socket.emit('waiting-for-peer'); return; }

    console.log(`[SL] User ${currentUser.username} starting search...`);
    currentUser.isSearching = true;
    findPeerFor(socket.userId);
}

function handleStopLooking(socket) {
    const currentUser = onlineUsers[socket.userId];
    if (currentUser && currentUser.isSearching) {
        currentUser.isSearching = false;
        console.log(`[StopL] User ${currentUser.username} stopped looking.`);
        socket.emit('chat-ended', { reason: 'You stopped searching.' }); // Use chat-ended to trigger UI reset
    }
}

function handleSkip(socket) {
    const currentUser = onlineUsers[socket.userId];
    if (!currentUser || !currentUser.currentPeerId) { console.log(`[Skip] User ${socket.userId} tried to skip but not in chat.`); return; }
    const peerId = currentUser.currentPeerId;
    const peerUser = onlineUsers[peerId];
    console.log(`[Skip] User ${currentUser.username} skipped ${peerUser?.username || peerId}`);

    if (peerUser) {
        const peerSocket = io.sockets.sockets.get(peerUser.socketId);
        if (peerSocket) { peerSocket.emit('chat-ended', { reason: 'Partner skipped.' }); }
        peerUser.currentPeerId = null; peerUser.isSearching = false; // Reset peer state
    }
    currentUser.currentPeerId = null; currentUser.isSearching = false; // Reset self state
    socket.emit('chat-ended', { reason: 'You skipped the chat.' }); // Confirm reset to skipper
}

function handleWebRTCSignal(socket, data) {
    if (!data?.toId || !data.signal) { console.warn(`[Signal] Incomplete from ${socket.userId}`); return; }
    const recipient = onlineUsers[data.toId];
    if (recipient) {
        const recipientSocket = io.sockets.sockets.get(recipient.socketId);
        if (recipientSocket) {
            recipientSocket.emit('webrtc-signal', { fromId: socket.userId, signal: data.signal });
        }
    }
}

function handleDisconnect(socket, reason) {
    const userId = socket.userId;
    const userInfo = onlineUsers[userId];
    console.log(`🔻 Disconnect: ${socket.user?.username || userId} | ${socket.id} | Reason: ${reason}`);
    if (userInfo) {
        if (userInfo.currentPeerId) { // Notify peer if user was in a chat
            const peerId = userInfo.currentPeerId;
            const peerUser = onlineUsers[peerId];
            if (peerUser) {
                console.log(`[DC] Notifying peer ${peerId} of disconnect.`);
                const peerSocket = io.sockets.sockets.get(peerUser.socketId);
                if (peerSocket) { peerSocket.emit('chat-ended', { reason: 'Partner disconnected.' }); }
                peerUser.currentPeerId = null; peerUser.isSearching = false; // Reset peer
            }
        }
        // Remove user only if this socket matches the stored one
        if (userInfo.socketId === socket.id) {
            delete onlineUsers[userId];
            console.log(`[DC] Removed ${userId}. Online: ${Object.keys(onlineUsers).length}`);
        } else {
            console.log(`[DC] Socket ${socket.id} was not primary for ${userId}. Not removing.`);
        }
    } else {
        console.log(`[DC] User ${userId} already removed or not found.`);
    }
}

// --- User Matching Function ---
function findPeerFor(userId) {
    const currentUser = onlineUsers[userId];
    if (!currentUser || !currentUser.isSearching) { console.log(`[Match] Aborted for ${userId}, not searching.`); return; }
    let preferredMatchId = null; let fallbackMatchId = null;
    let candidates = Object.keys(onlineUsers).filter(id => id !== userId && onlineUsers[id].isSearching && !onlineUsers[id].currentPeerId);
    for (let i = candidates.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[candidates[i], candidates[j]] = [candidates[j], candidates[i]];}

    const wantsMatch = (uA, uB) => (uA.preference === 'any' || uA.preference === uB.gender) && (uB.preference === 'any' || uB.preference === uA.gender);
    // Pass 1: Preferred
    for (const pId of candidates) { const pUser = onlineUsers[pId]; if (wantsMatch(currentUser, pUser)) { preferredMatchId = pId; console.log(`[Match] -> Found preferred: ${pUser.username}`); break; } }
    // Pass 2: Fallback
    if (!preferredMatchId) {
        console.log(`[Match] No preferred for ${currentUser.username}. Trying fallback...`);
        for (const pId of candidates) { const pUser = onlineUsers[pId]; if (pUser.gender === currentUser.gender && (pUser.preference === 'any' || pUser.preference === currentUser.gender)) { fallbackMatchId = pId; console.log(`[Match] -> Found fallback: ${pUser.username}`); break; } }
    }
    const finalPeerId = preferredMatchId || fallbackMatchId;
    if (finalPeerId) {
        const peerUser = onlineUsers[finalPeerId];
        currentUser.isSearching = false; currentUser.currentPeerId = finalPeerId;
        peerUser.isSearching = false; peerUser.currentPeerId = userId;
        const matchType = finalPeerId === preferredMatchId ? "Pref" : "Fall";
        console.log(`✅ MATCH (${matchType}): ${currentUser.username} <=> ${peerUser.username}`);
        const userSocket = io.sockets.sockets.get(currentUser.socketId);
        const peerSocket = io.sockets.sockets.get(peerUser.socketId);
        if (userSocket) userSocket.emit('match-found', { peerId: finalPeerId, initiator: false });
        if (peerSocket) peerSocket.emit('match-found', { peerId: userId, initiator: true });
    } else {
        console.log(`[Match] User ${currentUser.username} waiting (no suitable match found)...`);
        const userSocket = io.sockets.sockets.get(currentUser.socketId);
        if (userSocket) userSocket.emit('waiting-for-peer');
    }
}

// --- REST API Routes ---
// Ensure you have routes/auth.js and controllers/authController.js setup from Step 1
app.use('/api/auth', authRoutes);

// Basic health check
app.get('/', (req, res) => { res.status(200).json({ status: 'OK', online: Object.keys(onlineUsers).length }); }); // Added online count

// --- Start Server ---
const PORT = process.env.PORT || 5001;
server.listen(PORT, () => console.log(`🚀 Server ready on port ${PORT}`));

// --- Graceful Shutdown ---
process.on('unhandledRejection', (err, promise) => { console.error(`Unhandled Rejection: ${err?.message || err}`, err); server.close(() => process.exit(1)); });
process.on('SIGTERM', () => { console.log('SIGTERM received. Shutting down.'); server.close(() => { console.log('Server closed.'); process.exit(0); }); setTimeout(() => process.exit(1), 10000); });