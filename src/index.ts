import express, { Request, Response } from 'express';
import { config } from './config';
import { handleIncomingMessage } from './handlers/messageHandler';
import { verifyWebhookSignature } from './services/instagram';
import { sendTestMessage } from './services/telegram';
import { WebhookEntry } from './types';

const app = express();

// Parse JSON bodies
app.use(express.json({
  verify: (req: any, _res, buf) => {
    req.rawBody = buf.toString();
  },
}));

// Health check endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Webhook verification endpoint (GET) - required by Facebook
app.get('/webhook', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === config.instagram.verifyToken) {
    console.log('Webhook verified successfully');
    res.status(200).send(challenge);
  } else {
    console.error('Webhook verification failed');
    res.sendStatus(403);
  }
});

// Webhook endpoint (POST) - receives Instagram messages
app.post('/webhook', async (req: Request, res: Response) => {
  // TODO: Re-enable signature verification with correct Facebook App Secret
  // const signature = req.headers['x-hub-signature-256'] as string;
  // if (config.instagram.appSecret && signature) {
  //   const rawBody = (req as any).rawBody;
  //   if (!verifyWebhookSignature(rawBody, signature)) {
  //     console.error('Invalid webhook signature');
  //     return res.sendStatus(401);
  //   }
  // }

  const body = req.body;

  // Check if this is an Instagram webhook
  if (body.object === 'instagram' || body.object === 'page') {
    // Process each entry
    const entries: WebhookEntry[] = body.entry || [];

    for (const entry of entries) {
      const messaging = entry.messaging || [];

      for (const event of messaging) {
        // Handle message event asynchronously
        handleIncomingMessage(event).catch(err => {
          console.error('Error processing message:', err);
        });
      }
    }

    // Respond immediately to acknowledge receipt
    res.status(200).send('EVENT_RECEIVED');
  } else {
    res.sendStatus(404);
  }
});

// Test endpoint for Telegram notification
app.post('/test/telegram', async (_req: Request, res: Response) => {
  try {
    await sendTestMessage('🤖 Darwin IG Chatbot is connected and working!');
    res.json({ success: true, message: 'Test message sent to Telegram' });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to send Telegram message' });
  }
});

// Start server
app.listen(config.server.port, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║           Darwin IG Chatbot Server Started                ║
╠═══════════════════════════════════════════════════════════╣
║  Port: ${config.server.port.toString().padEnd(50)}║
║  Webhook URL: ${(config.server.webhookUrl || 'Not set').padEnd(43)}║
║  Chat Model: ${config.openRouter.chatModel.padEnd(44)}║
║  Vision Model: ${config.openRouter.visionModel.padEnd(42)}║
╚═══════════════════════════════════════════════════════════╝
  `);

  // Validate required config
  const missingConfig: string[] = [];
  if (!config.openRouter.apiKey) missingConfig.push('OPENROUTER_API_KEY');
  if (!config.instagram.accessToken) missingConfig.push('INSTAGRAM_ACCESS_TOKEN');
  if (!config.telegram.botToken) missingConfig.push('TELEGRAM_BOT_TOKEN');
  if (!config.telegram.chatId) missingConfig.push('TELEGRAM_CHAT_ID');

  if (missingConfig.length > 0) {
    console.warn('⚠️  Missing configuration:', missingConfig.join(', '));
    console.warn('   Please set these environment variables in .env file');
  }

  console.log(`
📝 Human Takeover Logic:
   - When you (human) send a message via Instagram, AI pauses for that user
   - AI resumes after: 30 min passed + user sends new message + no human reply

📌 Required Webhook Subscriptions:
   - messages
   - message_echoes (required for human takeover detection)
  `);
});

export default app;
