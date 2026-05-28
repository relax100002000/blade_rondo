// net.js — MQTT-over-WebSocket relay using public EMQX broker.
// Both clients in a "room" subscribe to the same topic; messages are JSON.
// No signup, no server to run — works from file:// too.
window.Net = (() => {
  let client = null, topic = '', myRole = '', connected = false;
  const myId = Math.random().toString(36).slice(2, 10);
  const handlers = { onConnect: () => {}, onMessage: () => {}, onError: () => {}, onClose: () => {} };

  // Default brokers to try in order
  const BROKERS = [
    'wss://broker.emqx.io:8084/mqtt',
    'wss://broker.hivemq.com:8884/mqtt'
  ];

  function connect(roomCode, role, brokerUrl, opts) {
    Object.assign(handlers, opts || {});
    myRole = role;
    topic = `bladerondo/v2/${roomCode}`;
    const url = brokerUrl || BROKERS[0];
    if (typeof mqtt === 'undefined') { handlers.onError('未載入 mqtt.js'); return; }
    const clientId = 'br-' + myId + '-' + Math.random().toString(36).slice(2, 6);
    client = mqtt.connect(url, {
      clientId, clean: true, reconnectPeriod: 3000, connectTimeout: 10000,
      keepalive: 30
    });
    client.on('connect', () => {
      connected = true;
      client.subscribe(topic, { qos: 0 }, (err) => {
        if (err) handlers.onError('訂閱失敗：' + err.message);
        else handlers.onConnect();
      });
    });
    client.on('message', (t, payload) => {
      try {
        const msg = JSON.parse(payload.toString());
        if (msg.from === myId) return; // ignore self-loopback
        handlers.onMessage(msg);
      } catch (e) {}
    });
    client.on('error', (e) => handlers.onError(e.message || String(e)));
    client.on('close', () => { connected = false; handlers.onClose(); });
  }

  function send(msg) {
    if (!client || !connected) return;
    msg.from = myId;
    msg.ts = Date.now();
    client.publish(topic, JSON.stringify(msg), { qos: 0 });
  }

  function disconnect() {
    if (client) try { client.end(true); } catch {} 
    client = null; connected = false;
  }

  return {
    connect, send, disconnect,
    myId: () => myId,
    isConnected: () => connected,
    role: () => myRole,
    roomCode: () => topic.split('/').pop()
  };
})();
