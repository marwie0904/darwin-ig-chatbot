import axios from 'axios';
import crypto from 'crypto';
import { config } from '../config';
import { InstagramUser, InstagramAttachment } from '../types';

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

export async function sendMessage(recipientId: string, text: string): Promise<string | null> {
  try {
    // Instagram has a 2000 character limit - truncate if needed
    let truncatedText = text;
    if (text.length > 1900) {
      truncatedText = text.substring(0, 1900) + '...';
    }

    const response = await instagramClient.post('/me/messages', {
      recipient: { id: recipientId },
      message: { text: truncatedText },
      messaging_type: 'RESPONSE',
    });

    const messageId = response.data?.message_id;
    if (messageId) {
      aiSentMessageIds.add(messageId);
      cleanupMessageIds();
    }

    console.log(`Message sent to ${recipientId}, message_id: ${messageId}`);
    return messageId || null;
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

export function generateMessageLink(userId: string): string {
  // Instagram DM links format
  return `https://www.instagram.com/direct/t/${userId}`;
}

export function extractImageUrls(attachments?: InstagramAttachment[]): string[] {
  if (!attachments) return [];
  return attachments
    .filter(att => att.type === 'image')
    .map(att => att.payload.url);
}
