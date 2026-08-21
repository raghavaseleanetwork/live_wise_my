import { getDb } from './db/mongodb';

// Categories allowed in the system
export type CategoryType = 'health' | 'bills' | 'family' | 'work' | 'tasks' | 'subscriptions' | 'finance' | 'habits' | 'travel' | 'events' | 'food' | 'shopping' | 'transport' | 'entertainment' | 'education' | 'investment' | 'other_expense' | 'others';

/**
 * Uses OpenAI gpt-4o-mini to categorize a batch of transactions.
 * Returns an array of category names in the same order as input.
 */
export async function categorizeTransactionsWithAI(
  items: { merchant: string; description: string }[],
  openAIKey: string
): Promise<CategoryType[]> {
  if (!items.length) return [];
  
  const prompt = `Categorize these Indian financial transactions: health, bills, family, work, tasks, subscriptions, finance, habits, travel, events, food, shopping, transport, entertainment, education, investment, other_expense, others.
  Input items: ${JSON.stringify(items.map(i => `${i.merchant}: ${i.description}`))}.
  Return ONLY a JSON array of strings in the EXACT same order as the input.
  Rules:
  - 'food' for Swiggy, Zomato, Restaurant, Cafe, Dining.
  - 'shopping' for Amazon, Flipkart, Myntra, Groceries, BigBasket, Zepto.
  - 'transport' for Uber, Ola, Rapido, Fuel, Petrol.
  - 'bills' for Utility, Electricity, Water, Gas, Rent.
  - 'other_expense' for person-to-person UPI transfers, money sent to an
    individual (not a business/merchant), self-transfers between the user's own
    accounts, lending or repaying money to a person.
  - 'others' only if absolutely unclear.`;

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openAIKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        response_format: { type: 'json_object' },
      }),
    });

    if (!res.ok) {
      console.error('AI categorization API error:', await res.text());
      return items.map(() => 'others');
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return items.map(() => 'others');
    
    const parsed = JSON.parse(content);
    // Handle different possible JSON structures from AI
    const results = Array.isArray(parsed) ? parsed : (parsed.categories || parsed.results || Object.values(parsed)[0]);
    
    if (Array.isArray(results)) {
      return results.map(c => String(c).toLowerCase() as CategoryType).slice(0, items.length);
    }
    return items.map(() => 'others');
  } catch (err) {
    console.error('AI categorization error:', err);
    return items.map(() => 'others');
  }
}

/**
 * Background task to re-categorize transactions marked as 'others'.
 */
export async function updateExistingOthers(userId: string, openAIKey: string): Promise<number> {
  const db = getDb();
  if (!db) return 0;

  const others = await db.collection('transactions').find({
    userId,
    category: 'others',
    categoryLockedByUser: { $ne: true },
  }).toArray();

  if (others.length === 0) return 0;

  const batchSize = 10;
  let updatedCount = 0;

  for (let i = 0; i < others.length; i += batchSize) {
    const batch = others.slice(i, i + batchSize);
    const categories = await categorizeTransactionsWithAI(
      batch.map(t => ({ merchant: t.merchant, description: t.description || '' })),
      openAIKey
    );

    for (let j = 0; j < batch.length; j++) {
      if (categories[j] && categories[j] !== 'others') {
        await db.collection('transactions').updateOne(
          { _id: batch[j]._id as any },
          { $set: { category: categories[j] } }
        );
        updatedCount++;
      }
    }
  }

  return updatedCount;
}
