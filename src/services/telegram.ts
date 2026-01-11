import axios from 'axios';
import { config } from '../config';
import { TelegramNotification } from '../types';

const telegramApiUrl = `https://api.telegram.org/bot${config.telegram.botToken}`;

export async function sendPaymentNotification(notification: TelegramNotification): Promise<void> {
  const { instagramName, instagramUsername, messageLink, paymentImageUrl, paymentDetails } = notification;

  // Build the notification message
  let message = `💰 *NEW PAYMENT RECEIVED*\n\n`;
  message += `👤 *Name:* ${escapeMarkdown(instagramName)}\n`;

  if (instagramUsername) {
    message += `📱 *Username:* @${escapeMarkdown(instagramUsername)}\n`;
  }

  if (messageLink) {
    message += `🔗 *Message Link:* [Open DM](${messageLink})\n`;
  }

  message += `\n💵 *Payment Details:*\n`;

  if (paymentDetails.amount) {
    message += `   Amount: ${escapeMarkdown(paymentDetails.amount)}\n`;
  }

  if (paymentDetails.senderName) {
    message += `   Sender: ${escapeMarkdown(paymentDetails.senderName)}\n`;
  }

  if (paymentDetails.referenceNumber) {
    message += `   Ref: ${escapeMarkdown(paymentDetails.referenceNumber)}\n`;
  }

  try {
    // Send the payment image with caption
    await axios.post(`${telegramApiUrl}/sendPhoto`, {
      chat_id: config.telegram.chatId,
      photo: paymentImageUrl,
      caption: message,
      parse_mode: 'Markdown',
    });

    console.log('Telegram payment notification sent successfully');
  } catch (error: any) {
    // If sending photo fails, try sending just the message
    console.error('Error sending photo to Telegram:', error.response?.data || error.message);

    try {
      message += `\n📷 *Payment Image:* ${paymentImageUrl}`;
      await axios.post(`${telegramApiUrl}/sendMessage`, {
        chat_id: config.telegram.chatId,
        text: message,
        parse_mode: 'Markdown',
        disable_web_page_preview: false,
      });
      console.log('Telegram text notification sent (fallback)');
    } catch (fallbackError) {
      console.error('Error sending Telegram notification:', fallbackError);
      throw fallbackError;
    }
  }
}

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
