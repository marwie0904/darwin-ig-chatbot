import axios from 'axios';
import { config } from '../config';

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
  systemPrompt: string,
  knowledgeBase: string
): Promise<string> {
  try {
    const response = await openRouterClient.post('/chat/completions', {
      model: config.openRouter.chatModel,
      provider: {
        order: ['Fireworks'],
        quantizations: ['fp8'],
      },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `KNOWLEDGE BASE:\n${knowledgeBase}` },
        { role: 'assistant', content: 'I understand the knowledge base. I will use this information to answer questions accurately.' },
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

