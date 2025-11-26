// @ts-nocheck

import { tool } from 'ai';
import { z } from 'zod';
import { OpenAI } from 'openai';
import { Pinecone } from '@pinecone-database/pinecone';

// ---------- Clients ----------
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY as string,
});

const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY as string,
});

const index = pinecone.index(process.env.PINECONE_INDEX_NAME as string);

// ---------- Tool ----------
export const vectorDatabaseSearch = tool({
  description:
    'Search the Pinecone vendor database and return the most relevant wedding vendors based on the user query.',

  parameters: z.object({
    query: z.string(),
    topK: z.number().optional().default(5),
  }),

  execute: async ({ query, topK }) => {
    console.log('vectorDatabaseSearch called:', query);

    try {
      const k = topK ?? 5;

      const embeddingResponse = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: query,
      });

      const embedding = embeddingResponse.data[0].embedding;

      const pineconeResponse = await index.query({
        vector: embedding,
        topK: k,
        includeMetadata: true,
      });

      const vendors =
        pineconeResponse.matches?.map((match) => ({
          id: match.id,
          score: match.score,
          name: match.metadata?.name || '',
          location: match.metadata?.location || '',
          category: match.metadata?.category || '',
          price_range: match.metadata?.price_range || '',
          description: match.metadata?.description || '',
        })) ?? [];

      return { vendors };
    } catch (error) {
      console.error('Vector DB Search Error:', error);
      return { vendors: [] };
    }
  },
});
