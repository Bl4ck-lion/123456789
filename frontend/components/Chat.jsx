import { useEffect, useMemo, useRef, useState } from 'react';
import io from 'socket.io-client';
import nacl from 'tweetnacl';
import * as naclutil from 'tweetnacl-util';

const SERVER = process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3001';

function b64ToU8(b64){ return new Uint8Array(Buffer.from(b64, 'base64')); }
function u8ToB64(u8){ return Buffer.from(u8).toString('base64'); }

export default function Chat(){
  const [username, setUsername] = useState('');
  const [connected, setConnected] = useState(false);
  const [users, setUsers] = useState([]);
  const [peer, setPeer] = useState('');
  const [room, setRoom] = useState('umum');
  const [members, setMembers] = useState([]);
  const [msg, setMsg] = useState('');
  const [log, setLog] = useState([]);

  const socketRef = useRef(null);
  const keypair = useMemo(()=>nacl.box.keyPair(), []);
  const pubKeyB64 = useMemo(()=>u8ToB64(keypair.publicKey), [keypair]);

  async function fetchUsers(){
    try{
      const res = await fetch(`${SERVER}/users`);
      const data = await res.json();
      setUsers(data.users || []);
    }catch(e){}
  }

  function connect(){
    const s = io(SERVER, { auth: { username } });
    socketRef.current = s;
    s.on('connect', ()=> setConnected(true));
    s.on('disconnect', ()=> setConnected(false));
    s.on('presence', ({ username: u, online })=> setLog(l=>[{ts:Date.now(), sys:true, text:`${u} ${online?'online':'offline'}`}, ...l]));
    s.on('room-update', ({ room, members})=> setMembers(members || []));
    s.on('private-message', payload => {
      try{
        const nonce = b64ToU8(payload.nonce);
        const cipher = b64ToU8(payload.ciphertext);
        const fromPub = b64ToU8(payload.fromPubKey);
        const plain = nacl.box.open(cipher, nonce, fromPub, keypair.secretKey);
        if(!plain) return;
        const text = naclutil.encodeUTF8(plain);
        setLog(l => [{ ts: payload.ts, from: payload.from, text }, ...l]);
      }catch(e){}
    });
    s.on('group-message', ({ room, payload })=>{
      try{
        const nonce = b64ToU8(payload.nonce);
        const cipher = b64ToU8(payload.ciphertext);
        const fromPub = b64ToU8(payload.fromPubKey);
        const plain = nacl.box.open(cipher, nonce, fromPub, keypair.secretKey);
        if(!plain) return;
        const text = naclutil.encodeUTF8(plain);
        setLog(l => [{ ts: payload.ts, from: payload.from, room, text }, ...l]);
      }catch(e){}
    });
  }

  async function register(){
    // register publicKey via socket event (if server supports)
    try{
      await fetch(`${SERVER}/users`);
      fetchUsers();
    }catch(e){}
  }

  function encryptFor(recipientPubB64, plaintext){
    const nonce = nacl.randomBytes(nacl.box.nonceLength);
    const recipientPub = b64ToU8(recipientPubB64);
    const msgU8 = naclutil.decodeUTF8(plaintext);
    const cipher = nacl.box(msgU8, nonce, recipientPub, keypair.secretKey);
    return { nonce: u8ToB64(nonce), ciphertext: u8ToB64(cipher), fromPubKey: pubKeyB64 };
  }

  function sendPrivate(){
    if(!peer || !msg) return;
    const target = users.find(u => u.username === peer);
    if(!target) return alert('Peer not found');
    const payload = encryptFor(target.publicKey, msg);
    socketRef.current.emit('private-message', { to: peer, payload: { ...payload, from: username, ts: Date.now() } });
    setLog(l=>[{ ts: Date.now(), from: username, to: peer, text: msg }, ...l]);
    setMsg('');
  }

  function joinRoom(){ socketRef.current.emit('join-room', { room }); }
  function leaveRoom(){ socketRef.current.emit('leave-room', { room }); setMembers([]); }
  function sendGroup(){
    if(!msg || members.length === 0) return;
    const packets = [];
    for(const m of members){
      if(m===username) continue;
      const info = users.find(u=>u.username===m);
      if(!info) continue;
      packets.push({ to: m, payload: { ...encryptFor(info.publicKey, msg), from: username, ts: Date.now() }});
    }
    socketRef.current.emit('group-message', { room, packets });
    setLog(l=>[{ ts: Date.now(), from: username, room, text: msg }, ...l]);
    setMsg('');
  }

  useEffect(()=>{
    const id = setInterval(()=>{ fetchUsers(); }, 3000);
    return ()=>clearInterval(id);
  },[]);

  return (
    <div style={{ display:'grid', gridTemplateColumns: '1fr 2fr', gap:12 }}>
      <div>
        <div style={{ border:'1px solid #ddd', padding:12, borderRadius:8 }}>
          <h3>Login / Register</h3>
          <input value={username} onChange={e=>setUsername(e.target.value)} disabled={connected} placeholder="username" />
          <div style={{ marginTop:8 }}>
            <button onClick={async ()=>{ await register(); connect(); }}>Connect</button>
          </div>
          <p style={{ fontSize:12 }}>PublicKey: <code>{pubKeyB64.slice(0,32)}…</code></p>
        </div>

        <div style={{ marginTop:12 }}>
          <h4>Users</h4>
          <ul>
            {users.map(u=> <li key={u.username}><button onClick={()=>setPeer(u.username)} style={{ background: peer===u.username? '#eef':'transparent' }}>{u.username}</button></li>)}
          </ul>
        </div>

        <div style={{ marginTop:12 }}>
          <h4>Group</h4>
          <input value={room} onChange={e=>setRoom(e.target.value)} />
          <div><button onClick={joinRoom}>Join</button> <button onClick={leaveRoom}>Leave</button></div>
          <p>Members: {members.join(', ') || '-'}</p>
        </div>
      </div>

      <div>
        <textarea value={msg} onChange={e=>setMsg(e.target.value)} style={{ width:'100%', minHeight:100 }} />
        <div>
          <button onClick={sendPrivate} disabled={!peer || !msg}>Kirim Privat (E2E)</button>
          <button onClick={sendGroup} disabled={!msg}>Kirim Grup</button>
        </div>

        <div style={{ marginTop:12 }}>
          <h4>Log</h4>
          <ul>
            {log.map((m,i)=> <li key={i}><small>{new Date(m.ts).toLocaleString()} {m.room?`[${m.room}]`:''} {m.from}{m.to?` → ${m.to}`:''}</small><div>{m.text}</div></li>)}
          </ul>
        </div>
      </div>
    </div>
  );
}
