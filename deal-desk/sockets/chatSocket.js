const jwt = require('jsonwebtoken');
const User = require('../models/User');
const ChatThread = require('../models/ChatThread');
const ChatMessage = require('../models/ChatMessage');
const Deal = require('../models/Deal');

function initSocket(io) {
    // 1. Authenticate socket connection at the handshake stage using JWT
    io.use(async (socket, next) => {
        try {
            const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.split(' ')[1];
            if (!token) {
                return next(new Error('Authentication error: Token missing'));
            }

            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            const userId = decoded.id || decoded.userId || decoded.sub;
            const user = await User.findById(userId).populate('roleId');

            if (!user) {
                return next(new Error('Authentication error: User not found'));
            }

            socket.user = user;
            next();
        } catch (err) {
            next(new Error('Authentication error: Invalid token'));
        }
    });

    io.on('connection', async (socket) => {
        const userId = socket.user._id;
        console.log(`User connected to socket: ${socket.user.name} (${userId})`);
        
        socket.join(userId.toString());             // Personal room for notifications
        socket.join(socket.user.branchId.toString()); // Branch room
        // Automatically join rooms for all chat threads this user participates in
        try {
            const threads = await ChatThread.find({ participants: userId });
            threads.forEach(thread => {
                socket.join(thread._id.toString());
            });
        } catch (err) {
            console.error('Error joining threads on connect:', err);
        }

        // Handle joining a specific deal thread (ensuring participant check)
        socket.on('join_thread', async ({ dealId }) => {
            try {
                let thread = await ChatThread.findOne({ dealId });
                if (!thread) {
                    // Create thread if it doesn't exist (Owner + Manager/Participants)
                    const deal = await Deal.findById(dealId);
                    if (!deal) return socket.emit('error', { message: 'Deal not found' });
                    
                    thread = await ChatThread.create({
                        dealId,
                        participants: [deal.ownerId] // Owner is initial participant
                    });
                }

                // If user is not yet a participant, add them (anyone who comments/joins becomes a participant)
                if (!thread.participants.includes(userId)) {
                    thread.participants.push(userId);
                    await thread.save();
                }

                socket.join(thread._id.toString());
                socket.emit('joined_thread', { threadId: thread._id, dealId });
            } catch (err) {
                socket.emit('error', { message: 'Failed to join thread' });
            }
        });

        // Handle sending a chat message
        socket.on('send_message', async ({ dealId, message }) => {
            try {
                let thread = await ChatThread.findOne({ dealId });
                if (!thread) {
                    return socket.emit('error', { message: 'Thread not found' });
                }

                // Ensure sender is a participant
                if (!thread.participants.includes(userId)) {
                    thread.participants.push(userId);
                    await thread.save();
                }

                // Save message to database
                const chatMessage = await ChatMessage.create({
                    threadId: thread._id,
                    senderId: userId,
                    message,
                    readBy: [userId]
                });

                const populatedMessage = await ChatMessage.findById(chatMessage._id).populate('senderId', 'name email');

                // Deliver live into the specific room (no broadcasting to all)
                io.to(thread._id.toString()).emit('new_message', {
                    threadId: thread._id,
                    dealId,
                    message: populatedMessage
                });
            } catch (err) {
                socket.emit('error', { message: 'Failed to send message' });
            }
        });

        socket.on('disconnect', () => {
            console.log(`User disconnected: ${socket.user.name}`);
        });
    });
}

module.exports = initSocket;