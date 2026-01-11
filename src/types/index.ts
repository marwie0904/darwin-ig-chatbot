export interface InstagramMessage {
  id: string;
  senderId: string;
  text?: string;
  attachments?: InstagramAttachment[];
  timestamp: number;
}

export interface InstagramAttachment {
  type: 'image' | 'video' | 'audio' | 'file';
  payload: {
    url: string;
  };
}

export interface InstagramUser {
  id: string;
  name?: string;
  username?: string;
}

export interface WebhookEntry {
  id: string;
  time: number;
  messaging: WebhookMessaging[];
}

export interface WebhookMessaging {
  sender: { id: string };
  recipient: { id: string };
  timestamp: number;
  message?: {
    mid: string;
    text?: string;
    attachments?: InstagramAttachment[];
    is_echo?: boolean; // True if this is a message sent by the page
    app_id?: number; // App ID if sent via API
  };
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  messageId?: string;
  sentByAI?: boolean; // true if sent by our bot, false if sent by human
}

export interface ConversationContext {
  senderId: string;
  messages: ConversationMessage[];
  lastUpdated: number;
  // Human takeover tracking
  humanTookOver: boolean;
  humanTakeoverTime?: number; // When human sent a message
  lastUserMessageTime?: number; // Last time user messaged us
}

// Set of message IDs sent by our AI bot
export interface AIMessageTracker {
  sentMessageIds: Set<string>;
}
