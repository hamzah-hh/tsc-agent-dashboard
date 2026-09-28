import { GoogleGenAI, Type } from '@google/genai';
import { AgentRecord, AppConfig, Cycle, Suggestion } from './src/shared/types';
import { buildAgentSuggestions } from './src/shared/suggestions';
import { calculateRemainingWorkingDays } from './src/shared/planning';

const apiKey = process.env.GEMINI_API_KEY || '';
const genAI = apiKey ? new GoogleGenAI({ apiKey }) : null;

export const GEMINI_MODEL = 'gemini-2.5-flash';

/**
 * Extract numbers from text according to specifications:
 * Remove commas, the rupee sign, and Rs prefix; keep decimals and %.
 */
export function extractNumbers(text: string): string[] {
  if (!text) return [];
  const cleaned = text
    .replace(/,/g, '')
    .replace(/[₹]/g, '')
    .replace(/\bRs\.?\s*/gi, '')
    .replace(/\s+%/g, '%');

  const matches = cleaned.match(/\d+(?:\.\d+)?%?/g);
  if (!matches) return [];
  return matches.map((m) => m.trim());
}

/**
 * Compares two lists of extracted numbers (multiset comparison: frequencies and values match)
 */
export function areNumberSetsEqual(arr1: string[], arr2: string[]): boolean {
  if (arr1.length !== arr2.length) return false;
  const s1 = [...arr1].sort();
  const s2 = [...arr2].sort();
  return s1.every((val, idx) => val === s2[idx]);
}

/**
 * Counts words in a string
 */
export function countWords(text: string): number {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export interface AiTestReportItem {
  id: string;
  defaultText: string;
  geminiText: string;
  status: 'passed' | 'dropped';
  reason?: string;
}

export interface GenerateAiResult {
  success: boolean;
  aiSuggestions?: {
    lastDataDate: string;
    generatedAt: string;
    model: string;
    headline?: string;
    items?: Array<{ id: string; text: string }>;
  };
  report: AiTestReportItem[];
  error?: string;
}

const SYSTEM_INSTRUCTION =
  'You write short, upbeat coaching messages for call sales agents of a mattress company during the Diwali sales season. For each item, rewrite defaultText in a fun, energetic, motivating way. Rules: 1) Keep every number exactly as it appears in defaultText, with the same digits, the rupee sign, and the Indian comma format. 2) Do not add any other number. 3) Max 25 words for each item. 4) Max 1 emoji for each item. 5) Never shame or pressure; no words like failure, poor, or bad. 6) Tone: if tone is english, use simple friendly English; if tone is hinglish, use casual Hindi-English mix in Latin script. 7) You can use Diwali, festival lights, rangoli, or cricket ideas. 8) Do not use a person\'s name. 9) For the headline item, write a headline of max 12 words and return it in the headline field. Return only JSON.';

/**
 * Call Gemini Flash with 10 second timeout and 1 retry
 */
async function callGeminiWithTimeoutAndRetry(payloadString: string): Promise<any> {
  if (!genAI) {
    throw new Error('GEMINI_API_KEY is not configured on server.');
  }

  const callOnce = async (): Promise<any> => {
    let timeoutId: any;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error('Gemini API call timed out after 10000ms'));
      }, 10000);
    });

    try {
      const responsePromise = genAI.models.generateContent({
        model: GEMINI_MODEL,
        contents: payloadString,
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          temperature: 0.9,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              headline: { type: Type.STRING },
              items: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    text: { type: Type.STRING },
                  },
                  required: ['id', 'text'],
                },
              },
            },
            required: ['headline', 'items'],
          },
        },
      });

      const res = await Promise.race([responsePromise, timeoutPromise]);
      return res;
    } finally {
      clearTimeout(timeoutId);
    }
  };

  try {
    return await callOnce();
  } catch (err: any) {
    // 1 retry allowed (with brief 1s backoff in case of rate limit or overload)
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return await callOnce();
  }
}

/**
 * Generates and validates AI text for an agent record
 */
export async function generateAiText(
  agentRecord: AgentRecord,
  cycle: Cycle,
  appConfig: AppConfig
): Promise<GenerateAiResult> {
  // The rule engine picks the right rules (HO, Store or Pre Sales) from the agent's type
  const suggestions = buildAgentSuggestions(agentRecord, cycle);
  if (!suggestions || suggestions.length === 0) {
    return {
      success: false,
      report: [],
      error: 'No suggestions generated for this agent.',
    };
  }

  const remainingWorkingDays = calculateRemainingWorkingDays(
    agentRecord.lastDataDate,
    cycle.startDate,
    cycle.endDate,
    cycle.workingDaysPerWeek
  );

  // Anonymized input payload (NO personal data, names, emails, location, or TL)
  const inputPayload = {
    tone: appConfig.aiTone || 'english',
    agentType: agentRecord.agentType,
    // Revenue class and achievement only exist for HO / Store agents
    ...(agentRecord.agentType === 'PRE_SALES'
      ? {}
      : {
          className: agentRecord.result?.className || 'NQ',
          achievementPct: agentRecord.result?.achievementPct || 0,
        }),
    daysLeft: remainingWorkingDays,
    items: suggestions.map((s) => ({
      id: s.id,
      type: s.type,
      numbers: s.numbers,
      gainRupees: s.gainRupees,
      defaultText: s.defaultText,
    })),
  };

  const payloadString = JSON.stringify(inputPayload);

  let rawResponse;
  try {
    rawResponse = await callGeminiWithTimeoutAndRetry(payloadString);
  } catch (err: any) {
    return {
      success: false,
      report: [],
      error: err?.message || 'Gemini call failed',
    };
  }

  let parsed: { headline?: string; items?: Array<{ id: string; text: string }> };
  try {
    parsed = JSON.parse(rawResponse.text || '{}');
  } catch (err: any) {
    return {
      success: false,
      report: [],
      error: 'Failed to parse Gemini JSON output',
    };
  }

  const report: AiTestReportItem[] = [];
  const validItems: Array<{ id: string; text: string }> = [];
  const suggestionMap = new Map<string, Suggestion>();
  suggestions.forEach((s) => suggestionMap.set(s.id, s));

  // 1. Check Headline
  let validHeadline: string | undefined = undefined;
  const headlineSuggestion = suggestions.find((s) => s.type === 'headline');
  const headlineText = parsed.headline || '';

  if (headlineSuggestion) {
    const defaultNumbers = extractNumbers(headlineSuggestion.defaultText);
    const geminiNumbers = extractNumbers(headlineText);
    const wCount = countWords(headlineText);

    if (!headlineText.trim()) {
      report.push({
        id: 'headline',
        defaultText: headlineSuggestion.defaultText,
        geminiText: '',
        status: 'dropped',
        reason: 'Empty headline returned by model',
      });
    } else if (wCount > 12) {
      report.push({
        id: 'headline',
        defaultText: headlineSuggestion.defaultText,
        geminiText: headlineText,
        status: 'dropped',
        reason: `Word count exceeded (${wCount} > 12 words)`,
      });
    } else if (!areNumberSetsEqual(defaultNumbers, geminiNumbers)) {
      report.push({
        id: 'headline',
        defaultText: headlineSuggestion.defaultText,
        geminiText: headlineText,
        status: 'dropped',
        reason: `Numbers mismatch. Expected [${defaultNumbers.join(', ')}], got [${geminiNumbers.join(', ')}]`,
      });
    } else {
      validHeadline = headlineText;
      report.push({
        id: 'headline',
        defaultText: headlineSuggestion.defaultText,
        geminiText: headlineText,
        status: 'passed',
      });
    }
  }

  // 2. Check each returned item
  const returnedItems = parsed.items || [];
  for (const item of returnedItems) {
    if (item.id === 'headline') continue; // Handled separately

    const s = suggestionMap.get(item.id);
    if (!s) {
      report.push({
        id: item.id,
        defaultText: '—',
        geminiText: item.text,
        status: 'dropped',
        reason: 'Unknown item id',
      });
      continue;
    }

    const defaultNumbers = extractNumbers(s.defaultText);
    const geminiNumbers = extractNumbers(item.text);
    const wCount = countWords(item.text);

    if (wCount > 25) {
      report.push({
        id: item.id,
        defaultText: s.defaultText,
        geminiText: item.text,
        status: 'dropped',
        reason: `Word count exceeded (${wCount} > 25 words)`,
      });
    } else if (!areNumberSetsEqual(defaultNumbers, geminiNumbers)) {
      report.push({
        id: item.id,
        defaultText: s.defaultText,
        geminiText: item.text,
        status: 'dropped',
        reason: `Numbers mismatch. Expected [${defaultNumbers.join(', ')}], got [${geminiNumbers.join(', ')}]`,
      });
    } else {
      validItems.push({ id: item.id, text: item.text });
      report.push({
        id: item.id,
        defaultText: s.defaultText,
        geminiText: item.text,
        status: 'passed',
      });
    }
  }

  // Include missing suggestions in report as dropped
  for (const s of suggestions) {
    if (s.id === 'headline') continue;
    if (!returnedItems.some((it) => it.id === s.id)) {
      report.push({
        id: s.id,
        defaultText: s.defaultText,
        geminiText: '—',
        status: 'dropped',
        reason: 'Item was not generated by model',
      });
    }
  }

  return {
    success: true,
    aiSuggestions: {
      lastDataDate: agentRecord.lastDataDate,
      generatedAt: new Date().toISOString(),
      model: GEMINI_MODEL,
      ...(validHeadline ? { headline: validHeadline } : {}),
      items: validItems,
    },
    report,
  };
}

/**
 * Concurrency runner for processing multiple agents with max 3 parallel calls
 */
export async function runBatchAiGeneration(
  agents: AgentRecord[],
  cycle: Cycle,
  appConfig: AppConfig,
  onProgress?: (completed: number, total: number) => void
): Promise<{ okCount: number; failedCount: number; updatedAgents: AgentRecord[] }> {
  let okCount = 0;
  let failedCount = 0;
  const updatedAgents: AgentRecord[] = [...agents];

  let currentIndex = 0;
  let completed = 0;

  async function worker() {
    while (currentIndex < updatedAgents.length) {
      const idx = currentIndex++;
      const agent = updatedAgents[idx];

      try {
        const result = await generateAiText(agent, cycle, appConfig);
        if (result.success && result.aiSuggestions) {
          agent.aiSuggestions = result.aiSuggestions;
          okCount++;
        } else {
          failedCount++;
        }
      } catch (_e) {
        failedCount++;
      } finally {
        completed++;
        if (onProgress) onProgress(completed, updatedAgents.length);
      }
    }
  }

  // Max 3 calls at the same time
  const concurrency = Math.min(3, agents.length);
  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  return { okCount, failedCount, updatedAgents };
}
