# 🌐 UniVibe - Anonymous Video Chat

**UniVibe** is a web-based anonymous video chat application inspired by platforms like Omegle. It enables users to connect randomly with strangers for one-on-one video and text conversations, with an option to filter based on gender preferences.

---

## ✨ Features

- **🔐 User Authentication:**
  - Secure registration and login using a username and password.
  - Google OAuth 2.0 authentication option.

- **🧑‍🤝‍🧑 Profile & Preferences:**
  - Set gender (male, female, other).
  - Choose preferred gender for chat partners (male, female, any).
  - Change preferences during an active session (applied next match).

- **🔄 Random Matching:**
  - Real-time search and matching with other users based on mutual preferences.

- **📹 Real-time Video & Audio Chat:**
  - Peer-to-peer connection via WebRTC.
  - STUN servers for NAT traversal.

- **🎛 In-Chat Controls:**
  - Mute/Unmute microphone.
  - Turn camera on/off.
  - Skip current chat.
  - Text chat overlay within the video call.

- **🎨 User Interface:**
  - Dark/Light mode with local storage persistence.
  - Video preview before connecting.
  - Connection and status indicators.

- **🛠 Backend & Real-Time Communication:**
  - Node.js + Express.js for server and REST API.
  - Socket.IO for signaling, text chat, and real-time state updates.
  - MongoDB (Mongoose) for data persistence.

---

## 🚀 Tech Stack

### Frontend (`univibe-frontend`)
- HTML5, CSS3 (with CSS Variables)
- Vanilla JavaScript (ES6+)
- Socket.IO Client
- WebRTC APIs (`getUserMedia`, `RTCPeerConnection`)

### Backend (`univibebackend`)
- Node.js
- Express.js
- Socket.IO
- MongoDB (Mongoose ODM)
- JWT for authentication
- `bcryptjs` for password encryption
- `passport`, `passport-google-oauth20` for Google login
- `express-session` for session handling
- `dotenv` for managing environment variables

---

## 📈 Project Status & Future Development

**Current Status:** ✅ Functional in local development.  
**Core Features Implemented:** User auth, preference-based matching, WebRTC video/audio, basic in-chat controls.

### 🛠 Planned Improvements:
- **Deployment:**
  - Frontend: Vercel / Netlify
  - Backend: Render / Fly.io
  - Cloud MongoDB: MongoDB Atlas

- **Scalability:**
  - Integrate **Redis** for distributed user state management.
  - Implement **TURN server** (e.g., Coturn/Twilio NTS) for better connectivity.

- **UX Enhancements:**
  - Mobile responsiveness.
  - Profile page for OAuth users.
  - "Report User" feature.
  - E2E encryption for text chat (via WebRTC Data Channels).
  - Display connection quality stats.

- **Code Quality:**
  - Modularize frontend code using ES6 modules.
  - Add testing (unit/integration).

---

## 🧪 Local Development Setup

### 1. Prerequisites
- Node.js and npm (or yarn)
- MongoDB installed locally or access to MongoDB Atlas

### 2. Clone the Repository
```bash
git clone <repository-url>
cd univibe
