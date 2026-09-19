// Groq AI, seedha browser se. Key user Settings me dalta hai (browser me hi rehti hai).
// Browser ne block kiya ya key khaali → smart fallback metadata (upload kabhi nahi rukta).
export interface Metadata {
  title: string;
  description: string;
  hashtags: string[];
  tags: string[];
}

const ANGLES = [
  'luxury supercars (Lamborghini, Rolls-Royce, Bugatti, Ferrari)',
  'private jets & superyachts',
  'billionaire mansions, penthouses & villas',
  'luxury watches (Rolex, Patek Philippe, Audemars Piguet)',
  'money mindset & billionaire success motivation',
  'premium phones & gadgets (iPhone Pro, gold editions, luxury tech)',
  'first-class travel, 5-star hotels & exotic destinations',
  'designer fashion, sneakers & luxury shopping',
  'expensive places: Dubai, Monaco, Maldives, Switzerland',
  'gold, cash stacks & ultra-rich lifestyle',
];

const SYSTEM = `You are the metadata writer for a luxury-lifestyle YouTube Shorts channel (supercars, money, mansions, private jets, premium watches, luxury phones, first-class travel, designer life).

The actual video file is NOT available to you — filenames are just numbers (1.mp4, 2.mp4...), so INVENT a fresh, exciting luxury topic for every video. Never mention the filename or that you cannot see the video.

Rules:
- title: max 100 chars, energetic, honest curiosity (no fake first-person claims like "I bought"), end with #shorts
- description: 2-4 exciting sentences + like/subscribe call-to-action + hashtags line
- hashtags: 4-8 items, always include #shorts and #luxury
- tags: 6-12 YouTube keywords

Return ONLY valid JSON, exactly: {"title": "...", "description": "...", "hashtags": [...], "tags": [...]}`;

function fallback(niche: string, defaultHashtags: string[], num: string): Metadata {
  const angle = ANGLES[Math.floor(Math.random() * ANGLES.length)];
  const label = `${niche} #${num}`;
  return {
    title: `${label} #shorts`.slice(0, 100),
    description: `Watch "${label}" — ${angle}. Like, share and subscribe for daily luxury shorts!\n\n${defaultHashtags.join(' ')}`,
    hashtags: [...new Set([...defaultHashtags, '#shorts', '#luxury'])].slice(0, 6),
    tags: [niche.toLowerCase(), 'shorts', 'luxury', 'viral', angle.split(' ')[1] || 'lifestyle'].slice(0, 8),
  };
}

export async function generateMetadata(opts: {
  groqKey: string;
  model: string;
  niche: string;
  defaultHashtags: string[];
  fileNum: string;
}): Promise<Metadata> {
  const { groqKey, model, niche, defaultHashtags, fileNum } = opts;
  if (!groqKey) return fallback(niche, defaultHashtags, fileNum);
  try {
    const angle = ANGLES[Math.floor(Math.random() * ANGLES.length)];
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM },
          {
            role: 'user',
            content: `Channel niche: ${niche}\nThis video's angle: ${angle}\nUniqueness seed: ${Date.now()}-${Math.floor(Math.random() * 1e9)} — invent a NEW idea, different every time.`,
          },
        ],
        temperature: 1,
        max_tokens: 600,
        response_format: { type: 'json_object' },
      }),
    });
    if (!res.ok) throw new Error('Groq: ' + res.status);
    const j = await res.json();
    const text: string = j.choices?.[0]?.message?.content || '';
    let p: any;
    try {
      p = JSON.parse(text);
    } catch {
      p = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    }
    if (!p.title || !p.description) throw new Error('bad AI json');
    return {
      title: String(p.title).slice(0, 100),
      description: String(p.description),
      hashtags: (Array.isArray(p.hashtags) ? p.hashtags.map(String) : defaultHashtags).slice(0, 10),
      tags: (Array.isArray(p.tags) ? p.tags.map(String) : [niche]).slice(0, 15),
    };
  } catch (e) {
    console.error('[ai] fallback:', (e as Error).message);
    return fallback(niche, defaultHashtags, fileNum);
  }
}
