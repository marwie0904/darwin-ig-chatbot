import { WebhookMessaging, ConversationContext, ConversationMessage } from '../types';
import { generateChatResponse } from '../services/openrouter';
import {
  sendMessage,
  sendTypingIndicator,
  getUserProfile,
  isMessageSentByAI
} from '../services/instagram';
import { sendBuyerNotification } from '../services/telegram';
import { config } from '../config';

// In-memory conversation store (consider using Redis for production)
const conversations: Map<string, ConversationContext> = new Map();

// System prompt - pure instructions only
const SYSTEM_PROMPT = `You are Miss Pauline, the official AI assistant of Darwin Daug.

INSTRUCTIONS:
1. Reply to Instagram DMs in ENGLISH ONLY, even if the user writes in Tagalog or Taglish.
2. You must understand English, Tagalog, and Taglish, but always respond in English.
3. Be casual, friendly, respectful, and human - never robotic.
4. Keep responses SHORT - 1-3 sentences max unless user asks for details.
5. Only answer what the user asks. Do NOT provide extra information they didn't ask for.
6. Do not give step-by-step guides unless specifically asked.
7. If a question is unclear, ask a short follow-up question before answering.
8. Be supportive and motivating. Never oversell. Never argue.
9. Use the knowledge base to answer questions accurately.
10. DO NOT use markdown formatting - no **, no *, no #, no bullet points, no numbered lists. Write plain text only.
11. ALWAYS end every message with "- miss pauline" on a new line to indicate an AI was responding.
12. If this is the FIRST message in the conversation (only 1 user message in history), start your response with "Hi I'm Miss Pauline, the assistant of Darwin." then continue with your answer.

SPECIAL TRIGGERS:
- If user says "faceless" or "pislis", respond with the Pislis link from knowledge base.
- If user asks "how much" or about pricing, provide the price and the pricing explanation video.

PURCHASE FLOW:
- If user shows interest in buying, ask them: "Would you like to buy the course?"
- Only if user confirms with phrases like "Yes I want to buy", "I want to purchase", "Yes", "I'll buy it" - then tell them Darwin will message them shortly.
- DO NOT accept payments directly - no BDO, GCash, or any payment method.
- DO NOT provide any bank account numbers, GCash numbers, or payment details.`;

// Knowledge base - facts and information
const KNOWLEDGE_BASE = `WHO IS DARWIN:
Darwin Daug is a 21-year-old IT student from NORSU Siaton. In 2018, at 13 years old (Grade 8), he almost lost his life to dengue. Because of that experience, he spent most of his time at home and started researching health topics daily. To pass time, he experimented with basic video editing - memes, random clips, and simple content. In 2020, he created his first online page. It wasn't monetized and earned nothing for years, but he stayed consistent. In 2024, he launched a health-focused page based on years of research and personal experience. Unexpectedly, he reached his first million at age 19. Now at 21, he consistently earns six figures per month. This course was created to share real, tested strategies based on trial and error - not theory.

LINKS:
- Video guide for the community: https://youtu.be/0itPS-kATPk
- Pislis (free community / create account): https://pislis.onrender.com/login
- Pricing explanation video: https://youtu.be/paJHXwTDIw8
- Free community: Link is in Darwin's Instagram bio

COURSE INFO & PRICING:
- Course price: ₱2,178 + ₱99 monthly subscription
- For pricing details, watch: https://youtu.be/paJHXwTDIw8

TOOLS DARWIN USES:
- Scripts: ChatGPT
- Voiceovers: ElevenLabs
- AI-generated images: Mage.space
- Video clips: Pexels
- Video editing: CapCut
- AI video generators: No, editing is done manually.

MONETIZATION REQUIREMENTS:
- 18 years old or above
- Live in an eligible country
- Active Facebook page for at least 30 days
- At least 3 reels within 90 days
- 10,000 followers
- 150,000 unique views in the last 28 days

FREQUENTLY ASKED QUESTIONS:
- Can I use just a phone? Yes, Darwin got monetized using a Realme C11.
- Can I start while studying? Yes, Darwin started as a student and is now in his 3rd year.
- iOS or Android? Both work fine.
- How to get monetized? Pick the right niche, create quality content, and stay consistent.
- YouTube automation? Yes, but main focus is Facebook automation.
- Not 18 yet? Create a new Facebook account with age set to 18+, then create a page using that account.
- Best time to post? Morning (6:00-9:00 AM) or evening (7:00-10:00 PM). Stay consistent and test what works best.
- 1-on-1 coaching? All information about FB automation is already inside Darwin's course, so you don't really need 1-on-1 coaching. But if you really need it, you must first become a student, and there will be an additional P500 fee for 1-on-1 coaching. If you're already enrolled in the old version of the course, only a P199 fee is required.`;

// Constants
const HUMAN_TAKEOVER_TIMEOUT = 30 * 60 * 1000; // 30 minutes
const CONVERSATION_TIMEOUT = 24 * 60 * 60 * 1000; // 24 hours for full conversation history
const AI_ENABLED = true; // Set to true to enable AI responses

/**
 * Check if user confirms they want to buy
 */
function isPurchaseConfirmation(text: string): boolean {
  const normalizedText = text.toLowerCase().trim();
  const confirmationPhrases = [
    'yes i want to buy',
    'i want to buy',
    'i want to purchase',
    'yes i want to purchase',
    'i\'ll buy it',
    'ill buy it',
    'i will buy it',
    'yes i\'ll buy',
    'yes ill buy',
    'i\'d like to buy',
    'id like to buy',
    'i would like to buy',
    'gusto ko bumili',
    'bibilhin ko',
    'yes please',
    'yes, i want to buy',
    'yes, i\'ll buy',
    'oo bibili ako',
    'oo gusto ko',
    'avail',
    'i want to avail',
    'avail ako',
    'pabili',
    'buy na',
    'yes buy',
  ];

  return confirmationPhrases.some(phrase => normalizedText.includes(phrase)) ||
         (normalizedText === 'yes' || normalizedText === 'oo' || normalizedText === 'sure' || normalizedText === 'okay' || normalizedText === 'ok');
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
    }

    // Save context
    conversations.set(senderId, context);

  } catch (error) {
    console.error('Error handling message:', error);
    // Don't send error messages to users - just log the error
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
 * Handle text message - generate AI response and check for purchase confirmation
 */
async function handleTextMessage(senderId: string, context: ConversationContext): Promise<void> {
  // Get the last user message
  const lastUserMessage = context.messages[context.messages.length - 1];

  // Check if user confirmed they want to buy
  if (lastUserMessage && isPurchaseConfirmation(lastUserMessage.content)) {
    // Get user profile to get username
    const userProfile = await getUserProfile(senderId);
    const username = userProfile.username || senderId;

    // Send Telegram notification
    if (config.telegram.enabled) {
      try {
        await sendBuyerNotification(username);
        console.log(`Telegram buyer notification sent for @${username}`);
      } catch (error) {
        console.error('Failed to send Telegram buyer notification:', error);
      }
    }

    // Send confirmation to user
    const confirmationResponse = `Great! Darwin will message you shortly to help you with your purchase. Please make sure you're following him so he can send you a message!`;

    const messageId = await sendMessage(senderId, confirmationResponse);

    addMessageToContext(context, {
      role: 'assistant',
      content: confirmationResponse,
      timestamp: Date.now(),
      messageId: messageId || undefined,
      sentByAI: true,
    });

    console.log(`Purchase confirmation received from ${senderId} (@${username})`);
    return;
  }

  // Get full conversation history for AI
  const conversationHistory = formatConversationForAI(context);

  // Generate AI response with full context
  const aiResponse = await generateChatResponse(conversationHistory, SYSTEM_PROMPT, KNOWLEDGE_BASE);

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
