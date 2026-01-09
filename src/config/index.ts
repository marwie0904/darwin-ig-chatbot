import dotenv from 'dotenv';
dotenv.config();

export const config = {
  openRouter: {
    apiKey: process.env.OPENROUTER_API_KEY || '',
    chatModel: 'openai/gpt-oss-120b',
    visionModel: 'google/gemini-2.0-flash-lite-001',
    baseUrl: 'https://openrouter.ai/api/v1',
  },
  instagram: {
    accessToken: process.env.INSTAGRAM_ACCESS_TOKEN || '',
    appSecret: process.env.INSTAGRAM_APP_SECRET || '',
    verifyToken: process.env.INSTAGRAM_VERIFY_TOKEN || '',
    appId: process.env.INSTAGRAM_APP_ID || '',
  },
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    chatId: process.env.TELEGRAM_CHAT_ID || '',
    enabled: false, // Temporarily disabled
  },
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    webhookUrl: process.env.WEBHOOK_URL || '',
  },
};
