import axios from 'axios';
import crypto from 'crypto';
import { config } from '../config';
import { InstagramUser } from '../types';

// Use Instagram Graph API directly
const graphApiUrl = 'https://graph.instagram.com/v21.0';

const instagramClient = axios.create({
  baseURL: graphApiUrl,
  params: {
    access_token: config.instagram.accessToken,
  },
});

// Track message IDs sent by our AI bot
const aiSentMessageIds: Set<string> = new Set();

// Clean up old message IDs periodically (keep last 1000)
function cleanupMessageIds(): void {
  if (aiSentMessageIds.size > 1000) {
    const idsArray = Array.from(aiSentMessageIds);
    const toDelete = idsArray.slice(0, idsArray.length - 1000);
    toDelete.forEach(id => aiSentMessageIds.delete(id));
  }
}

// Split text into chunks that fit Instagram's character limit
function splitMessage(text: string, maxLength: number = 1900): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Find a good break point (sentence end, or space)
    let breakPoint = remaining.lastIndexOf('. ', maxLength);
    if (breakPoint === -1 || breakPoint < maxLength / 2) {
      breakPoint = remaining.lastIndexOf(' ', maxLength);
    }
    if (breakPoint === -1 || breakPoint < maxLength / 2) {
      breakPoint = maxLength;
    }

    chunks.push(remaining.substring(0, breakPoint + 1).trim());
    remaining = remaining.substring(breakPoint + 1).trim();
  }

  return chunks;
}

export async function sendMessage(recipientId: string, text: string): Promise<string | null> {
  try {
    // Split message if it exceeds Instagram's 2000 character limit
    const chunks = splitMessage(text, 1900);
    let lastMessageId: string | null = null;

    for (const chunk of chunks) {
      const response = await instagramClient.post('/me/messages', {
        recipient: { id: recipientId },
        message: { text: chunk },
        messaging_type: 'RESPONSE',
      });

      const messageId = response.data?.message_id;
      if (messageId) {
        aiSentMessageIds.add(messageId);
        cleanupMessageIds();
        lastMessageId = messageId;
      }

      console.log(`Message sent to ${recipientId}, message_id: ${messageId}`);

      // Small delay between messages if sending multiple
      if (chunks.length > 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    return lastMessageId;
  } catch (error) {
    console.error('Error sending Instagram message:', error);
    throw error;
  }
}

// Check if a message was sent by our AI bot
export function isMessageSentByAI(messageId: string): boolean {
  return aiSentMessageIds.has(messageId);
}

// Mark a message as sent by AI (for tracking echoes)
export function markMessageAsSentByAI(messageId: string): void {
  aiSentMessageIds.add(messageId);
  cleanupMessageIds();
}

export async function sendTypingIndicator(recipientId: string, action: 'typing_on' | 'typing_off'): Promise<void> {
  try {
    await instagramClient.post('/me/messages', {
      recipient: { id: recipientId },
      sender_action: action,
    });
  } catch (error) {
    console.error('Error sending typing indicator:', error);
  }
}

export async function getUserProfile(userId: string): Promise<InstagramUser> {
  try {
    const response = await instagramClient.get(`/${userId}`, {
      params: {
        fields: 'name,username',
        access_token: config.instagram.accessToken,
      },
    });
    return {
      id: userId,
      name: response.data.name,
      username: response.data.username,
    };
  } catch (error) {
    console.error('Error fetching user profile:', error);
    return { id: userId };
  }
}

export function verifyWebhookSignature(payload: string, signature: string): boolean {
  const expectedSignature = crypto
    .createHmac('sha256', config.instagram.appSecret)
    .update(payload)
    .digest('hex');

  return signature === `sha256=${expectedSignature}`;
}

