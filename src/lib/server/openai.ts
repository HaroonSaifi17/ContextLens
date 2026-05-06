import { env } from '$env/dynamic/private';

const OPENAI_COMPAT_API_URL = 'https://api.openai.com/v1/chat/completions';
export const COPILOT_REFERENCE_MODEL = 'gpt-4o-mini';

type OpenAiMessage = { role: 'system' | 'user'; content: string };

interface OpenAiJsonOptions {
	model?: string;
	maxCompletionTokens?: number;
}

function safeJsonParse<T>(value: string): T | null {
	try {
		return JSON.parse(value) as T;
	} catch {
		const objectMatch = value.match(/\{[\s\S]*\}/);
		if (!objectMatch) {
			return null;
		}
		try {
			return JSON.parse(objectMatch[0]) as T;
		} catch {
			return null;
		}
	}
}

export function hasOpenAiCompatibleKey() {
	return Boolean(env.COPILOT_API_KEY || env.OPENAI_API_KEY);
}

export async function openAiJson<T>(
	messages: OpenAiMessage[],
	temperature = 0.2,
	model = COPILOT_REFERENCE_MODEL,
	options: OpenAiJsonOptions = {}
): Promise<T> {
	const apiKey = env.COPILOT_API_KEY || env.OPENAI_API_KEY;
	if (!apiKey) {
		throw new Error('OpenAI-compatible API key is not configured.');
	}

	const response = await fetch(env.COPILOT_API_URL || OPENAI_COMPAT_API_URL, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${apiKey}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			model: options.model ?? model,
			temperature,
			response_format: { type: 'json_object' },
			...(options.maxCompletionTokens
				? { max_completion_tokens: options.maxCompletionTokens }
				: {}),
			messages
		})
	});

	if (!response.ok) {
		const message = await response.text();
		throw new Error(`OpenAI-compatible request failed: ${response.status} ${message}`);
	}

	const payload = (await response.json()) as {
		choices?: Array<{ message?: { content?: string } }>;
	};
	const content = payload.choices?.[0]?.message?.content;
	if (!content) {
		throw new Error('OpenAI-compatible provider returned an empty response.');
	}

	const parsed = safeJsonParse<T>(content);
	if (!parsed) {
		throw new Error('OpenAI-compatible provider did not return valid JSON.');
	}

	return parsed;
}
