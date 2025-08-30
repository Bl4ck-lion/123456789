"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import io from "socket.io-client";
import nacl from "tweetnacl";
import * as naclutil from "tweetnacl-util";

const SERVER = process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:3001";

function b64ToU8(b64) {
  return new Uint8Array(Buffer.from(b64, "base64"));
}
function u8ToB64(u8) {
  return Buffer.from(u8).toString("base64");
}

export default function Chat() {
  const [username, setUsername] = useState("");
  const [connected, setConnected] = useState(false);
  const [users, setUsers] = useState([]);
  const [peer, setPeer] = useState("");
  const [room, setRoom] = useState("umum");
  const [members, setMembers] = useState([]);
  const [msg, setMsg] = useState("");
  const [log, setLog] = useState([]);

  const socketRef = useRef(null);
  const keypair = useMemo(() => nacl.box.keyPair(), []);
  const pubKeyB64 = useMemo(() => u8ToB64(keypair.publicKey), [keypair]);

  async function fetchUsers() {
    try {
      const res = await fetch(`${SERVER}/users`);
      const data = await res.json();
      setUsers(data.users || []);
    } catch (e) {}
  }

  function connect() {
    const s = io(SERVER, { auth: { username } });
    socketRef.current = s;
    s.on("connect", () => setConnected(true));
    s.on("disconnect", () => setConnected(false));
    s.on("presence", ({ username: u, online }) =>
      setLog((l) => [
        {
          ts: Date.now(),
          sys: true,
          text: `${u} ${online ? "online" : "offline"}`,
        },
        ...l,
      ])
    );
    s.on("room-update", ({ room, members }) => setMembers(members || []));
    s.on("private-message", (payload) => {
      try {
        const nonce = b64ToU8(payload.nonce);
        const cipher = b64ToU8(payload.ciphertext);
        const fromPub = b64ToU8(payload.fromPubKey);
        const plain = nacl.box.open(cipher, nonce, fromPub, keypair.secretKey);
        if (!plain) return;
        const text = naclutil.encodeUTF8(plain);
        setLog((l) => [{ ts: payload.ts, from: payload.from, text }, ...l]);
      } catch (e) {}
    });
    s.on("group-message", ({ room, payload }) => {
      try {
        const nonce = b64ToU8(payload.nonce);
        const cipher = b64ToU8(payload.ciphertext);
        const fromPub = b64ToU8(payload.fromPubKey);
        const plain = nacl.box.open(cipher, nonce, fromPub, keypair.secretKey);
        if (!plain) return;
        const text = naclutil.encodeUTF8(plain);
        setLog((l) => [
          { ts: payload.ts, from: payload.from, room, text },
          ...l,
        ]);
      } catch (e) {}
    });
  }

  function encryptFor(recipientPubB64, plaintext) {
    const nonce = nacl.randomBytes(nacl.box.nonceLength);
    const recipientPub = b64ToU8(recipientPubB64);
    const msgU8 = naclutil.decodeUTF8(plaintext);
    const cipher = nacl.box(msgU8, nonce, recipientPub, keypair.secretKey);
    return {
      nonce: u8ToB64(nonce),
      ciphertext: u8ToB64(cipher),
      fromPubKey: pubKeyB64,
    };
  }

  function sendPrivate() {
    if (!peer || !msg) return;
    const target = users.find((u) => u.username === peer);
    if (!target) return alert("Peer not found");
    const payload = encryptFor(target.publicKey, msg);
    socketRef.current.emit("private-message", {
      to: peer,
      payload: { ...payload, from: username, ts: Date.now() },
    });
    setLog((l) => [
      { ts: Date.now(), from: username, to: peer, text: msg },
      ...l,
    ]);
    setMsg("");
  }

  function joinRoom() {
    socketRef.current.emit("join-room", { room });
  }
  function leaveRoom() {
    socketRef.current.emit("leave-room", { room });
    setMembers([]);
  }
  function sendGroup() {
    if (!msg || members.length === 0) return;
    const packets = [];
    for (const m of members) {
      if (m === username) continue;
      const info = users.find((u) => u.username === m);
      if (!info) continue;
      packets.push({
        to: m,
        payload: {
          ...encryptFor(info.publicKey, msg),
          from: username,
          ts: Date.now(),
        },
      });
    }
    socketRef.current.emit("group-message", { room, packets });
    setLog((l) => [
      { ts: Date.now(), from: username, room, text: msg },
      ...l,
    ]);
    setMsg("");
  }

  useEffect(() => {
    const id = setInterval(() => {
      fetchUsers();
    }, 3000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex h-screen bg-gray-900 text-gray-100">
      {/* Sidebar */}
      <div className="w-1/4 bg-gray-800 border-r border-gray-700 hidden md:flex flex-col">
        <div className="p-4 border-b border-gray-700">
          <h2 className="text-xl font-bold">Login</h2>
          <input
            className="w-full p-2 mt-2 rounded bg-gray-700 outline-none"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={connected}
            placeholder="Username"
          />
          <button
            className="mt-2 w-full bg-blue-600 hover:bg-blue-500 p-2 rounded"
            onClick={() => {
              connect();
            }}
          >
            {connected ? "Connected" : "Connect"}
          </button>
          <p className="text-xs mt-2">
            PubKey: <code>{pubKeyB64.slice(0, 24)}...</code>
          </p>
        </div>

        <div className="p-4 flex-1 overflow-y-auto">
          <h3 className="font-semibold mb-2">Users</h3>
          <ul className="space-y-1">
            {users.map((u) => (
              <li key={u.username}>
                <button
                  onClick={() => setPeer(u.username)}
                  className={`block w-full text-left p-2 rounded ${
                    peer === u.username
                      ? "bg-blue-600"
                      : "hover:bg-gray-700"
                  }`}
                >
                  {u.username}
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="p-4 border-t border-gray-700">
          <h3 className="font-semibold mb-1">Group</h3>
          <input
            className="w-full p-2 rounded bg-gray-700 outline-none"
            value={room}
            onChange={(e) => setRoom(e.target.value)}
          />
          <div className="flex gap-2 mt-2">
            <button
              onClick={joinRoom}
              className="flex-1 bg-green-600 hover:bg-green-500 p-1 rounded"
            >
              Join
            </button>
            <button
              onClick={leaveRoom}
              className="flex-1 bg-red-600 hover:bg-red-500 p-1 rounded"
            >
              Leave
            </button>
          </div>
          <p className="text-sm mt-1">Members: {members.join(", ") || "-"}</p>
        </div>
      </div>

      {/* Chat Panel */}
      <div className="flex flex-col flex-1">
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {log.map((m, i) => (
            <div
              key={i}
              className={`flex ${
                m.from === username ? "justify-end" : "justify-start"
              }`}
            >
              <div
                className={`px-4 py-2 rounded-2xl max-w-xs ${
                  m.from === username
                    ? "bg-blue-600 text-white rounded-br-none"
                    : "bg-gray-700 text-gray-200 rounded-bl-none"
                }`}
              >
                <div className="text-xs opacity-70 mb-1">
                  {m.room ? `[${m.room}]` : ""} {m.from}
                </div>
                <div>{m.text}</div>
                <div className="text-[10px] opacity-50 mt-1">
                  {new Date(m.ts).toLocaleTimeString()}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="p-3 border-t border-gray-700 flex gap-2 bg-gray-800">
          <input
            className="flex-1 bg-gray-700 rounded-xl px-4 py-2 outline-none"
            value={msg}
            onChange={(e) => setMsg(e.target.value)}
            placeholder="Tulis pesan..."
            onKeyDown={(e) => e.key === "Enter" && (peer ? sendPrivate() : sendGroup())}
          />
          <button
            onClick={sendPrivate}
            disabled={!peer || !msg}
            className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-xl"
          >
            Private
          </button>
          <button
            onClick={sendGroup}
            disabled={!msg}
            className="bg-green-600 hover:bg-green-500 px-4 py-2 rounded-xl"
          >
            Group
          </button>
        </div>
      </div>
    </div>
  );
}
