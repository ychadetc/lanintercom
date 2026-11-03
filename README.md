# LAN Voice — React + Express + WebRTC

A starter LAN group voice application with room codes, active-room discovery, continuous calls, and push-to-talk.

## Requirements
- Node.js 20 or newer
- All phones/computers connected to the same Wi-Fi/LAN
- Microphone permission in the browser

## Install and run
From this folder:

```bash
npm install
npm run dev
```

Open `http://localhost:5173` on the host computer. On other devices, open `http://HOST_LAN_IP:5173` (the backend prints detected LAN IP addresses when it starts). The backend listens on `0.0.0.0:3001`.

For Windows Firewall, allow Node.js on private networks or allow inbound TCP ports 3001 and 5173. The UDP room announcement uses port 41234. Keep the network profile set to Private.

## How it works
- Express + Socket.IO manage rooms, membership, presence, and WebRTC signaling.
- WebRTC carries audio directly between browsers. Audio is not routed through Express.
- Push-to-talk disables the local microphone track until the user holds the talk button.
- Continuous mode leaves the microphone track enabled unless muted.
- Room announcements are sent as UDP broadcast packets every three seconds. Since browser JavaScript cannot receive UDP packets, browser room lists are delivered over Socket.IO from the same LAN server.

## Important limitations / production notes
- This is a LAN starter, not a hardened production communications system. There is no login, encryption policy beyond browser WebRTC defaults, moderation, or persistent room storage.
- Peer-to-peer mesh uses one WebRTC connection per participant pair. It is suitable for small groups; bandwidth and CPU usage grow quickly as participants increase. For larger rooms, use an SFU such as mediasoup or LiveKit.
- `iceServers` is empty intentionally for a same-LAN first version. Some Wi-Fi networks/client isolation settings may prevent peer-to-peer connectivity. For cross-subnet or restrictive networks, configure a local STUN/TURN service (for example coturn) and add its ICE server configuration.
- Microphone access generally requires a secure context. `localhost` is treated as secure, but opening the app over plain `http://192.168.x.x` on a phone may be blocked by browser security. For reliable phone testing, serve the app over HTTPS using a trusted local certificate or a development tunnel. A tunnel is not needed for LAN networking itself; HTTPS is for browser microphone permissions.
- Current discovery lists rooms on the one backend server you opened. The UDP beacon is an announcement, not a full multi-server browser discovery protocol.

## Build
```bash
npm run build
```

The Vite frontend build is generated in `client/dist`. Configure the Express server to serve that directory if you want a single production URL; this starter runs frontend and backend separately in development.
