import axios from 'axios';
import { config } from '../config';

const telegramApiUrl = `https://api.telegram.org/bot${config.telegram.botToken}`;

export async function sendTestMessage(text: string): Promise<void> {
  try {
    await axios.post(`${telegramApiUrl}/sendMessage`, {
      chat_id: config.telegram.chatId,
      text,
      parse_mode: 'Markdown',
    });
  } catch (error) {
    console.error('Error sending Telegram test message:', error);
    throw error;
  }
}

export async function sendBuyerNotification(username: string): Promise<void> {
  const message = `🛒 *New Interested Buyer*

IG username: @${escapeMarkdown(username)}

wants to buy the course\\.

please message now:
https://www\\.instagram\\.com/${escapeMarkdown(username)}`;

  try {
    await axios.post(`${telegramApiUrl}/sendMessage`, {
      chat_id: config.telegram.chatId,
      text: message,
      parse_mode: 'MarkdownV2',
    });
    console.log(`Telegram buyer notification sent for @${username}`);
  } catch (error) {
    console.error('Error sending Telegram buyer notification:', error);
    throw error;
  }
}

function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
}
