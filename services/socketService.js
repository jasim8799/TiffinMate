const socketIO = require('socket.io');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

class SocketService {
  static isInitialized = false;
  static eventVersion = 1;

  constructor() {
    this.io = null;
    this.connectedClients = new Map(); // userId -> socketId
    this.pingInterval = null; // For heartbeat pings
  }

  /**
   * Safe emit method that checks if io is initialized before emitting
   * @param {string} event - Event name
   * @param {string} room - Room name to emit to
   * @param {object} payload - Data payload
   */
  safeEmit(event, room, payload) {
    if (!this.io) {
      console.warn('⚠️ Socket.IO not initialized, cannot emit:', event);
      return;
    }
    // Add eventVersion to payload if not present
    if (!payload.eventVersion) {
      payload.eventVersion = SocketService.eventVersion++;
    }
    this.io.to(room).emit(event, payload);
  }

  /**
   * Start heartbeat ping mechanism
   * Sends ping to all connected clients every 30 seconds
   */
  startHeartbeat() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }

    this.pingInterval = setInterval(() => {
      if (this.io) {
        const timestamp = Date.now();
        console.log('💓 Sending heartbeat ping to all clients');

        // Send ping to all connected clients
        this.io.emit('ping', {
          timestamp,
          message: 'heartbeat'
        });
      }
    }, 30000); // 30 seconds

    console.log('💓 Heartbeat ping mechanism started (30s interval)');
  }

  /**
   * Stop heartbeat ping mechanism
   */
  stopHeartbeat() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
      console.log('💓 Heartbeat ping mechanism stopped');
    }
  }

  initialize(server) {
    if (SocketService.isInitialized) {
      console.log('SocketService already initialized, skipping.');
      return this.io;
    }

    this.io = socketIO(server, {
      cors: {
        origin: process.env.CORS_ORIGIN || '*',
        credentials: true,
        methods: ['GET', 'POST']
      },
      transports: ['websocket', 'polling']
    });

    this.io.on('connection', async (socket) => {
      console.log(`🔌 Client connected: ${socket.id}`);

      try {
        // Require JWT authentication during connection
        const token = socket.handshake.auth?.token;

        if (!token) {
          console.log(`❌ No token provided for socket: ${socket.id}`);
          socket.emit('auth_error', { message: 'Authentication token required' });
          socket.disconnect(true);
          return;
        }

        // Verify JWT token using same secret as auth middleware
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.id).select('-password');

        if (!user) {
          console.log(`❌ User not found for socket: ${socket.id}`);
          socket.emit('auth_error', { message: 'User not found' });
          socket.disconnect(true);
          return;
        }

        if (!user.isActive) {
          console.log(`❌ User account disabled for socket: ${socket.id}`);
          socket.emit('auth_error', { message: 'Account disabled' });
          socket.disconnect(true);
          return;
        }

        // Attach user info to socket
        socket.userId = user._id.toString();
        socket.role = user.role;

        // Register connected client
        this.connectedClients.set(socket.userId, socket.id);

        // Join role-specific rooms
        socket.join(`user:${socket.userId}`); // Personal room
        socket.join(`role:${user.role}`); // Role-based room

        // Join specialized rooms based on role
        if (user.role === 'owner') {
          socket.join('owners');
        } else if (user.role === 'kitchen') {
          socket.join('kitchen');
        }

        console.log(`✅ User authenticated via socket: ${socket.userId} (${user.role})`);
        socket.emit('authenticated', { success: true, userId: socket.userId, role: user.role });

      } catch (error) {
        console.log(`❌ JWT verification failed for socket: ${socket.id}`, error.message);
        socket.emit('auth_error', { message: 'Invalid authentication token' });
        socket.disconnect(true);
        return;
      }

      socket.on('disconnect', () => {
        if (socket.userId) {
          this.connectedClients.delete(socket.userId);
          console.log(`❌ User disconnected: ${socket.userId}`);
        } else {
          console.log(`❌ Client disconnected: ${socket.id}`);
        }
      });
    });

    // Start heartbeat ping mechanism
    this.startHeartbeat();

    console.log('🚀 Socket.IO initialized with heartbeat');
    SocketService.isInitialized = true;
    return this.io;
  }

  // ========== USER & SUBSCRIPTION EVENTS ==========

  emitUserCreated(userData) {
    console.log('📢 Broadcasting: user_created', userData._id);

    const eventId = `${userData._id}_created_${Date.now()}`;

    // Notify all owners
    this.safeEmit('user_created', 'owners', {
      user: userData,
      eventId,
      timestamp: new Date()
    });
  }

  emitUserUpdated(userData) {
    console.log('📢 Broadcasting: user_updated', userData._id);

    const eventId = `${userData._id}_updated_${Date.now()}`;

    // Notify the specific user
    this.safeEmit('user_updated', `user:${userData._id}`, {
      user: userData,
      eventId,
      timestamp: new Date()
    });

    // Notify all owners
    this.safeEmit('user_updated', 'owners', {
      user: userData,
      eventId,
      timestamp: new Date()
    });
  }

  emitUserDeleted(userId) {
    console.log('📢 Broadcasting: user_deleted', userId);

    const eventId = `${userId}_deleted_${Date.now()}`;

    // Notify the specific user (for logout)
    this.safeEmit('user_deleted', `user:${userId}`, {
      userId,
      eventId,
      timestamp: new Date()
    });

    // Notify all owners
    this.safeEmit('user_deleted', 'owners', {
      userId,
      eventId,
      timestamp: new Date()
    });
  }

  emitSubscriptionCreated(subscriptionData) {
    console.log('📢 Broadcasting: subscription_created', subscriptionData._id);

    const eventId = `${subscriptionData._id}_created_${Date.now()}`;

    // Notify the specific user
    this.safeEmit('subscription_created', `user:${subscriptionData.user}`, {
      subscription: subscriptionData,
      eventId,
      timestamp: new Date()
    });

    // Notify all owners
    this.safeEmit('subscription_created', 'owners', {
      subscription: subscriptionData,
      eventId,
      timestamp: new Date()
    });
  }

  emitSubscriptionUpdated(subscriptionData) {
    console.log('📢 Broadcasting: subscription_updated', subscriptionData._id);

    const eventId = `${subscriptionData._id}_updated_${Date.now()}`;

    // Notify the specific user
    this.safeEmit('subscription_updated', `user:${subscriptionData.user}`, {
      subscription: subscriptionData,
      eventId,
      timestamp: new Date()
    });

    // Notify all owners
    this.safeEmit('subscription_updated', 'owners', {
      subscription: subscriptionData,
      eventId,
      timestamp: new Date()
    });
  }

  // ========== MEAL EVENTS ==========

  emitMealSelected(mealOrderData) {
    console.log('📢 Broadcasting: meal_selected', mealOrderData._id);

    // Notify all owners
    this.safeEmit('meal_selected', 'owners', {
      mealOrder: mealOrderData,
      timestamp: new Date()
    });
  }

  emitMealUpdated(mealOrderData) {
    console.log('📢 Broadcasting: meal_updated', mealOrderData._id);

    // Notify the specific user
    this.safeEmit('meal_updated', `user:${mealOrderData.user}`, {
      mealOrder: mealOrderData,
      timestamp: new Date()
    });

    // Notify all owners
    this.safeEmit('meal_updated', 'owners', {
      mealOrder: mealOrderData,
      timestamp: new Date()
    });
  }

  // ========== COOKING & DELIVERY EVENTS ==========

  emitCookingStarted(deliveryData) {
    console.log('📢 Broadcasting: cooking_started', deliveryData._id);

    // Notify the specific user
    this.safeEmit('cooking_started', `user:${deliveryData.user}`, {
      delivery: deliveryData,
      timestamp: new Date()
    });
  }

  emitOutForDelivery(deliveryData) {
    console.log('📢 Broadcasting: out_for_delivery', deliveryData._id);

    // Notify the specific user
    this.safeEmit('out_for_delivery', `user:${deliveryData.user}`, {
      delivery: deliveryData,
      timestamp: new Date()
    });
  }

  emitDelivered(deliveryData) {
    console.log('📢 Broadcasting: delivered', deliveryData._id);

    // Notify the specific user
    this.safeEmit('delivered', `user:${deliveryData.user}`, {
      delivery: deliveryData,
      timestamp: new Date()
    });

    // Notify all owners (for tracking)
    this.safeEmit('delivered', 'owners', {
      delivery: deliveryData,
      timestamp: new Date()
    });
  }

  emitDeliveryStatusUpdated(deliveryData) {
    console.log('📢 Broadcasting: delivery_status_updated', deliveryData._id);

    // Notify the specific user
    this.safeEmit('delivery_status_updated', `user:${deliveryData.user}`, {
      delivery: deliveryData,
      timestamp: new Date()
    });

    // Notify all owners
    this.safeEmit('delivery_status_updated', 'owners', {
      delivery: deliveryData,
      timestamp: new Date()
    });
  }

  // ========== PAYMENT EVENTS ==========

  emitPaymentCreated(paymentData) {
    console.log('📢 Broadcasting: payment_created', paymentData._id);

    // Notify all owners
    this.safeEmit('payment_created', 'owners', {
      payment: paymentData,
      timestamp: new Date()
    });
  }

  emitPaymentVerified(paymentData) {
    console.log('📢 Broadcasting: payment_verified', paymentData._id);

    // Notify the specific user
    this.safeEmit('payment_verified', `user:${paymentData.user}`, {
      payment: paymentData,
      timestamp: new Date()
    });

    // Notify all owners
    this.safeEmit('payment_verified', 'owners', {
      payment: paymentData,
      timestamp: new Date()
    });
  }

  emitPaymentReceived(paymentData) {
    console.log('📢 Broadcasting: payment_received', paymentData._id);

    // Notify the specific user
    this.safeEmit('payment_received', `user:${paymentData.user}`, {
      payment: paymentData,
      timestamp: new Date()
    });

    // Notify all owners
    this.safeEmit('payment_received', 'owners', {
      payment: paymentData,
      timestamp: new Date()
    });
  }

  emitPaymentStatusUpdated(paymentData) {
    console.log('📢 Broadcasting: payment_status_updated', paymentData._id);

    // Notify the specific user
    this.safeEmit('payment_status_updated', `user:${paymentData.user}`, {
      payment: paymentData,
      timestamp: new Date()
    });

    // Notify all owners
    this.safeEmit('payment_status_updated', 'owners', {
      payment: paymentData,
      timestamp: new Date()
    });
  }

  // ========== DASHBOARD REFRESH EVENT ==========

  emitDashboardRefreshRequired(reason) {
    console.log('📢 Broadcasting: dashboard_refresh_required -', reason);

    const eventId = `dashboard_refresh_${Date.now()}`;

    // Notify all owners
    this.safeEmit('dashboard_refresh_required', 'owners', {
      reason,
      eventId,
      timestamp: new Date()
    });
  }

  // ========== NOTIFICATION EVENTS ==========

  emitNotification(notificationData) {
    console.log('📢 Broadcasting notification to owners:', notificationData.type);

    // Notify all owners
    this.safeEmit('notification', 'owners', {
      notification: notificationData,
      timestamp: new Date()
    });
  }

  emitNotificationToUser(userId, notification) {
    console.log('📢 Sending notification to user:', userId);

    this.safeEmit('notification', `user:${userId}`, {
      notification,
      timestamp: new Date()
    });
  }

  emitBroadcastNotification(notification) {
    if (!this.io) {
      console.warn('⚠️ Socket.IO not initialized, cannot emit broadcast');
      return;
    }

    console.log('📢 Broadcasting notification to all users');

    // Only use for system alerts, not general broadcasts
    this.io.emit('system_alert', {
      notification,
      timestamp: new Date()
    });
  }

  // ========== UTILITY METHODS ==========

  /**
   * Generic method to emit any event to a specific user
   * @param {string} userId - User ID to emit to
   * @param {string} event - Event name
   * @param {object} payload - Data payload
   */
  emitToUser(userId, event, payload) {
    console.log(`📤 Emitting '${event}' to user: ${userId}`);
    this.safeEmit(event, `user:${userId}`, {
      ...payload,
      timestamp: new Date()
    });
  }

  /**
   * Generic method to emit any event to all owners
   * @param {string} event - Event name
   * @param {object} payload - Data payload
   */
  emitToOwners(event, payload) {
    console.log(`📤 Emitting '${event}' to all owners`);
    this.safeEmit(event, 'owners', {
      ...payload,
      timestamp: new Date()
    });
  }

  getConnectedClients() {
    return Array.from(this.connectedClients.keys());
  }

  isUserConnected(userId) {
    return this.connectedClients.has(userId);
  }

  // ============================================================
  // PHASE 16 — RESTAURANT STATUS + DELIVERY STATUS EVENTS
  // ============================================================

  /**
   * Broadcast restaurant open/close state to ALL connected clients.
   * Both customers and the owner panel react to this event.
   * @param {{ isOpen: boolean, message?: string, updatedBy?: string, updatedAt: Date }} data
   */
  emitRestaurantStatusUpdated(data) {
    if (!this.io) {
      console.warn('⚠️ Socket.IO not initialized, cannot emit restaurant_status_updated');
      return;
    }
    console.log(`📢 Broadcasting: restaurant_status_updated — isOpen: ${data.isOpen}`);
    this.io.emit('restaurant_status_updated', {
      ...data,
      eventId: `restaurant_${Date.now()}`,
      timestamp: new Date(),
    });
  }

  /**
   * Notify a specific user that their delivery status changed.
   * Also notifies the owners room so dashboard updates.
   * @param {{ deliveryId, userId, userName?, status, mealType, deliveryDate, updatedAt }} data
   */
  emitDeliveryStatusUpdated(data) {
    console.log(`📢 delivery_status_updated → user:${data.userId} & owners`);
    const eventId = `delivery_${data.deliveryId}_${Date.now()}`;
    const payload = { ...data, eventId, timestamp: new Date() };
    this.safeEmit('delivery_status_updated', `user:${data.userId}`, payload);
    this.safeEmit('delivery_status_updated', 'owners', payload);
  }
}

// Export singleton instance
module.exports = new SocketService();
