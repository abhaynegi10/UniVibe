// univibe-frontend/app.js

// ==================================================
// 1. Configuration & Global Variables
// ==================================================
const API_BASE_URL = 'http://localhost:5001/api/auth';
const SOCKET_URL = 'http://localhost:5001';

let socket = null;
let isLooking = false;
let currentPeerId = null;
let localStream = null;
let peerConnection = null;
let isWebRTCInitiator = false;
// === Add a new global flag ===
let makingOffer = false; // Flag to prevent duplicate offer creation
let isChatVisible = false; // <-- ADD THIS LINE

const pcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        // Add TURN server here for production
    ]
};

// ==================================================
// 2. DOM Elements
// ==================================================
// --- Add Preview Elements ---
const previewContainer = document.getElementById('preview-container');
const previewVideo = document.getElementById('previewVideo');
const previewStatus = document.getElementById('preview-status');
// --- Existing Elements ---
const bodyElement = document.body;
console.log("Initial bodyElement selection:", bodyElement);
const themeToggleButton = document.getElementById('theme-toggle-button');
const authContainer = document.getElementById('auth-container');
const registerSection = document.getElementById('register-section');
const loginSection = document.getElementById('login-section');
const loggedInView = document.getElementById('logged-in-view');
const registerForm = document.getElementById('register-form');
const loginForm = document.getElementById('login-form');
const regUsernameInput = document.getElementById('reg-username');
const regPasswordInput = document.getElementById('reg-password');
const regGenderSelect = document.getElementById('reg-gender');
const regPreferenceSelect = document.getElementById('reg-preference');
const loginUsernameInput = document.getElementById('login-username');
const loginPasswordInput = document.getElementById('login-password');
const showLoginLink = document.getElementById('show-login');
const showRegisterLink = document.getElementById('show-register');
const loggedInUsernameSpan = document.getElementById('logged-in-username');
const loggedInGenderSpan = document.getElementById('logged-in-gender');
const loggedInPreferenceSpan = document.getElementById('logged-in-preference');
const socketStatusSpan = document.getElementById('socket-status');
const chatStatusSpan = document.getElementById('chat-status');
const startChatButton = document.getElementById('start-chat-button');
const skipButton = document.getElementById('skip-button');
const logoutButton = document.getElementById('logout-button');
const statusMessageDiv = document.getElementById('status-message');
const videoChatContainer = document.getElementById('video-chat-container');
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const chatControlsBar = document.getElementById('chat-controls');
const muteButton = document.getElementById('mute-button');
const videoToggleButton = document.getElementById('video-toggle-button');
// --- Add Chat Elements ---
const toggleChatButton = document.getElementById('toggle-chat-btn');    // <-- ADD
const textChatArea = document.getElementById('text-chat-area');      // <-- ADD
const messageList = document.getElementById('message-list');         // <-- ADD
const chatInput = document.getElementById('chat-input');           // <-- ADD
const sendMessageButton = document.getElementById('send-message-btn'); // <-- ADD

// ==================================================
// Helper function to update preview status message
// ==================================================
function updatePreviewStatus(message, isError = false) {
    if (previewStatus) {
        previewStatus.textContent = message;
        // Show message only if there is content
        previewStatus.style.display = message ? 'block' : 'none';
    }
    if (previewContainer) {
        previewContainer.classList.toggle('permission-failed', isError);
    }
}

// ==================================================
// 3. Utilities (Dark Mode)
// ==================================================
function applyTheme(theme) { if (theme === 'dark') bodyElement.classList.add('dark-mode'); else bodyElement.classList.remove('dark-mode'); }
function toggleTheme() { const newTheme = bodyElement.classList.contains('dark-mode') ? 'light' : 'dark'; applyTheme(newTheme); localStorage.setItem('theme', newTheme); }
function loadTheme() { const savedTheme = localStorage.getItem('theme') || 'light'; applyTheme(savedTheme); }

// ==================================================
// 4. State Management (Auth, etc.)
// ==================================================
// --- Modified checkLoginStatus to be async and start preview ---
async function checkLoginStatus() { // Make async if starting preview
    console.log("Running checkLoginStatus (normal load or post-callback)...");
    const token = localStorage.getItem('authToken');
    const user = JSON.parse(localStorage.getItem('authUser'));
    if (token && user) {
        console.log("Found existing token/user in localStorage.");
        showView('logged-in');
        showUserInfo(user);
        await startPreview(); // Start preview if logged in
        connectWebSocket(token);
    } else {
        console.log("No existing token/user found, showing login.");
        showView('login');
    }
}
function storeLoginData(token, user) { localStorage.setItem('authToken', token); localStorage.setItem('authUser', JSON.stringify(user)); }
function clearLoginData() { localStorage.removeItem('authToken'); localStorage.removeItem('authUser'); }

// ==================================================
// 5. UI Update Functions (General)
// ==================================================
function updateSocketStatus(text, color) { if (socketStatusSpan) { socketStatusSpan.textContent = text; socketStatusSpan.style.color = color; } }
function updateChatStatus(text) { if (chatStatusSpan) { chatStatusSpan.textContent = text; } }

// ==================================================
// 5. UI Update Functions (General) - Updated showView
// ==================================================
function showView(viewName) {
    // --- Debug Log: Function Entry ---
    console.log(`>>> showView called with: ${viewName}`);

    // --- Hide/Show Auth vs LoggedIn containers ---
    authContainer.style.display = viewName === 'login' || viewName === 'register' ? 'block' : 'none';
    loggedInView.style.display = viewName === 'logged-in' ? 'block' : 'none';

    // --- Manage body class for video/controls visibility ---
     if (viewName === 'in-chat') {
        // Explicitly in a video chat session
        console.log("showView ('in-chat'): ADDING 'in-chat' class to body. Element:", bodyElement);
        bodyElement.classList.add('in-chat');
        console.log("showView ('in-chat'): ClassList after attempting add:", bodyElement.classList);
    } else {
        // For all other views (login, register, logged-in/idle)
        // The 'in-chat' class might be present if the user is 'searching' (to show controls)
        // Only remove 'in-chat' if NOT searching. resetChatUI('idle') handles removal too.
        if (!isLooking) { // If not searching AND not 'in-chat' view
            console.log("showView (not 'in-chat' & not searching): REMOVING 'in-chat' class. Current:", bodyElement.classList);
            bodyElement.classList.remove('in-chat');
        } else {
            console.log("showView (not 'in-chat' BUT isLooking=true): Keeping 'in-chat' class for searching controls.");
        }
    }

    // --- Handle specific auth view visibility (Login vs Register) ---
    if (viewName === 'register') {
        if (loginSection) loginSection.style.display = 'none';
        if (registerSection) registerSection.style.display = 'block';
    }
    if (viewName === 'login') {
        if (registerSection) registerSection.style.display = 'none';
        if (loginSection) loginSection.style.display = 'block';
    }
}

function showUserInfo(user) { loggedInUsernameSpan.textContent = user.username; loggedInGenderSpan.textContent = user.gender; loggedInPreferenceSpan.textContent = user.preference; }

function showStatusMessage(message, isError = false) {
    statusMessageDiv.textContent = message; statusMessageDiv.className = 'status'; statusMessageDiv.classList.add(isError ? 'error' : 'success');
    clearTimeout(statusMessageDiv.timer); statusMessageDiv.timer = setTimeout(() => { statusMessageDiv.className = 'status'; }, isError ? 5000 : 3500);
}
function clearStatusMessage() { statusMessageDiv.className = 'status'; }

function resetChatUI(mode = 'idle') {
    console.log(`Resetting UI to mode: ${mode}, Socket Connected: ${socket?.connected}, Has Stream: ${!!localStream}`);

    // Default: Remove 'in-chat' class unless specifically in 'searching' or 'in-chat' mode
    // This simplifies ensuring it's removed when going to 'idle'
    if (mode !== 'searching' && mode !== 'in-chat') {
        bodyElement.classList.remove('in-chat');
        console.log("resetChatUI: Removed 'in-chat' class from body.");
    }

    switch (mode) {
        case 'searching':
            if (startChatButton) startChatButton.style.display = 'none';
            if (skipButton) {
                skipButton.style.display = 'inline-block';
                skipButton.textContent = "Stop Searching";
            }
            updateMediaButtonsState(!!localStream);
            // --- MODIFICATION: Add 'in-chat' class to show controls bar ---
            bodyElement.classList.add('in-chat');
            console.log("resetChatUI ('searching'): Added 'in-chat' class to body.");
            break;

        case 'in-chat':
            if (startChatButton) startChatButton.style.display = 'none';
            if (skipButton) {
                skipButton.style.display = 'inline-block';
                skipButton.textContent = "Skip";
            }
            updateMediaButtonsState(!!localStream);
            // --- MODIFICATION: Ensure 'in-chat' class is present (showView usually handles this too) ---
            if (!bodyElement.classList.contains('in-chat')) {
                bodyElement.classList.add('in-chat');
                console.log("resetChatUI ('in-chat'): Added 'in-chat' class to body (was missing).");
            }
            break;

        case 'idle':
        default:
            if (startChatButton) {
                startChatButton.style.display = 'inline-block';
                // Start button enabled only if socket is connected AND media stream exists
                startChatButton.disabled = !(socket && socket.connected && localStream);
            }
            if (skipButton) skipButton.style.display = 'none';
            updateMediaButtonsState(!!localStream);
            // 'in-chat' class is removed by the check at the top of the function
            console.log("resetChatUI ('idle'): UI set to idle, 'in-chat' class should be removed.");
            break;
    }
}
// --- Add Message Display Function ---
function displayMessage(message, isLocal) { // <-- ADD THIS FUNCTION
    if (!messageList) return;
    const msgElement = document.createElement('p');
    msgElement.textContent = message;
    msgElement.classList.add(isLocal ? 'local-message' : 'remote-message');
    messageList.appendChild(msgElement);
    // Scroll to the bottom
    messageList.scrollTop = messageList.scrollHeight;
}

// ==================================================
// 5.1 Chat UI Functions (NEW SECTION)
// ==================================================
function toggleChatArea() { // <-- ADD THIS FUNCTION
    isChatVisible = !isChatVisible;
    if (textChatArea) {
        textChatArea.classList.toggle('chat-visible', isChatVisible);
    }
    if (toggleChatButton) {
        toggleChatButton.classList.toggle('chat-active', isChatVisible);
        toggleChatButton.title = isChatVisible ? "Hide Text Chat" : "Show Text Chat";
    }
    if(isChatVisible) {
        chatInput?.focus(); // Focus input when opening chat
    }
    console.log(`Chat toggled. Visible: ${isChatVisible}`);
}


// ==================================================
// 6. Media Controls & Permissions
// ==================================================
function updateMuteButton(isEnabled) { if (muteButton) { muteButton.classList.toggle('muted', !isEnabled); muteButton.title = isEnabled ? "Mute" : "Unmute"; } }
function updateVideoToggleButton(isEnabled) { if (videoToggleButton) { videoToggleButton.classList.toggle('video-off', !isEnabled); videoToggleButton.title = isEnabled ? "Cam Off" : "Cam On"; } }

function updateMediaButtonsState(streamIsActive) {
    // This function now correctly depends on updateMuteButton and updateVideoToggleButton being defined
    if (!localStream || !streamIsActive) {
        if (muteButton) muteButton.disabled = true;
        if (videoToggleButton) videoToggleButton.disabled = true;
        updateMuteButton(false); // Ensure icons reflect disabled state
        updateVideoToggleButton(false);
        return;
    }
    const audioEnabled = localStream.getAudioTracks().some(t => t.enabled);
    const videoEnabled = localStream.getVideoTracks().some(t => t.enabled);
    updateMuteButton(audioEnabled); updateVideoToggleButton(videoEnabled);
    if (muteButton) muteButton.disabled = localStream.getAudioTracks().length === 0;
    if (videoToggleButton) videoToggleButton.disabled = localStream.getVideoTracks().length === 0;
}

// --- Modified getMediaPermissions to handle preview ---
async function getMediaPermissions(showPreview = false) { // Add showPreview flag
    // 1. Reuse existing stream if available
    if (localStream) {
        console.log("Reusing existing media stream.");
        // Update preview if requested AND element exists and has no stream
        if (showPreview && previewVideo && !previewVideo.srcObject) {
            previewVideo.srcObject = localStream;
            updatePreviewStatus('', false); // Clear status message if reusing stream for preview
            console.log("Preview stream updated with existing stream.");
        }
        // Update main video if needed (e.g., during reconnect/start)
        if (localVideo && !localVideo.srcObject) {
            localVideo.srcObject = localStream;
        }
        updateMediaButtonsState(true);
        return localStream;
    }

    // 2. If no existing stream, request permissions
    console.log("Requesting media permissions...");
    if (showPreview) updatePreviewStatus('Requesting access...', false); // Update preview status (not error)

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        console.log("Media permissions granted.");
        localStream = stream; // Assign to global variable

        // Display in preview if requested
        if (showPreview && previewVideo) {
            previewVideo.srcObject = stream;
            updatePreviewStatus('', false); // Clear status message on success
            console.log("Preview stream assigned.");
        }
        // Also assign to main localVideo if element exists (for later use)
        if (localVideo) {
            localVideo.srcObject = stream;
            console.log("Main localVideo stream assigned.");
        }

        updateMediaButtonsState(true);

        return stream;

    } catch (error) {
        console.error("Error getting media permissions:", error);
        let userErrorMessage = `Cam/Mic Error: ${error.message}.`;
        if (error.name === 'NotAllowedError') {
            userErrorMessage = 'Camera/Mic permission denied. Allow access & refresh.';
        } else if (error.name === 'NotFoundError') {
            userErrorMessage = 'No camera/mic found. Ensure they are connected/enabled.';
        } else if (error.name === 'NotReadableError') {
            userErrorMessage = 'Camera might be in use by another app.';
        }

        // Show error in main status and preview status
        showStatusMessage(userErrorMessage, true);
        if (showPreview) updatePreviewStatus(userErrorMessage, true);

        updateMediaButtonsState(false);
        startChatButton.disabled = true; // Definitely disable if media fails

        return null; // Indicate failure
    }
}

// --- Add a function to specifically start the preview ---
async function startPreview() {
    console.log("Attempting to start video preview...");
    const stream = await getMediaPermissions(true); // Pass true to show in preview
    // Enable start chat button ONLY if stream is obtained AND socket is connected
    if (stream && socket && socket.connected) {
        startChatButton.disabled = false;
        console.log("Preview started and socket connected, enabling start button.");
    } else if (stream) {
        console.log("Preview started, waiting for socket connection...");
        startChatButton.disabled = true; // Keep disabled until socket connects
    } else {
        console.log("Preview failed, start button remains disabled.");
        startChatButton.disabled = true; // Keep disabled if media failed
    }
}

// --- Add function to stop local media ---
function stopLocalMedia() {
    if (localStream) {
        console.log("Stopping local media tracks.");
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    // Clear video elements
    if (localVideo) localVideo.srcObject = null;
    if (previewVideo) previewVideo.srcObject = null; // Also clear preview

    // Update button states
    updateMediaButtonsState(false);
    updatePreviewStatus('Camera off.', false); // Update preview status
    startChatButton.disabled = true; // Disable start if media is stopped
}


function toggleAudio() { if (!localStream) return; localStream.getAudioTracks().forEach(t => { t.enabled = !t.enabled; updateMuteButton(t.enabled); }); }
function toggleVideo() { if (!localStream) return; localStream.getVideoTracks().forEach(t => { t.enabled = !t.enabled; updateVideoToggleButton(t.enabled); }); }

// ==================================================
// 7. Core WebRTC Logic Functions
// ==================================================
async function createOffer() {
    if (!peerConnection || peerConnection.signalingState !== 'stable') { console.warn("PC: Cannot create offer in state:", peerConnection?.signalingState); return; } try { const offer = await peerConnection.createOffer(); await peerConnection.setLocalDescription(offer); sendSignalingMessage({ type: 'offer', sdp: offer.sdp }); console.log("PC: Offer created and sent."); } catch (e) { handleWebRTCError("Offer creation failed.") }
}
function sendSignalingMessage(msg) { if (socket?.connected && currentPeerId) socket.emit('webrtc-signal', { toId: currentPeerId, signal: msg }); }
async function handleOffer(signal) {
    if (!peerConnection || peerConnection.signalingState !== 'stable') { console.warn("PC: Cannot handle offer in state:", peerConnection?.signalingState); return; }
    try {
        console.log("PC: Received offer, setting remote description...");
        await peerConnection.setRemoteDescription(new RTCSessionDescription(signal));
        console.log("PC: Remote description (offer) set successfully."); // ADD THIS

        console.log("PC: >>> Attempting to create answer..."); // ADD THIS
        const answer = await peerConnection.createAnswer();
        console.log("PC: >>> Answer created:", answer); // ADD THIS

        console.log("PC: >>> Attempting to set local description (answer)..."); // ADD THIS
        await peerConnection.setLocalDescription(answer);
        console.log("PC: >>> Local description (answer) set successfully."); // ADD THIS

        console.log("PC: >>> Attempting to send answer via signaling..."); // ADD THIS
        sendSignalingMessage({ type: 'answer', sdp: answer.sdp });
        console.log("PC: Answer created and sent."); // This is the original log

    } catch (e) {
        // --- VERY IMPORTANT: Log the actual error object ---
        console.error("!!!! FAILED INSIDE handleOffer !!!!", e); // ADD THIS DETAILED LOG
        handleWebRTCError("Offer handling failed. Error: " + e.message); // Add error message
    }
}
async function handleAnswer(signal) {
    if (!peerConnection || peerConnection.signalingState !== 'have-local-offer') { console.warn("PC: Cannot handle answer in state:", peerConnection?.signalingState); return; } try { console.log("PC: Received answer, setting remote description..."); await peerConnection.setRemoteDescription(new RTCSessionDescription(signal)); console.log("PC: PeerConnection established!"); } catch (e) { handleWebRTCError("Answer handling failed.") }
}
async function handleCandidate(signal) {
    if (!signal.candidate || !peerConnection) return; try { console.log("PC: Adding received ICE candidate..."); await peerConnection.addIceCandidate(new RTCIceCandidate(signal.candidate)); } catch (e) { if (!peerConnection?.remoteDescription) console.warn("PC: Candidate ignored (no remote description yet)"); else console.error("PC: Add ICE candidate error:", e); }
}
function closePeerConnection() { if (peerConnection) { console.log("PC: Closing PeerConnection."); peerConnection.onicecandidate = null; peerConnection.ontrack = null; peerConnection.onnegotiationneeded = null; peerConnection.oniceconnectionstatechange = null; peerConnection.onicegatheringstatechange = null; peerConnection.onsignalingstatechange = null; peerConnection.close(); peerConnection = null; isWebRTCInitiator = false; } }


// ==================================================
// 8. WebRTC Event Handler Functions << DEFINED BEFORE startWebRTCConnection
// ==================================================
function handleICECandidateEvent(event) { if (event.candidate) { console.log("PC: Sending ICE candidate..."); sendSignalingMessage({ type: 'candidate', candidate: event.candidate }); } else { console.log('PC: End of ICE candidates gathering.'); } }

// --- Using the improved handleTrackEvent ---
function handleTrackEvent(event) {
    console.log(`>>>> PC: handleTrackEvent FIRED <<<< Track kind: ${event.track.kind}`);

    // Ensure remoteVideo.srcObject is a MediaStream
    if (!remoteVideo.srcObject) {
        console.log("PC: Initializing remoteVideo.srcObject with new MediaStream.");
        remoteVideo.srcObject = new MediaStream();
    }

    // Add the incoming track to the stream associated with the video element
    // Check if srcObject is actually a MediaStream before adding (extra safety)
    if (remoteVideo.srcObject instanceof MediaStream) {
        console.log(`PC: Adding received ${event.track.kind} track to remoteVideo stream.`);
        remoteVideo.srcObject.addTrack(event.track);

        // Optional: Log tracks currently in the stream
        console.log(`PC: Tracks in remoteVideo stream now: ${remoteVideo.srcObject.getTracks().map(t => t.kind).join(', ')}`);

        // ---- TEMPORARY DEBUGGING BORDER ----
        if (event.track.kind === 'video') {
            console.log('!!! Video track added to srcObject !!!');
            remoteVideo.style.border = '3px solid lime';
            setTimeout(() => { if (remoteVideo) remoteVideo.style.border = 'none'; }, 3000); // Remove border after 3s
        }
        // ---- END TEMPORARY DEBUGGING BORDER ----

    } else {
        console.error("PC: remoteVideo.srcObject is not a MediaStream! Cannot add track.", remoteVideo.srcObject);
        // Potentially try creating the stream again or handle the error
    }
}
function handleNegotiationNeededEvent() { console.log("PC: Negotiation needed event fired."); if (isWebRTCInitiator && peerConnection?.signalingState === 'stable') { console.log("PC: Initiator processing negotiation needed."); createOffer(); } } // Simple re-offer on negotiation needed for initiator
function handleICEConnectionStateChangeEvent() { if (!peerConnection) return; console.log(`PC: ICE State: ${peerConnection.iceConnectionState}`); switch (peerConnection.iceConnectionState) { case 'checking': updateChatStatus("Connecting video..."); break; case 'connected': updateChatStatus("Video stream connected"); break; case 'completed': updateChatStatus("Video Connected!"); break; case 'disconnected': updateChatStatus("Video lost - reconnecting..."); break; case 'failed': updateChatStatus("Video Failed"); handleWebRTCError("Connection failed."); break; case 'closed': updateChatStatus("Video Closed"); break; } }
function handleICEGatheringStateChangeEvent() { if (!peerConnection) return; console.log(`PC: ICE Gathering: ${peerConnection.iceGatheringState}`); }
function handleSignalingStateChangeEvent() { if (!peerConnection) return; console.log(`PC: Signaling State: ${peerConnection.signalingState}`); }

// ==================================================
// 9. `startWebRTCConnection` Function << USES HANDLERS DEFINED ABOVE
// ==================================================
// --- Using the refined startWebRTCConnection from previous step ---
function startWebRTCConnection() {
    if (!currentPeerId || !localStream) { console.error("WebRTC Start Failed:", { currentPeerId, hasLocalStream: !!localStream }); handleWebRTCError("Cannot start video chat. Missing peer or stream."); return; }

    console.log("PC: Creating PeerConnection instance...");
    closePeerConnection();
    makingOffer = false; // Reset flag on new connection

    let tracksAddedSuccessfully = true;

    try {
        peerConnection = new RTCPeerConnection(pcConfig);

        // Assign handlers (ensure handleNegotiationNeededEvent is assigned)
        peerConnection.onicecandidate = handleICECandidateEvent;
        peerConnection.ontrack = handleTrackEvent;
        peerConnection.onnegotiationneeded = handleNegotiationNeededEvent; // <<< IMPORTANT
        peerConnection.oniceconnectionstatechange = handleICEConnectionStateChangeEvent;
        peerConnection.onicegatheringstatechange = handleICEGatheringStateChangeEvent;
        peerConnection.onsignalingstatechange = handleSignalingStateChangeEvent;
        console.log("PC: Event handlers assigned.");

        console.log("PC: Adding local media tracks...");
        localStream.getTracks().forEach(track => {
            if (!tracksAddedSuccessfully) return;
            try {
                peerConnection.addTrack(track, localStream);
                console.log(` -> Added ${track.kind} track.`);
            } catch (trackError) {
                console.error(`PC: Error adding track:`, trackError);
                handleWebRTCError(`Failed to add local ${track.kind} track.`);
                tracksAddedSuccessfully = false;
            }
        });

        if (!tracksAddedSuccessfully) {
            console.error("PC: Aborting WebRTC start due to track adding failure.");
            return;
        }

        // --- REMOVED the explicit createOffer call ---
        // if (isWebRTCInitiator) {
        //     console.log("PC: Role=Initiator. Letting 'onnegotiationneeded' handle offer.");
        //     // createOffer(); // <-- REMOVED
        // } else {
        //     console.log("PC: Role=Receiver. Waiting for offer...");
        // }
        // --- Log role instead ---
        console.log(`PC: Role=${isWebRTCInitiator ? 'Initiator' : 'Receiver'}. Waiting for negotiation/offer.`);


    } catch (error) {
        console.error("PC: Failed to create RTCPeerConnection:", error);
        handleWebRTCError("Fatal error initializing video connection.");
    }
}


// === Modify handleNegotiationNeededEvent ===
async function handleNegotiationNeededEvent() {
    // Use a flag to prevent multiple offers running concurrently
    if (!peerConnection || makingOffer || peerConnection.signalingState !== 'stable') {
        console.log(`PC: Negotiation needed SKIPPED (makingOffer=${makingOffer}, state=${peerConnection?.signalingState})`);
        return;
    }

    console.log("PC: Negotiation needed event fired.");

    // Only the initiator should create the initial offer based on this event
    if (isWebRTCInitiator) {
        try {
            makingOffer = true; // Set flag
            console.log("PC: Initiator creating offer due to negotiation needed.");
            // --- Replicate createOffer logic here or call a refined createOffer ---
            const offer = await peerConnection.createOffer();
            // Check if connection is still stable *before* setting local description
            if (peerConnection.signalingState !== 'stable') {
                console.warn("PC: State changed during offer creation, aborting negotiation.");
                return; // Exit if state changed mid-process
            }
            await peerConnection.setLocalDescription(offer);
            console.log("PC: Local description set (offer).");
            sendSignalingMessage({ type: 'offer', sdp: offer.sdp });
            console.log("PC: Offer sent via signaling.");
            // --- End of createOffer logic ---
        } catch (err) {
            console.error("PC: Error during negotiation needed handling:", err);
            handleWebRTCError("Offer creation failed during negotiation.");
        } finally {
            makingOffer = false; // Reset flag regardless of success/failure
        }
    } else {
        console.log("PC: Receiver - negotiation needed event ignored (waits for offer).");
    }
}

// === Keep createOffer (maybe rename?) for potential future re-offers if needed ===
// Can be simplified if only used for re-negotiation later
async function createOffer() {
    // This might still be useful for manual re-offers later, but the initial offer
    // is now handled by onnegotiationneeded
    if (!peerConnection || makingOffer || peerConnection.signalingState !== 'stable') { console.warn("PC: Cannot create manual offer now."); return; }
    try {
        makingOffer = true;
        const offer = await peerConnection.createOffer();
        if (peerConnection.signalingState !== 'stable') { return; }
        await peerConnection.setLocalDescription(offer);
        sendSignalingMessage({ type: 'offer', sdp: offer.sdp });
        console.log("PC: Manual Offer created and sent.");
    } catch (e) {
        handleWebRTCError("Manual Offer creation failed.")
    } finally {
        makingOffer = false;
    }
}

// ==================================================
// 10. `resetChatState` including WebRTC Cleanup << DEFINED BEFORE setupSocketListeners uses it
// ==================================================
// --- Modified resetChatState to handle preview ---
function resetChatState() {
    console.log("Resetting full chat state...");
    closePeerConnection(); // Close WebRTC connection first
    updateChatStatus('Idle');
    isLooking = false;
    currentPeerId = null;

    // Clear remote video
    if (remoteVideo && remoteVideo.srcObject) {
        remoteVideo.srcObject.getTracks().forEach(track => track.stop()); // Stop remote tracks
        remoteVideo.srcObject = null;
        console.log("Cleared remote video stream.");
    }

    // Do NOT stop localStream here, let user control that via logout or maybe a separate button
    // Just ensure UI is back to idle and preview is potentially running

    showView('logged-in'); // Switch back to logged-in/idle view
    resetChatUI('idle'); // Set buttons/UI for idle state

    // If localStream exists, ensure preview is shown again
    if (localStream && previewVideo) {
        if (!previewVideo.srcObject) {
            previewVideo.srcObject = localStream; // Re-attach stream if needed
            console.log("Restored preview stream after chat ended.");
        }
        updatePreviewStatus('', false); // Clear any error message
    } else if (!localStream && previewStatus) {
        // If stream was somehow lost/stopped, reflect this in preview
        updatePreviewStatus('Camera required.', true);
        startChatButton.disabled = true; // Ensure start disabled if no stream
    }
}
// --- Define handleWebRTCError *before* resetChatState uses it ---
function handleWebRTCError(msg) { console.error("WebRTC Error:", msg); showStatusMessage(msg, true); resetChatState(); }


// ==================================================
// 11. `setupSocketListeners` Function << USES startWebRTCConnection & resetChatState DEFINED ABOVE
// ==================================================
// --- Modified connection-success to check localStream ---
// ==================================================
// 11. `setupSocketListeners` Function - Refined Again
// ==================================================
function setupSocketListeners() {
    // --- Make sure socket is defined before adding listeners ---
    if (!socket) {
        console.error("Attempted to setup listeners without a socket instance!");
        return;
    }

    console.log("Setting up socket listeners...");

    socket.on('connect', () => {
        console.log('Socket connected:', socket.id);
        // Note: 'connection-success' is the primary place for UI updates post-auth.
    });

    socket.on('connection-success', ({ message, onlineUserCount }) => {
        console.log(`>>> connection-success event received: ${message}`);
        updateSocketStatus(`Online (${onlineUserCount})`, 'var(--socket-status-online-color)');

        // Determine button state based on BOTH socket connection AND stream readiness
        const canStart = !!localStream; // Check if preview/media permissions succeeded earlier

        if (canStart) {
            // Media is ready. Enable button ONLY if user is currently idle.
            startChatButton.disabled = isLooking || currentPeerId;
            if (!startChatButton.disabled) {
                console.log("connection-success: Socket connected, media ready, user idle. Enabling Start button.");
            } else {
                console.log("connection-success: Socket connected, media ready, but user is busy (looking/in chat). Start button remains disabled.");
            }
        } else {
            // Media is not ready. Button must be disabled.
            console.log("connection-success: Socket connected, but waiting for media permissions. Start button disabled.");
            startChatButton.disabled = true;
            // Optionally retry preview here if desired:
            // startPreview();
        }

        // Reset UI to idle state ONLY IF the user is actually idle
        // Handles reconnects correctly without disrupting ongoing searches/chats
        if (!isLooking && !currentPeerId) {
            console.log("connection-success: User is idle, ensuring UI is in idle state.");
            resetChatUI('idle'); // resetChatUI itself will check stream/socket status
        } else {
            console.log(`connection-success: User is not idle (isLooking=${isLooking}, currentPeerId=${currentPeerId}), skipping idle UI reset.`);
            // Ensure UI reflects current non-idle state on reconnect
            if (isLooking) resetChatUI('searching');
            else if (currentPeerId) resetChatUI('in-chat');
        }
    });

    socket.on('disconnect', (reason) => {
        console.log(`Socket disconnect event received: ${reason}`);
        updateSocketStatus(`Offline (${reason})`, 'var(--socket-status-error-color)');
        startChatButton.disabled = true; // Disable start button on disconnect
        // Reset state fully on unexpected disconnect
        resetChatState();
        socket = null; // Clear socket variable
    });

    socket.on('connect_error', (err) => {
        console.error('Socket connect_error event:', err);
        updateSocketStatus(`Connect Failed: ${err.message}`, 'var(--socket-status-error-color)');
        startChatButton.disabled = true;
        // Attempt logout only on specific auth errors
        if (err.message.includes('Auth') || err.message.includes('token') || err.message.includes('User not found')) {
            showStatusMessage(`Authentication failed: ${err.message}. Logging out.`, true);
            handleLogout(); // Assumes handleLogout is defined
        } else {
            showStatusMessage(`Cannot connect to server: ${err.message}`, true);
        }
        socket = null; // Clear socket variable
    });

    socket.on('force-disconnect', (message) => {
        console.warn(`Forced disconnect event received: ${message}`);
        alert(`Disconnected by server: ${message}`);
        handleLogout(); // Assumes handleLogout is defined
    });

    socket.on('waiting-for-peer', () => {
        console.log('Server: waiting-for-peer event received.');
        isLooking = true;
        updateChatStatus('Waiting for partner...');
        resetChatUI('searching');
    });
     // --- Add Listener for Incoming Messages (Server Relay Method) ---
     socket.on('receive-message', ({ fromId, message }) => { // <-- ADD THIS LISTENER
        // Ensure the message is from the current peer
        if (fromId === currentPeerId) {
            console.log(`Received message: "${message}" from ${fromId}`);
            displayMessage(message, false); // false means it's a remote message
        } else {
            console.warn(`Received message from unexpected peer: ${fromId}`);
        }
    });
    // --------------------------------------------------------------

    socket.on('match-found', ({ peerId, initiator }) => {
        // --- Add the console error log here for visibility ---
        console.error("!!!!!!!! MATCH FOUND EVENT RECEIVED !!!!!!!!"); // Make it stand out
        console.log(`Match details: Peer=${peerId}, Initiator=${initiator}`);
        // --- END DEBUG LOG ---

        isLooking = false;
        currentPeerId = peerId;
        isWebRTCInitiator = initiator;
        updateChatStatus(`Matched! Starting video...`);

        // --- Log before/after critical UI/WebRTC calls ---
        console.log(">>> Calling showView('in-chat')...");
        showView('in-chat'); // Ensure this calls the version with internal logs/try-catch
        console.log("<<< Returned from showView('in-chat').");

        console.log(">>> Calling resetChatUI('in-chat')...");
        resetChatUI('in-chat');
        console.log("<<< Returned from resetChatUI('in-chat').");

        console.log(">>> Calling startWebRTCConnection()...");
        startWebRTCConnection(); // Ensure this calls the robust version
        console.log("<<< Returned from startWebRTCConnection().");
        // --- End Logs ---
    });

    socket.on('chat-ended', ({ reason }) => {
        console.log(`Chat end event received: ${reason}`);
        // Avoid alerting if the user initiated the end
        if (reason && !reason.toLowerCase().startsWith('you ')) {
            alert(`Chat ended: ${reason}`);
        }
        resetChatState(); // Central place to reset after any chat end reason
    });

    socket.on('error-occurred', ({ message }) => {
        console.error(`Server error-occurred event: ${message}`);
        showStatusMessage(`Server error: ${message}`, true);
        // Optional: Consider resetting state on certain server errors
        // resetChatState();
    });

    socket.on('webrtc-signal', async ({ signal, fromId }) => {
        // Add check for peerConnection existence
        if (!currentPeerId || fromId !== currentPeerId || !peerConnection) {
            console.warn("Ignoring signal for wrong/no peer/connection", { currentPeerId, fromId, hasPC: !!peerConnection, signalType: signal?.type });
            return;
        }
        try {
            console.log(`Received signal type: ${signal?.type} from ${fromId}`);
            switch (signal.type) {
                case 'offer': await handleOffer(signal); break; // Ensure handleOffer has detailed logs/catch
                case 'answer': await handleAnswer(signal); break;
                case 'candidate': await handleCandidate(signal); break;
                default: console.warn("Unknown signal type:", signal.type); break;
            }
        } catch (e) {
            console.error(`Signal processing error (Type: ${signal?.type}):`, e);
            handleWebRTCError(`Error processing signal: ${signal?.type}. ${e.message}`); // Pass specific error info
        }
    });

    console.log("Socket listeners setup complete.");
}

// ==================================================
// 12. WebSocket Initialization << USES setupSocketListeners
// ==================================================
function connectWebSocket(token) {
    if (socket) { socket.disconnect(); socket = null; }
    updateSocketStatus('Connecting...', 'var(--socket-status-connecting-color)');
    startChatButton.disabled = true; // Disable while connecting
    updateMediaButtonsState(!!localStream); // Update based on existing stream status
    socket = io(SOCKET_URL, { auth: { token }, transports: ['websocket'] /* Optional: Force WS */ });
    setupSocketListeners(); // Setup listeners
}
function disconnectWebSocket() { if (socket) { console.log("Disconnecting WebSocket."); socket.disconnect(); socket = null; updateSocketStatus('Offline', 'grey'); } }


// ==================================================
// 13. REST API Calls << USES showView, showUserInfo, connectWebSocket etc.
// ==================================================
async function handleRegister(event) {
    event.preventDefault(); clearStatusMessage(); const username = regUsernameInput.value.trim(); const password = regPasswordInput.value.trim(); const gender = regGenderSelect.value; const preference = regPreferenceSelect.value;
    if (!username || !password || !gender) { showStatusMessage('Fill username, password, gender.', true); return; } if (password.length < 6) { showStatusMessage('Password >= 6 chars.', true); return; }
    try {
        showStatusMessage('Registering...', false); const response = await fetch(`${API_BASE_URL}/register`, { method: 'POST', headers: { 'Content-Type': 'application/json', }, body: JSON.stringify({ username, password, gender, preference: preference || 'any' }), }); const data = await response.json(); if (!response.ok || !data.success) { throw new Error(data.message || `HTTP ${response.status}`); } showStatusMessage(data.message || 'Registered! Please log in.', false); registerForm.reset(); showView('login');
    } catch (error) { console.error('Reg fail:', error); showStatusMessage(`Reg fail: ${error.message}`, true); }
}
// --- Modified handleLogin to call startPreview ---
async function handleLogin(event) {
    event.preventDefault(); clearStatusMessage(); const username = loginUsernameInput.value.trim(); const password = loginPasswordInput.value.trim(); if (!username || !password) { showStatusMessage('Enter username & password.', true); return; }
    try {
        showStatusMessage('Logging in...', false);
        const response = await fetch(`${API_BASE_URL}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', }, body: JSON.stringify({ username, password }), });
        const data = await response.json();
        if (!response.ok || !data.success) { throw new Error(data.message || `HTTP ${response.status}`); }

        loginForm.reset();
        storeLoginData(data.token, data.user);
        showView('logged-in'); // Show the view first
        showUserInfo(data.user);
        await startPreview(); // <<<<<<< START PREVIEW HERE
        connectWebSocket(data.token); // Connect socket after showing view and starting preview attempt
        setTimeout(clearStatusMessage, 2000);

    } catch (error) {
        console.error('Login fail:', error);
        showStatusMessage(`Login fail: ${error.message}`, true);
    }
}

// ==================================================
// 14. Main Action Event Handlers << USES getMediaPermissions, socket.emit, resetChatUI etc.
// ==================================================
// --- Modified handleStartChat to use existing stream ---
async function handleStartChat() {
    console.log(">>> handleStartChat invoked <<<", { isLooking, currentPeerId, socketConnected: socket?.connected, hasLocalStream: !!localStream });

    // Check prerequisites
    if (!socket?.connected) { alert("Not connected to server."); return; }
    if (!localStream) { // Check if stream exists (should from preview)
        showStatusMessage("Camera/Mic not ready. Please grant permissions and wait.", true);
        updatePreviewStatus("Camera/Mic needed.", true); // Also update preview
        await startPreview(); // Try starting preview again
        return;
    }
    if (isLooking || currentPeerId) { console.log("Already looking or in chat, ignoring start click."); return; }

    // Disable button and update status
    startChatButton.disabled = true;
    updateChatStatus("Requesting match...");

    // We already have the stream from the preview, no need to call getMediaPermissions again.
    console.log("Media OK (from preview). Sending 'start-looking'...");
    socket.emit('start-looking');
    resetChatUI('searching');
}

// --- Modified handleSkipOrStop to rely on chat-ended ---
function handleSkipOrStop() {
    if (!socket?.connected) return;
    if (isLooking) { console.log("Stop looking action..."); socket.emit('stop-looking'); updateChatStatus('Stopping search...'); }
    else if (currentPeerId) { console.log("Skip chat action..."); socket.emit('skip'); updateChatStatus('Skipping...'); }
    // DO NOT reset state here. Wait for 'chat-ended' from server.
}

// --- Modified handleLogout to use stopLocalMedia ---
function handleLogout() {
    console.log("Handling logout.");
    stopLocalMedia(); // Use the new function to stop tracks and clear video elements
    resetChatState(); // Ensure peer connection closed, reset flags etc. (order matters, PC needs closing before state reset)
    disconnectWebSocket();
    clearLoginData();
    showView('login');
    showStatusMessage('Logged out.', false);
}
// --- Add Text Chat Send Function ---
function sendMessage() { // <-- ADD THIS FUNCTION
    if (!chatInput || !socket || !currentPeerId) return;
    const message = chatInput.value.trim();

    if (message) {
        console.log(`Sending message: "${message}" to ${currentPeerId}`);
        displayMessage(message, true); // Display locally

        // Send message via Server Relay
        socket.emit('send-message', {
            toId: currentPeerId,
            message: message
        });

        chatInput.value = ''; // Clear input field
    }
}

// ==================================================
// 15. Attach Event Listeners << Assigns handlers defined above
// ==================================================
registerForm?.addEventListener('submit', handleRegister);
loginForm?.addEventListener('submit', handleLogin);
logoutButton?.addEventListener('click', handleLogout);
showLoginLink?.addEventListener('click', (e) => { e.preventDefault(); showView('login'); });
showRegisterLink?.addEventListener('click', (e) => { e.preventDefault(); showView('register'); });
startChatButton?.addEventListener('click', handleStartChat);
skipButton?.addEventListener('click', handleSkipOrStop);
themeToggleButton?.addEventListener('click', toggleTheme);
muteButton?.addEventListener('click', toggleAudio);
videoToggleButton?.addEventListener('click', toggleVideo);
// --- Add Chat Event Listeners ---
toggleChatButton?.addEventListener('click', toggleChatArea);     // <-- ADD
sendMessageButton?.addEventListener('click', sendMessage);        // <-- ADD
chatInput?.addEventListener('keydown', (event) => {             // <-- ADD
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
    }
});

// ==================================================
// 16. Initial Load << Calls setup functions defined above
// ==================================================
// --- DOMContentLoaded now calls async checkLoginStatus ---
// app.js - Add near the top or inside DOMContentLoaded

// --- Function to handle the OAuth callback ---
function handleAuthCallback() {
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');
    const userParam = urlParams.get('user');
    const error = urlParams.get('error');

    console.log("Checking for Auth Callback Params:", { token, userParam, error });

    if (error) {
        console.error("OAuth Error received:", error);
        showStatusMessage(`Google Authentication Failed: ${error}`, true);
        // Clean the URL parameters
        window.history.replaceState({}, document.title, window.location.pathname);
        showView('login'); // Show login view on error
        return; // Stop processing
    }

    if (token && userParam) {
        console.log("OAuth Callback Success: Token and user data found.");
        try {
            const user = JSON.parse(userParam); // Parse user data

            // Store data like regular login
            storeLoginData(token, user);

            // Clean the URL parameters from address bar (important!)
            window.history.replaceState({}, document.title, window.location.pathname);

            // --- Redirect to Logged-in View ---
            showView('logged-in');
            showUserInfo(user);
            startPreview(); // Start camera preview
            connectWebSocket(token); // Connect WebSocket

            // Check if user needs to set gender/preference
            if (user.gender === 'other' || !user.gender || !user.preference) {
                // TODO: Implement UI indication or redirect to a profile setup page
                setTimeout(() => { // Delay slightly
                    showStatusMessage('Welcome! Please update your profile gender/preference if needed.', false);
                    // Maybe highlight profile section or show a modal
                }, 1000);
            }

        } catch (e) {
            console.error("Error processing OAuth callback user data:", e);
            showStatusMessage("Failed to process login data.", true);
            // Clean the URL parameters
            window.history.replaceState({}, document.title, window.location.pathname);
            showView('login'); // Fallback to login
        }
    } else {
        console.log("No OAuth callback parameters detected.");
        // Proceed with normal login check if no callback params
        checkLoginStatus(); // Your existing function
    }
}

document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM fully loaded and parsed.");
    loadTheme();
    // --- Call the callback handler INSTEAD of checkLoginStatus directly ---
    handleAuthCallback();
    // --- End Change ---

    // Initial button state
    if (startChatButton) startChatButton.disabled = true;
    if (muteButton) muteButton.disabled = true;
    if (videoToggleButton) videoToggleButton.disabled = true;
    console.log("Initial setup complete.");
});