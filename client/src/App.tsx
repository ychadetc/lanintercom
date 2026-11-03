import { useCallback, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { AudioLines, Copy, Headphones, LogOut, Mic, MicOff, Plus, Radio, RefreshCw, Users, Volume2, Wifi } from 'lucide-react';

type Room = { code: string; name: string; mode: 'ptt' | 'continuous'; participantCount: number };
type Peer = { id: string; displayName: string };
type Joined = { code: string; name: string; mode: 'ptt' | 'continuous'; peers: Peer[] };
const SERVER_URL = `${window.location.protocol}//${window.location.hostname}:3001`;
const socket = io(window.location.origin, {
  path: '/socket.io',
  autoConnect: true,
  transports: ['websocket', 'polling'],
  reconnection: true,
});
const rtcConfig: RTCConfiguration = { iceServers: [] }; // Same-LAN calls work without a public STUN/TURN service in typical networks.

export default function App() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [joined, setJoined] = useState<Joined | null>(null);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [name, setName] = useState(localStorage.getItem('lanvoice-name') || 'Guest');
  const [roomName, setRoomName] = useState('Team Voice');
  const [roomCode, setRoomCode] = useState('');
  const [mode, setMode] = useState<'ptt' | 'continuous'>('continuous');
  const [muted, setMuted] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [status, setStatus] = useState('Connecting to LAN server…');
  const [error, setError] = useState('');
  const localStream = useRef<MediaStream | null>(null);
  const peerConnections = useRef(new Map<string, RTCPeerConnection>());
  const audioEls = useRef(new Map<string, HTMLAudioElement>());

  const closePeer = useCallback((id: string) => {
    peerConnections.current.get(id)?.close(); peerConnections.current.delete(id);
    audioEls.current.get(id)?.remove(); audioEls.current.delete(id);
    setPeers(prev => prev.filter(p => p.id !== id));
  }, []);

  const createPeer = useCallback((id: string, displayName = 'Participant') => {
    if (peerConnections.current.has(id)) return peerConnections.current.get(id)!;
    const pc = new RTCPeerConnection(rtcConfig);
    peerConnections.current.set(id, pc);
    localStream.current?.getTracks().forEach(track => pc.addTrack(track, localStream.current!));
    pc.onicecandidate = event => { if (event.candidate) socket.emit('webrtc:ice', { to: id, candidate: event.candidate }); };
    pc.ontrack = event => {
      let audio = audioEls.current.get(id);
      if (!audio) { audio = document.createElement('audio'); audio.autoplay = true; audio.playsInline = true; audio.dataset.peer = id; document.body.appendChild(audio); audioEls.current.set(id, audio); }
      audio.srcObject = event.streams[0]; void audio.play().catch(() => setStatus('Tap the page once to enable audio playback.'));
    };
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed' || pc.connectionState === 'closed') closePeer(id); };
    setPeers(prev => prev.some(p => p.id === id) ? prev : [...prev, { id, displayName }]);
    return pc;
  }, [closePeer]);

  useEffect(() => {
    socket.on('connect', () => setStatus('Connected to LAN voice server'));
    socket.on('disconnect', () => setStatus('Server disconnected'));
    socket.on('rooms:update', setRooms);
    socket.on('room:joined', async (data: Joined) => {
      setJoined(data); setMode(data.mode); setPeers(data.peers); setError('');
      for (const peer of data.peers) {
        const pc = createPeer(peer.id, peer.displayName);
        const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
        socket.emit('webrtc:offer', { to: peer.id, offer });
      }
    });
    socket.on('peer:joined', ({ id, displayName }: Peer) => setPeers(prev => prev.some(p => p.id === id) ? prev : [...prev, { id, displayName }]));
    socket.on('peer:left', ({ id }: { id: string }) => closePeer(id));
    socket.on('webrtc:offer', async ({ from, offer }) => {
      const pc = createPeer(from); await pc.setRemoteDescription(offer);
      const answer = await pc.createAnswer(); await pc.setLocalDescription(answer);
      socket.emit('webrtc:answer', { to: from, answer });
    });
    socket.on('webrtc:answer', async ({ from, answer }) => { await peerConnections.current.get(from)?.setRemoteDescription(answer); });
    socket.on('webrtc:ice', async ({ from, candidate }) => { try { await peerConnections.current.get(from)?.addIceCandidate(candidate); } catch (e) { console.warn('ICE candidate:', e); } });
    return () => { socket.off(); };
  }, [closePeer, createPeer]);

  useEffect(() => () => { localStream.current?.getTracks().forEach(t => t.stop()); peerConnections.current.forEach(pc => pc.close()); audioEls.current.forEach(a => a.remove()); }, []);

  async function getMicrophone() {
    if (!localStream.current) {
      localStream.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      // Add microphone tracks to any peers created before microphone permission was granted.
      peerConnections.current.forEach(pc => localStream.current!.getTracks().forEach(track => pc.addTrack(track, localStream.current!)));
    }
    return localStream.current;
  }
  async function createRoom() {
    try { await getMicrophone(); localStorage.setItem('lanvoice-name', name); socket.emit('room:create', { name: roomName, mode }, (r: any) => { if (!r?.ok) setError(r?.error || 'Could not create room'); }); }
    catch { setError('Microphone permission is required. Allow microphone access and try again.'); }
  }
  async function joinRoom(code: string) {
    try { await getMicrophone(); localStorage.setItem('lanvoice-name', name); socket.emit('room:join', { code, displayName: name }, (r: any) => { if (!r?.ok) setError(r?.error || 'Could not join room'); }); }
    catch { setError('Microphone permission is required. Allow microphone access and try again.'); }
  }
  function leaveRoom() {
    socket.disconnect(); peerConnections.current.forEach(pc => pc.close()); peerConnections.current.clear(); audioEls.current.forEach(a => a.remove()); audioEls.current.clear();
    localStream.current?.getTracks().forEach(t => t.stop()); localStream.current = null;
    setJoined(null); setPeers([]); setSpeaking(false); setMuted(false); socket.connect();
  }
  function setTransmit(active: boolean) {
    const enabled = active && !muted;
    localStream.current?.getAudioTracks().forEach(track => track.enabled = enabled);
    setSpeaking(enabled);
  }
  function toggleMute() { const next = !muted; setMuted(next); if (joined?.mode === 'continuous') { localStream.current?.getAudioTracks().forEach(track => track.enabled = !next); setSpeaking(!next); } }
  async function copyCode() { if (joined) await navigator.clipboard.writeText(joined.code); }

  return <main className="shell">
    <header className="topbar"><div className="brand"><div className="brand-icon"><Radio size={22}/></div><div><strong>LAN VOICE</strong><small>LOCAL NETWORK COMMUNICATION</small></div></div><div className="connection"><span className="pulse"/> {status}</div></header>
    {joined ? <section className="call-layout">
      <div className="call-head"><div><div className="eyebrow">VOICE ROOM · {joined.mode === 'ptt' ? 'PUSH TO TALK' : 'CONTINUOUS CALL'}</div><h1>{joined.name}</h1><p>Share this code with people on your local network.</p></div><div className="code-chip" onClick={copyCode}><span>{joined.code}</span><Copy size={16}/></div></div>
      <div className="call-card"><div className="room-stats"><span><Users size={17}/> {peers.length + 1} connected</span><span><Wifi size={17}/> LAN session</span></div><div className="participants"><div className="participant self"><div className={'avatar ' + (speaking ? 'active' : '')}><Headphones size={27}/></div><strong>{name || 'You'} (You)</strong><small>{speaking ? 'Transmitting' : muted || joined.mode === 'ptt' ? 'Microphone idle' : 'Connected'}</small></div>{peers.map((p, i) => <div className="participant" key={p.id}><div className="avatar"><span>{(p.displayName || 'G').slice(0,1).toUpperCase()}</span></div><strong>{p.displayName}</strong><small>Connected</small></div>)}</div>
        <div className="controls">{joined.mode === 'ptt' ? <button className={'talk-button ' + (speaking ? 'talking' : '')} onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); setTransmit(true); }} onPointerUp={() => setTransmit(false)} onPointerCancel={() => setTransmit(false)} onPointerLeave={() => setTransmit(false)}><Mic size={27}/><strong>{speaking ? 'TRANSMITTING' : 'HOLD TO TALK'}</strong><small>Press and hold to speak</small></button> : <button className={'mute-button ' + (!muted ? 'unmuted' : '')} onClick={toggleMute}>{muted ? <MicOff size={23}/> : <Mic size={23}/>}<span>{muted ? 'Unmute microphone' : 'Mute microphone'}</span></button>}<button className="leave-button" onClick={leaveRoom}><LogOut size={19}/> Leave room</button></div>
      </div><p className="hint"><Volume2 size={16}/> Use headphones to reduce echo when several people are in the same room.</p>
    </section> : <section className="home-layout"><div className="hero"><div className="eyebrow"><span className="pulse"/> PRIVATE LOCAL NETWORK VOICE</div><h1>Talk together.<br/><em>Stay connected.</em></h1><p>Create a voice room and let people on your Wi-Fi network join the conversation. No account required.</p><div className="hero-points"><span><Wifi size={16}/> Same network</span><span><AudioLines size={16}/> Live voice</span><span><Users size={16}/> Group rooms</span></div></div>
      <div className="panel-grid"><section className="panel create-panel"><div className="panel-title"><div className="panel-icon"><Plus/></div><div><h2>Create a room</h2><p>Start a new group voice session.</p></div></div><label>Your display name</label><input value={name} onChange={e => setName(e.target.value)} maxLength={24} placeholder="e.g. Alex"/><label>Room name</label><input value={roomName} onChange={e => setRoomName(e.target.value)} maxLength={40}/><label>Communication mode</label><div className="mode-picker"><button className={mode === 'continuous' ? 'selected' : ''} onClick={() => setMode('continuous')}><AudioLines size={17}/><span><b>Continuous</b><small>Open group call</small></span></button><button className={mode === 'ptt' ? 'selected' : ''} onClick={() => setMode('ptt')}><Mic size={17}/><span><b>Push-to-talk</b><small>Hold to transmit</small></span></button></div><button className="primary" onClick={createRoom}>Create voice room <Plus size={18}/></button></section>
      <section className="panel join-panel"><div className="panel-title"><div className="panel-icon"><Headphones/></div><div><h2>Join a room</h2><p>Enter a room code or discover one.</p></div></div><label>Room code</label><div className="join-input"><input value={roomCode} onChange={e => setRoomCode(e.target.value.replace(/\D/g,'').slice(0,6))} placeholder="6-digit code" inputMode="numeric"/><button onClick={() => joinRoom(roomCode)} disabled={roomCode.length !== 6}>Join</button></div><div className="room-list-head"><strong>Rooms on this server</strong><button onClick={() => socket.emit('rooms:refresh')} title="Refresh"><RefreshCw size={15}/></button></div><div className="room-list">{rooms.length ? rooms.map(room => <div className="room-row" key={room.code}><div className="room-mark"><Radio size={18}/></div><div className="room-info"><b>{room.name}</b><small>{room.code} · {room.mode === 'ptt' ? 'Push-to-talk' : 'Continuous'}</small></div><span className="room-count"><Users size={14}/>{room.participantCount}</span><button className="join-small" onClick={() => joinRoom(room.code)}>Join</button></div>) : <div className="empty"><Wifi size={21}/><span>No active rooms yet</span><small>Rooms appear here when someone creates one.</small></div>}</div></section></div>
      {error && <div className="error">{error}</div>}<div className="network-note"><Wifi size={17}/><span>All devices must connect to the same Wi-Fi/LAN and open this app using the host computer's LAN IP address.</span></div>
    </section>}
    <footer>LAN VOICE <span>•</span> WebRTC AUDIO <span>•</span> LOCAL NETWORK</footer>
  </main>;
}
