import { WebhookMessaging, ConversationContext, ConversationMessage, TelegramNotification } from '../types';
import { generateChatResponse, analyzePaymentImage } from '../services/openrouter';
import {
  sendMessage,
  sendTypingIndicator,
  getUserProfile,
  generateMessageLink,
  extractImageUrls,
  isMessageSentByAI
} from '../services/instagram';
import { sendPaymentNotification } from '../services/telegram';
import { config } from '../config';

// In-memory conversation store (consider using Redis for production)
const conversations: Map<string, ConversationContext> = new Map();

// System prompt for the chatbot - customize this based on your needs
const SYSTEM_PROMPT = `You are a helpful assistant for Darwin's course. You help answer questions about the course, pricing, and enrollment.

Key information:
- The course is currently on a waiting list
- Waiting list price: ₱1,778 (limited to 30 slots)
- Official price after reopening: ₱2,178
- To join the waiting list, users should DM "WAITING LIST"
- The course includes lifetime community access with regular updates
- Access is controlled to ensure member results

Be friendly, professional, and helpful. Answer questions concisely.
If someone sends a payment screenshot, acknowledge it and let them know you'll verify it.

IMPORTANT: Do not use text formatting such as ** for bold, * for italic, or any markdown formatting. This is sent via Instagram and Instagram does not support those types of formatting. Use plain text only.`;

// Constants
const HUMAN_TAKEOVER_TIMEOUT = 30 * 60 * 1000; // 30 minutes
const CONVERSATION_TIMEOUT = 24 * 60 * 60 * 1000; // 24 hours for full conversation history

// Waiting list form link
const WAITING_LIST_FORM_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSclnNifOnPgTyNSD-GAcQoTCHBqpoQmAgxUkBPtP4-M3nYN2Q/viewform';

/**
 * Check if message contains "waiting list" keyword
 */
function isWaitingListRequest(text: string): boolean {
  const normalizedText = text.toLowerCase().trim();
  return normalizedText.includes('waiting list') ||
         normalizedText.includes('waitinglist') ||
         normalizedText === 'waiting' ||
         normalizedText === 'waitlist';
}

/**
 * Main entry point for handling incoming webhook messages
 */
export async function handleIncomingMessage(messaging: WebhookMessaging): Promise<void> {
  const senderId = messaging.sender.id;
  const recipientId = messaging.recipient.id;
  const message = messaging.message;

  if (!message) {
    console.log('No message content in webhook');
    return;
  }

  // Check if this is an echo (message sent by the page)
  if (message.is_echo) {
    await handleEchoMessage(messaging);
    return;
  }

  // This is a message FROM a user TO our page
  console.log(`Received message from ${senderId}:`, message.text || '[attachment]');

  // Get or create conversation context
  let context = getOrCreateContext(senderId);

  // Record user message time
  context.lastUserMessageTime = Date.now();

  // Check if AI should respond (human takeover logic)
  const shouldAIRespond = checkIfAIShouldRespond(context);

  // Show typing indicator
  await sendTypingIndicator(senderId, 'typing_on');

  try {
    // Check if the message contains images (potential payment)
    const imageUrls = extractImageUrls(message.attachments);

    if (imageUrls.length > 0) {
      // Always process payment images regardless of takeover status
      await handleImageMessage(senderId, imageUrls, context);
    }

    // Handle text message for AI response
    if (message.text) {
      // Add user message to conversation history
      addMessageToContext(context, {
        role: 'user',
        content: message.text,
        timestamp: Date.now(),
        messageId: message.mid,
      });

      if (shouldAIRespond) {
        await handleTextMessage(senderId, context);
      } else {
        console.log(`AI response paused for ${senderId} - human takeover active`);
      }
    } else if (imageUrls.length > 0 && shouldAIRespond) {
      // If only image was sent and AI is active, acknowledge it
      const ackMessage = "Thank you for sending that! I'm checking the image now.";
      const messageId = await sendMessage(senderId, ackMessage);

      addMessageToContext(context, {
        role: 'assistant',
        content: ackMessage,
        timestamp: Date.now(),
        messageId: messageId || undefined,
        sentByAI: true,
      });
    }

    // Save context
    conversations.set(senderId, context);

  } catch (error) {
    console.error('Error handling message:', error);
    if (shouldAIRespond) {
      await sendMessage(senderId, "Sorry, I'm having trouble processing your message. Please try again.");
    }
  } finally {
    await sendTypingIndicator(senderId, 'typing_off');
  }
}

/**
 * Handle echo messages (messages sent by the page - either AI or human)
 */
async function handleEchoMessage(messaging: WebhookMessaging): Promise<void> {
  const recipientId = messaging.recipient.id; // The user who received the message
  const message = messaging.message;

  if (!message) return;

  const messageId = message.mid;
  const isFromAI = isMessageSentByAI(messageId);

  console.log(`Echo received - Message ID: ${messageId}, Sent by AI: ${isFromAI}`);

  // If this message was NOT sent by our AI, it means a human sent it
  if (!isFromAI && message.text) {
    console.log(`Human takeover detected for user ${recipientId}`);

    let context = getOrCreateContext(recipientId);

    // Mark human takeover
    context.humanTookOver = true;
    context.humanTakeoverTime = Date.now();

    // Add the human's message to conversation history
    addMessageToContext(context, {
      role: 'assistant',
      content: message.text,
      timestamp: Date.now(),
      messageId: messageId,
      sentByAI: false, // Sent by human
    });

    conversations.set(recipientId, context);

    console.log(`AI paused for user ${recipientId} until 30 min of inactivity + user message`);
  }
}

/**
 * Check if AI should respond based on human takeover status
 */
function checkIfAIShouldRespond(context: ConversationContext): boolean {
  // If no human takeover, AI should respond
  if (!context.humanTookOver) {
    return true;
  }

  const now = Date.now();
  const takeoverTime = context.humanTakeoverTime || 0;
  const timeSinceTakeover = now - takeoverTime;

  // Check if 30 minutes have passed since human takeover
  if (timeSinceTakeover < HUMAN_TAKEOVER_TIMEOUT) {
    console.log(`Human takeover still active. ${Math.round((HUMAN_TAKEOVER_TIMEOUT - timeSinceTakeover) / 60000)} minutes remaining`);
    return false;
  }

  // 30 minutes have passed - check if human has replied recently
  // Find the last message from the page (assistant role)
  const lastAssistantMessage = [...context.messages]
    .reverse()
    .find(m => m.role === 'assistant');

  const lastUserMessage = [...context.messages]
    .reverse()
    .find(m => m.role === 'user');

  // If there's a user message after the last human response, and 30 min passed, re-enable AI
  if (lastUserMessage && lastAssistantMessage) {
    // Check if the last assistant message was from a human (not AI)
    if (lastAssistantMessage.sentByAI === false) {
      // Human was last to respond - check if they've been silent for 30 min
      const timeSinceHumanResponse = now - lastAssistantMessage.timestamp;

      if (timeSinceHumanResponse >= HUMAN_TAKEOVER_TIMEOUT) {
        // Human hasn't responded in 30 min, and user sent a new message
        // Re-enable AI
        console.log(`Re-enabling AI for conversation - human inactive for 30+ minutes`);
        context.humanTookOver = false;
        context.humanTakeoverTime = undefined;
        return true;
      }
    } else {
      // Last assistant message was from AI - this means human hasn't replied after AI
      // Re-enable AI
      context.humanTookOver = false;
      context.humanTakeoverTime = undefined;
      return true;
    }
  }

  return false;
}

/**
 * Get or create conversation context for a user
 */
function getOrCreateContext(senderId: string): ConversationContext {
  let context = conversations.get(senderId);

  if (!context || Date.now() - context.lastUpdated > CONVERSATION_TIMEOUT) {
    context = {
      senderId,
      messages: [],
      lastUpdated: Date.now(),
      humanTookOver: false,
    };
  }

  return context;
}

/**
 * Add a message to conversation context
 */
function addMessageToContext(context: ConversationContext, message: ConversationMessage): void {
  context.messages.push(message);
  context.lastUpdated = Date.now();

  // Keep conversation history (no limit for full context, but clean up very old messages)
  // Keep last 50 messages for context window management
  if (context.messages.length > 50) {
    context.messages = context.messages.slice(-50);
  }
}

/**
 * Format conversation history for AI
 */
function formatConversationForAI(context: ConversationContext): { role: 'user' | 'assistant'; content: string }[] {
  return context.messages.map(m => ({
    role: m.role,
    content: m.content,
  }));
}

/**
 * Handle text message - generate AI response or send waiting list form
 */
async function handleTextMessage(senderId: string, context: ConversationContext): Promise<void> {
  // Get the last user message
  const lastUserMessage = context.messages[context.messages.length - 1];

  // Check if user is requesting the waiting list
  if (lastUserMessage && isWaitingListRequest(lastUserMessage.content)) {
    const waitingListResponse = `Here is the form link:\n${WAITING_LIST_FORM_URL}\n\nSee you there!`;

    const messageId = await sendMessage(senderId, waitingListResponse);

    addMessageToContext(context, {
      role: 'assistant',
      content: waitingListResponse,
      timestamp: Date.now(),
      messageId: messageId || undefined,
      sentByAI: true,
    });

    console.log(`Sent waiting list form to ${senderId}`);
    return;
  }

  // Get full conversation history for AI
  const conversationHistory = formatConversationForAI(context);

  // Generate AI response with full context
  const aiResponse = await generateChatResponse(conversationHistory, SYSTEM_PROMPT);

  // Send response to user
  const messageId = await sendMessage(senderId, aiResponse);

  // Add assistant response to history
  addMessageToContext(context, {
    role: 'assistant',
    content: aiResponse,
    timestamp: Date.now(),
    messageId: messageId || undefined,
    sentByAI: true,
  });
}

/**
 * Handle image message - check for payment
 */
async function handleImageMessage(senderId: string, imageUrls: string[], context: ConversationContext): Promise<void> {
  for (const imageUrl of imageUrls) {
    console.log(`Analyzing image from ${senderId}: ${imageUrl}`);

    // Analyze the image for payment detection
    const paymentResult = await analyzePaymentImage(imageUrl);

    console.log('Payment analysis result:', paymentResult);

    if (paymentResult.isPayment) {
      // Get user profile for notification
      const userProfile = await getUserProfile(senderId);

      // Create notification
      const notification: TelegramNotification = {
        instagramName: userProfile.name || 'Unknown',
        instagramUsername: userProfile.username,
        messageLink: generateMessageLink(senderId),
        paymentImageUrl: imageUrl,
        paymentDetails: paymentResult,
      };

      // Send Telegram notification (if enabled)
      if (config.telegram.enabled) {
        await sendPaymentNotification(notification);
      }

      // Only send acknowledgment if AI is active
      const shouldAIRespond = checkIfAIShouldRespond(context);
      if (shouldAIRespond) {
        const ackMessage = `Thank you for your payment! I've received your GCash transaction${paymentResult.amount ? ` of ${paymentResult.amount}` : ''}. Our team will verify and process it shortly.`;
        const messageId = await sendMessage(senderId, ackMessage);

        addMessageToContext(context, {
          role: 'assistant',
          content: ackMessage,
          timestamp: Date.now(),
          messageId: messageId || undefined,
          sentByAI: true,
        });
      }

      console.log(`Payment notification sent for user ${senderId}`);
    }
  }
}

// Cleanup old conversations periodically
setInterval(() => {
  const now = Date.now();
  for (const [senderId, context] of conversations.entries()) {
    if (now - context.lastUpdated > CONVERSATION_TIMEOUT) {
      conversations.delete(senderId);
      console.log(`Cleaned up conversation for ${senderId}`);
    }
  }
}, 5 * 60 * 1000); // Run every 5 minutes
