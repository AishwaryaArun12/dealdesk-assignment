import React, { useState, useEffect } from 'react';
import { io } from 'socket.io-client';

const API_URL = 'http://localhost:4000';

export default function App() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('');
  const [user, setUser] = useState(null);
  const [deals, setDeals] = useState([]);
  const [selectedDeal, setSelectedDeal] = useState(null);
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [notifications, setNotifications] = useState([]);
  const [socket, setSocket] = useState(null);

  // Login handler
  const handleLogin = async (e) => {
    e.preventDefault();
    const res = await fetch(`${API_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (res.ok) {
      setToken(data.token);
      setUser(data.user);
      initSocket(data.token);
      fetchDeals(data.token);
    } else {
      alert(data.error || 'Login failed');
    }
  };

  // Initialize Socket.io
  const initSocket = (jwtToken) => {
    const s = io(API_URL, { auth: { token: jwtToken } });
    setSocket(s);

    s.on('system_notification', (notif) => {
      setNotifications(prev => [notif, ...prev]);
    });

    s.on('new_message', (data) => {
      setMessages(prev => [...prev, data.message]);
    });
  };

  // Fetch Deals based on user's data scope
  const fetchDeals = async (jwtToken) => {
    const res = await fetch(`${API_URL}/deals`, {
      headers: { 'Authorization': `Bearer ${jwtToken}` }
    });
    const data = await res.json();
    if (res.ok) setDeals(data);
  };

  // Join deal chat thread
  const selectDeal = (deal) => {
    setSelectedDeal(deal);
    if (socket) {
      socket.emit('join_thread', { dealId: deal._id });
    }
  };

  // Send message
  const sendMessage = (e) => {
    e.preventDefault();
    if (!socket || !selectedDeal) return;
    socket.emit('send_message', { dealId: selectedDeal._id, message: chatInput });
    setChatInput('');
  };

  if (!token) {
    return (
      <div style={{ padding: '40px', fontFamily: 'sans-serif', maxWidth: '400px', margin: 'auto' }}>
        <h2>DealDesk Login</h2>
        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} required />
          <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} required />
          <button type="submit" style={{ padding: '10px', background: '#007bff', color: '#fff', border: 'none' }}>Login</button>
        </form>
      </div>
    );
  }

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif', display: 'flex', gap: '20px' }}>
      {/* Left Column: Deals List */}
      <div style={{ flex: 1, borderRight: '1px solid #ccc', paddingRight: '20px' }}>
        <h3>Welcome, {user.name}</h3>
        <h4>Deals (Scoped to your Role)</h4>
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {deals.map(deal => (
            <li key={deal._id} onClick={() => selectDeal(deal)} style={{ padding: '10px', background: selectedDeal?._id === deal._id ? '#e2e6ea' : '#f8f9fa', marginBottom: '5px', cursor: 'pointer', borderRadius: '4px' }}>
              <strong>{deal.title}</strong> - ${deal.amount} ({deal.status})
            </li>
          ))}
        </ul>
      </div>

      {/* Middle Column: Chat & Deal Actions */}
      <div style={{ flex: 2 }}>
        {selectedDeal ? (
          <div>
            <h3>Chat for: {selectedDeal.title}</h3>
            <div style={{ border: '1px solid #ccc', height: '300px', overflowY: 'scroll', padding: '10px', marginBottom: '10px', background: '#fff' }}>
              {messages.map((msg, idx) => (
                <div key={idx} style={{ marginBottom: '8px' }}>
                  <strong>{msg.senderId?.name || 'User'}: </strong> {msg.message}
                </div>
              ))}
            </div>
            <form onSubmit={sendMessage} style={{ display: 'flex', gap: '10px' }}>
              <input type="text" value={chatInput} onChange={e => setChatInput(e.target.value)} placeholder="Type a message..." style={{ flex: 1, padding: '8px' }} />
              <button type="submit" style={{ padding: '8px 16px' }}>Send</button>
            </form>
          </div>
        ) : (
          <p>Select a deal to open the chat thread.</p>
        )}
      </div>

      {/* Right Column: Real-time System Notifications */}
      <div style={{ flex: 1, background: '#f1f3f5', padding: '15px', borderRadius: '5px', height: '400px', overflowY: 'auto' }}>
        <h4>Live System Notifications</h4>
        {notifications.map((n, idx) => (
          <div key={idx} style={{ background: '#fff', padding: '8px', marginBottom: '8px', borderRadius: '4px', fontSize: '13px', borderLeft: '4px solid #28a745' }}>
            <strong>{n.type}</strong>
            <div>{n.message}</div>
          </div>
        ))}
      </div>
    </div>
  );
}