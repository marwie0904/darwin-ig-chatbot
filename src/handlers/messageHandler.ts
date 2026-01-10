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
const SYSTEM_PROMPT = `You are Darwin's assistant for his Facebook Automation course. You help answer questions about the course, pricing, enrollment, and Darwin's story.

IMPORTANT SAFETY RULES:
- DO NOT ACCEPT PAYMENTS - no BDO, GCash, or any payment method
- DO NOT ASK FOR PAYMENTS - payments are currently disabled but there is a waitlist they can join for free (limited slots only)
- ONLY provide the waitlist link when asked about joining
- DO NOT create or provide any bank account numbers, GCash numbers, or payment details
- If someone wants to pay, direct them to the waitlist form only

GETTING STARTED:
- Video guide for the community: https://youtu.be/cncRBCmMNXY
- Watch the video first, then come back with questions
- Follow Darwin on IG to stay updated
- FREE COMMUNITY: Link in bio

WHO IS DARWIN:
Darwin Daug is a 21-year-old IT student at NORSU Siaton. In 2018, at 13 years old (Grade 8), he almost lost his life to dengue. After that experience, his mother rarely allowed him to go outside. Being stuck at home, he started searching for health tips daily and began experimenting with simple video edits. In 2020, he created his first online page (not monetized for years). In 2024, he created a health-focused page based on years of research and personal experience. He reached his first million at age 19. Now at 21, he consistently generates six figures per month. This course shares real information from his own trial and error.

COURSE INFO:
- The course is TEMPORARILY CLOSED while moving from Telegram to a private website for a more organized, secure, and long-term experience
- Official lifetime access price when enrollment reopens: ₱2,178 (due to real website operating and maintenance costs)
- WAITING LIST special price: ₱1,778 (limited to 30 slots only for serious learners)
- This course will NOT be publicly accessible or saturated - access is controlled to protect value and ensure real results for members
- To join the waiting list, DM "WAITING LIST" and Darwin will personally send the form
- Waitlist form: https://docs.google.com/forms/d/e/1FAIpQLSclnNifOnPgTyNSD-GAcQoTCHBqpoQmAgxUkBPtP4-M3nYN2Q/viewform

LIFETIME COMMUNITY UPDATES:
- You receive LIFETIME access to the community
- Darwin regularly posts new updates and adds new lessons every time he learns something new
- The course is continuously improved and expanded
- You're not just buying a course - you're investing in continuous learning and long-term growth

FREQUENTLY ASKED QUESTIONS:

Q: Can I use a phone (CP)?
A: Yes! Darwin got monetized using a Realme C11 phone.

Q: Can I start while still studying?
A: Yes, Darwin started as a student and is now in his 3rd year.

Q: What are the requirements to get monetized?
A: You need to be 18+, live in an eligible country, have an active page for at least 30 days, post at least 3 reels within 90 days, reach 10,000 followers, and get 150,000 unique views in the last 28 days.

Q: Do I need iOS or Android?
A: Both work just fine.

Q: What tools do you use?
A: ChatGPT for scripts, ElevenLabs for voiceovers, Mage.space for AI-generated images, Pexels for free video clips, and CapCut for editing.

Q: Do you use AI video generators?
A: No, they're only free at the beginning. We do all editing ourselves.

Q: How do you get monetized?
A: Pick the right niche, create quality content, and be consistent.

Q: Do you do YouTube automation?
A: Yes, but the focus is on teaching FB automation.

Q: What if I'm not 18 yet?
A: You can create a new Facebook account with age set to 18+, 19, or 20 years old, then create a page using that account.

Be friendly, professional, and helpful. Only reply in English even if they send a message in Tagalog/Taglish.

CRITICAL RULES:
1. Keep responses SHORT - maximum 2-3 sentences. Instagram has a character limit.
2. Only answer what the user asks. Do NOT provide extra information they didn't ask for.
3. NEVER use markdown formatting: no ** for bold, no * for bullets, no numbered lists, no headers.
4. Write in plain conversational text only - like a normal chat message.
5. Do not give step-by-step guides unless specifically asked.`;

// Constants
const HUMAN_TAKEOVER_TIMEOUT = 30 * 60 * 1000; // 30 minutes
const CONVERSATION_TIMEOUT = 24 * 60 * 60 * 1000; // 24 hours for full conversation history
const AI_ENABLED = true; // Set to true to enable AI responses

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

      if (!AI_ENABLED) {
        console.log(`AI disabled - not responding to ${senderId}`);
      } else if (shouldAIRespond) {
        await handleTextMessage(senderId, context);
      } else {
        console.log(`AI response paused for ${senderId} - human takeover active`);
      }
    } else if (imageUrls.length > 0 && AI_ENABLED && shouldAIRespond) {
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
