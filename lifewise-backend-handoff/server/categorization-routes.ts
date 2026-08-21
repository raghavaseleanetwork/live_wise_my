import { updateExistingOthers } from './categorization-utils';
import { Express } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'lifewise-secret-change-in-production';

function authMiddleware(req: any, res: any, next: any) {
  const auth = req.headers.authorization;
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ message: 'Not authenticated' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    req.userId = decoded.userId;
    next();
  } catch {
    return res.status(401).json({ message: 'Invalid token' });
  }
}

export function registerCategorizationRoutes(app: Express) {
  // AI-powered retroactive categorization for 'others'
  app.post('/api/transactions/categorize-others', authMiddleware as any, async (req, res) => {
    try {
      const userId = (req as any).userId;
      
      // Get OpenAI key from env (same logic as in routes.ts)
      const key = process.env.OPENAI_API_KEY || 
                  process.env.OPENAI_KEY || 
                  process.env.OPENAI_TOKEN || 
                  process.env.OPEN_AI_API_KEY;

      if (!key) {
        console.error('[AI] OpenAI key not found for categorization');
        return res.status(500).json({ message: 'AI categorization not configured' });
      }

      console.log(`[AI] Starting retroactive categorization for user: ${userId}`);
      const updatedCount = await updateExistingOthers(userId, key);
      console.log(`[AI] Completed. Updated ${updatedCount} transactions.`);

      return res.json({ 
        success: true, 
        updated: updatedCount,
        message: updatedCount > 0 ? `Successfully categorized ${updatedCount} items.` : 'No items required categorization.'
      });
    } catch (err) {
      console.error('[AI] Categorize others error:', err);
      return res.status(500).json({ message: 'Server error during AI categorization.' });
    }
  });
}
