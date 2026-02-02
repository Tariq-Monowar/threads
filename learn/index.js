const express = require('express');
const { Pool } = require('pg');
const { Server } = require('socket.io');
const mediasoup = require('mediasoup');
const os = require('os');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 3000;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_5lBiKSDN2ZnT@ep-empty-wind-a1vittzf-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require'
});

// CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});
app.use(express.json());

// DB check
pool.query('SELECT 1').then(() => console.log('✅ Database connected')).catch(err => console.error('Database:', err.message));

// REST: users
app.post('/users', async (req, res) => {
    try {
        const { userName, email } = req.body;
        const { rows } = await pool.query('INSERT INTO users (username, email) VALUES ($1, $2) RETURNING *', [userName, email]);
        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.get('/users', async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM users');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Mediasoup
let worker;
const rooms = new Map();
const participants = new Map();

function getLocalIp() {
    for (const ifaces of Object.values(os.networkInterfaces())) {
        for (const iface of ifaces) {
            if (iface.family === 'IPv4' && !iface.internal) return iface.address;
        }
    }
    return '127.0.0.1';
}

async function createWorker() {
    worker = await mediasoup.createWorker({ logLevel: 'warn', rtcMinPort: 40000, rtcMaxPort: 49999 });
    worker.on('died', () => { console.error('Worker died'); process.exit(1); });
    console.log('✅ Mediasoup worker ready');
    return worker;
}

async function getOrCreateRouter(roomId) {
    if (rooms.has(roomId)) return rooms.get(roomId);
    const router = await worker.createRouter({
        mediaCodecs: [
            { kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2 },
            { kind: 'video', mimeType: 'video/VP8', clockRate: 90000 }
        ]
    });
    rooms.set(roomId, router);
    return router;
}

function getProducersForRoom(roomId) {
    const list = [];
    for (const [socketId, p] of participants) {
        if (p.roomId !== roomId) continue;
        for (const producer of p.producers.values()) list.push({ id: producer.id, kind: producer.kind, socketId });
    }
    return list;
}

function cleanupParticipant(socketId) {
    const p = participants.get(socketId);
    if (!p) return null;
    p.transports.forEach(t => t.close());
    participants.delete(socketId);
    const leftInRoom = [...participants.values()].filter(x => x.roomId === p.roomId);
    if (leftInRoom.length === 0) {
        const r = rooms.get(p.roomId);
        if (r) { r.close(); rooms.delete(p.roomId); }
    }
    return p.roomId;
}

const httpServer = http.createServer(app);
const io = new Server(httpServer, { cors: { origin: '*', methods: ['GET', 'POST'] } });

io.on('connection', (socket) => {
    console.log('✅ Client:', socket.id);

    socket.on('createRoom', async ({ roomId }, cb) => {
        try {
            const router = await getOrCreateRouter(roomId);
            participants.set(socket.id, { roomId, router, transports: new Map(), producers: new Map(), consumers: new Map() });
            socket.join(roomId);
            cb({ rtpCapabilities: router.rtpCapabilities });
        } catch (err) {
            cb({ error: err.message });
        }
    });

    socket.on('createTransport', async ({ type }, cb) => {
        try {
            const p = participants.get(socket.id);
            if (!p) return cb({ error: 'Participant not found' });
            const announcedIp = process.env.MEDIASOUP_ANNOUNCED_IP || getLocalIp();
            const transport = await p.router.createWebRtcTransport({
                listenIps: [{ ip: '0.0.0.0', announcedIp }],
                enableUdp: true,
                enableTcp: true,
                preferUdp: true
            });
            p.transports.set(transport.id, transport);
            transport.on('dtlsstatechange', (state) => { if (state === 'closed') transport.close(); });
            cb({ id: transport.id, iceParameters: transport.iceParameters, iceCandidates: transport.iceCandidates, dtlsParameters: transport.dtlsParameters });
        } catch (err) {
            cb({ error: err.message });
        }
    });

    socket.on('connectTransport', async ({ transportId, dtlsParameters }, cb) => {
        try {
            const p = participants.get(socket.id);
            const t = p?.transports.get(transportId);
            if (!t) return cb({ error: p ? 'Transport not found' : 'Participant not found' });
            await t.connect({ dtlsParameters });
            cb({ success: true });
        } catch (err) {
            cb({ error: err.message });
        }
    });

    socket.on('produce', async ({ transportId, kind, rtpParameters }, cb) => {
        try {
            const p = participants.get(socket.id);
            const t = p?.transports.get(transportId);
            if (!t) return cb({ error: p ? 'Transport not found' : 'Participant not found' });
            const producer = await t.produce({ kind, rtpParameters });
            p.producers.set(producer.id, producer);
            socket.to(p.roomId).emit('newProducer', { producerId: producer.id, kind: producer.kind, socketId: socket.id });
            cb({ id: producer.id });
        } catch (err) {
            cb({ error: err.message });
        }
    });

    socket.on('consume', async ({ transportId, producerId, rtpCapabilities }, cb) => {
        try {
            const p = participants.get(socket.id);
            if (!p) return cb({ error: 'Participant not found' });
            let producer, producerSocketId;
            for (const [sid, px] of participants) {
                if (px.producers.has(producerId)) {
                    producer = px.producers.get(producerId);
                    producerSocketId = sid;
                    break;
                }
            }
            if (!producer) return cb({ error: 'Producer not found' });
            if (producerSocketId === socket.id) return cb({ error: 'Cannot consume own producer' });
            if (!p.router.canConsume({ producerId, rtpCapabilities })) return cb({ error: 'RTP capabilities mismatch' });
            const recvTransport = p.transports.get(transportId);
            if (!recvTransport) return cb({ error: 'Receive transport not found' });
            const consumer = await recvTransport.consume({ producerId, rtpCapabilities, paused: false });
            p.consumers.set(consumer.id, consumer);
            cb({ id: consumer.id, producerId: consumer.producerId, kind: consumer.kind, rtpParameters: consumer.rtpParameters });
        } catch (err) {
            cb({ error: err.message });
        }
    });

    socket.on('getProducers', (dataOrCb, maybeCb) => {
        const cb = typeof dataOrCb === 'function' ? dataOrCb : maybeCb;
        const p = participants.get(socket.id);
        if (!p) return cb?.({ error: 'Participant not found' });
        cb?.({ producers: getProducersForRoom(p.roomId) });
    });

    socket.on('resumeConsumer', async ({ consumerId }, cb) => {
        try {
            const p = participants.get(socket.id);
            const c = p?.consumers.get(consumerId);
            if (!c) return cb({ error: p ? 'Consumer not found' : 'Participant not found' });
            if (c.paused) await c.resume();
            cb({ success: true });
        } catch (err) {
            cb({ error: err.message });
        }
    });

    socket.on('leaveRoom', () => {
        const roomId = cleanupParticipant(socket.id);
        if (roomId) {
            socket.leave(roomId);
            socket.to(roomId).emit('participantLeft', { socketId: socket.id });
        }
    });

    socket.on('disconnect', () => {
        const roomId = cleanupParticipant(socket.id);
        if (roomId) socket.to(roomId).emit('participantLeft', { socketId: socket.id });
    });
});

async function start() {
    await createWorker();
    httpServer.listen(PORT, () => console.log(`🚀 http://localhost:${PORT}`));
}
start();
