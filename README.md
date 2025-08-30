# Secure Chat (Vercel frontend + Realtime server)
This package contains:
- frontend/: Next.js app designed to deploy to Vercel (set NEXT_PUBLIC_SERVER_URL)
- server/: Express + Socket.IO realtime server to deploy to Render/Railway/Fly

Important:
- The frontend is Vercel-ready. The realtime server must be hosted on a platform that supports WebSocket.
- This is a demo starter. To reach production-level security, integrate libsignal-protocol, secure storage, attestation, and perform audits.

To create a ZIP or deploy, see the files in each folder.
