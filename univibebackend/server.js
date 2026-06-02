// univibebackend/server.js

const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const http = require('http');
const path = require('path');
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
// Allow both localhost (dev) and the deployed Render URL (prod)
const allowedOrigins = [
    process.env.FRONTEND_URL,
    'http://localhost:5001',
    'http://127.0.0.1:5001',
].filter(Boolean);

const corsOptions = {
    origin: (origin, callback) => {
        // Allow requests with no origin (mobile apps, curl, Postman)
        if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
        callback(new Error(`CORS: origin '${origin}' not allowed`));
    },
    methods: ['GET', 'POST'],
    credentials: true,
};
app.use(cors(corsOptions));

// --- Serve Frontend Static Files ---
const staticPath = path.join(__dirname, 'public');
app.use(express.static(staticPath));
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
const rooms = {}; // { roomId: { id, ownerId, members: [userId, ...] } }

function generateRoomId() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 to avoid confusion
    let id;
    do { id = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join(''); } while (rooms[id]);
    return id;
}
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
    console.log(`âœ… Connect: ${socket.user.username} (${socket.userId}) | ${socket.id}`);

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
        preference: socket.user.preference, isSearching: false, currentPeerId: null, currentRoomId: null
    };
    console.log(`Online: ${Object.keys(onlineUsers).length}`);

    // Confirm connection to client
    const countNow = Object.keys(onlineUsers).length;
    socket.emit('connection-success', {
        message: `Welcome, ${socket.user.username}!`,
        onlineUserCount: countNow
    });
    // Broadcast updated count to everyone
    io.emit('online-count', { count: countNow });

    // --- Assign Event Handlers ---
    socket.on('start-looking', () => handleStartLooking(socket));
    socket.on('stop-looking', () => handleStopLooking(socket));
    socket.on('skip', () => handleSkip(socket));
    socket.on('webrtc-signal', (data) => handleWebRTCSignal(socket, data));

    // --- Room Events ---
    socket.on('create-room', () => handleCreateRoom(socket));
    socket.on('join-room', ({ roomId } = {}) => handleJoinRoom(socket, roomId));
    socket.on('room-signal', ({ roomId, signal } = {}) => handleRoomSignal(socket, roomId, signal));
    socket.on('room-message', ({ roomId, message } = {}) => handleRoomMessage(socket, roomId, message));
    socket.on('leave-room', ({ roomId } = {}) => handleLeaveRoom(socket, roomId));
   
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
    console.log(`ðŸ”» Disconnect: ${socket.user?.username || userId} | ${socket.id} | Reason: ${reason}`);
    if (userInfo) {
        // Room cleanup: notify room partner on disconnect
        if (userInfo.currentRoomId) {
            _removeFromRoom(userId, userInfo.currentRoomId, 'Partner disconnected.', socket);
        }
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
            const newCount = Object.keys(onlineUsers).length;
            console.log(`[DC] Removed ${userId}. Online: ${newCount}`);
            io.emit('online-count', { count: newCount });
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
    // Filter candidates and prune any ghosts
    let candidates = [];
    for (const id of Object.keys(onlineUsers)) {
        if (id === userId) continue;
        const candidate = onlineUsers[id];
        if (candidate.isSearching && !candidate.currentPeerId) {
            // Verify socket is actually connected
            const socketExists = io.sockets.sockets.get(candidate.socketId);
            if (!socketExists) {
                console.log(`[Ghost Prune] Removing ghost user ${id} during matchmaking.`);
                delete onlineUsers[id];
            } else {
                candidates.push(id);
            }
        }
    }
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
        console.log(`âœ… MATCH (${matchType}): ${currentUser.username} <=> ${peerUser.username}`);
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

// --- Room Handler Functions ---
function handleCreateRoom(socket) {
    const userId = socket.userId;
    const userInfo = onlineUsers[userId];
    if (!userInfo) return;
    if (userInfo.currentRoomId) {
        socket.emit('room-error', { message: 'You are already in a room. Cancel it first.' });
        return;
    }
    const roomId = generateRoomId();
    rooms[roomId] = { id: roomId, ownerId: userId, members: [userId], createdAt: Date.now() };
    userInfo.currentRoomId = roomId;
    console.log(`[Room] Created: ${roomId} by ${socket.user.username}`);
    socket.emit('room-created', { roomId });
}

function handleJoinRoom(socket, roomId) {
    const userId = socket.userId;
    const userInfo = onlineUsers[userId];
    if (!userInfo || !roomId || typeof roomId !== 'string') {
        socket.emit('room-error', { message: 'Invalid room code.' }); return;
    }
    const id = roomId.toUpperCase().trim();
    const room = rooms[id];
    if (!room) { socket.emit('room-error', { message: `Room "${id}" does not exist.` }); return; }
    if (room.members.length >= 2) { socket.emit('room-error', { message: `Room "${id}" is already full.` }); return; }
    if (room.members.includes(userId)) { socket.emit('room-error', { message: 'You created this room â€” share the code with a friend.' }); return; }
    room.members.push(userId);
    userInfo.currentRoomId = id;
    const ownerUser = onlineUsers[room.ownerId];
    console.log(`[Room] ${socket.user.username} joined room ${id}`);
    // Joiner is WebRTC initiator (creates offer); owner is receiver
    const ownerSocket = ownerUser ? io.sockets.sockets.get(ownerUser.socketId) : null;
    if (ownerSocket) ownerSocket.emit('room-ready', { roomId: id, initiator: false });
    socket.emit('room-ready', { roomId: id, initiator: true });
}

function handleRoomSignal(socket, roomId, signal) {
    if (!roomId || !signal) return;
    const userId = socket.userId;
    const room = rooms[roomId];
    if (!room || !room.members.includes(userId)) { console.warn(`[Room Signal] ${userId} not in room ${roomId}`); return; }
    const otherId = room.members.find(id => id !== userId);
    if (!otherId) return;
    const other = onlineUsers[otherId];
    if (!other) return;
    const otherSocket = io.sockets.sockets.get(other.socketId);
    if (otherSocket) otherSocket.emit('room-signal', { signal, fromId: userId });
}

function handleRoomMessage(socket, roomId, message) {
    if (!roomId || !message || typeof message !== 'string') return;
    const userId = socket.userId;
    const room = rooms[roomId];
    if (!room || !room.members.includes(userId)) { console.warn(`[Room Msg] ${userId} not in room ${roomId}`); return; }
    const sanitized = message.trim().slice(0, 1000);
    if (!sanitized) return;
    const otherId = room.members.find(id => id !== userId);
    if (!otherId) return;
    const other = onlineUsers[otherId];
    if (!other) return;
    const otherSocket = io.sockets.sockets.get(other.socketId);
    if (otherSocket) otherSocket.emit('room-receive-message', { message: sanitized });
}

function handleLeaveRoom(socket, roomId) {
    if (!roomId) return;
    _removeFromRoom(socket.userId, roomId, 'Partner left the room.', socket);
}

function _removeFromRoom(userId, roomId, notifyMsg, leavingSocket) {
    const room = rooms[roomId];
    if (!room) return;
    room.members = room.members.filter(id => id !== userId);
    if (onlineUsers[userId]) onlineUsers[userId].currentRoomId = null;
    console.log(`[Room] ${userId} left room ${roomId}. Remaining: ${room.members.length}`);
    if (room.members.length > 0 && notifyMsg) {
        const remainingUser = onlineUsers[room.members[0]];
        if (remainingUser) {
            const s = io.sockets.sockets.get(remainingUser.socketId);
            if (s) s.emit('room-partner-left', { message: notifyMsg });
        }
    }
    if (room.members.length === 0) { delete rooms[roomId]; console.log(`[Room] Deleted empty room ${roomId}`); }
}

// --- REST API Routes ---
app.use('/api/auth', authRoutes);

// --- Room existence check (for URL-sharing validation) ---
app.get('/api/room/:id', (req, res) => {
    const roomId = (req.params.id || '').toUpperCase().trim();
    const room = rooms[roomId];
    if (!room) return res.status(404).json({ exists: false });
    res.json({ exists: true, isFull: room.members.length >= 2 });
});

// --- TURN Server Credentials Endpoint ---
// Keeps TURN secrets server-side; frontend fetches at chat start
app.get('/api/turn-credentials', (req, res) => {
    const username = process.env.TURN_USERNAME;
    const credential = process.env.TURN_CREDENTIAL;

    if (!username || !credential) {
        // No TURN configured â€” return only STUN (works on same-network calls)
        return res.json({
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
            ]
        });
    }

    res.json({
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            {
                urls: [
                    'turn:openrelay.metered.ca:80',
                    'turn:openrelay.metered.ca:443',
                    'turn:openrelay.metered.ca:443?transport=tcp',
                    'turns:openrelay.metered.ca:443',
                ],
                username,
                credential,
            },
        ]
    });
});

// Basic health check
app.get('/health', (req, res) => { res.status(200).json({ status: 'OK', online: Object.keys(onlineUsers).length }); });

// --- Catch-all: serve index.html for any non-API route (SPA support) ---
// Note: app.use() (no path) is used instead of app.get('*') because
// path-to-regexp v8+ (Node 24) rejects bare '*' wildcards at startup.
app.use((req, res) => {
    res.sendFile(path.join(__dirname, '../univibefrontend', 'index.html'));
});

// --- Start Server ---
const PORT = process.env.PORT || 5001;
server.listen(PORT, () => console.log(`ðŸš€ Server ready on port ${PORT}`));

// --- Graceful Shutdown ---
process.on('unhandledRejection', (err, promise) => { console.error(`Unhandled Rejection: ${err?.message || err}`, err); server.close(() => process.exit(1)); });
process.on('SIGTERM', () => { console.log('SIGTERM received. Shutting down.'); server.close(() => { console.log('Server closed.'); process.exit(0); }); setTimeout(() => process.exit(1), 10000); });
