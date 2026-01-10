import axios from 'axios';
import { config } from '../config';
import { PaymentDetectionResult } from '../types';

const openRouterClient = axios.create({
  baseURL: config.openRouter.baseUrl,
  headers: {
    'Authorization': `Bearer ${config.openRouter.apiKey}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': config.server.webhookUrl,
    'X-Title': 'Darwin IG Chatbot',
  },
});

export async function generateChatResponse(
  conversationHistory: { role: 'user' | 'assistant'; content: string }[],
  systemPrompt: string
): Promise<string> {
  try {
    const response = await openRouterClient.post('/chat/completions', {
      model: config.openRouter.chatModel,
      messages: [
        { role: 'system', content: systemPrompt },
        ...conversationHistory,
      ],
      max_tokens: 300,
      temperature: 0.3,
    });

    return response.data.choices[0]?.message?.content || 'Sorry, I could not generate a response.';
  } catch (error) {
    console.error('OpenRouter chat error:', error);
    throw error;
  }
}

export async function analyzePaymentImage(imageUrl: string): Promise<PaymentDetectionResult> {
  const prompt = `Analyze this image and determine if it shows a GCash payment/transaction receipt.

If it IS a GCash transaction, extract:
1. The amount sent (e.g., "₱1,778.00")
2. The sender's partial name if visible (e.g., "M** W** A**")
3. The reference number if visible

Respond in this exact JSON format:
{
  "isPayment": true/false,
  "amount": "amount if found or null",
  "senderName": "partial name if found or null",
  "referenceNumber": "reference number if found or null"
}

Only respond with the JSON, no other text.`;

  try {
    const response = await openRouterClient.post('/chat/completions', {
      model: config.openRouter.visionModel,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: imageUrl } },
          ],
        },
      ],
      max_tokens: 500,
      temperature: 0.1,
    });

    const content = response.data.choices[0]?.message?.content || '{"isPayment": false}';

    // Parse the JSON response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        isPayment: parsed.isPayment === true,
        amount: parsed.amount || undefined,
        senderName: parsed.senderName || undefined,
        referenceNumber: parsed.referenceNumber || undefined,
        rawAnalysis: content,
      };
    }

    return { isPayment: false, rawAnalysis: content };
  } catch (error) {
    console.error('OpenRouter vision error:', error);
    return { isPayment: false };
  }
}
