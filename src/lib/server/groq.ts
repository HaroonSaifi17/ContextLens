import { env } from '$env/dynamic/private';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODELS_URL = 'https://api.groq.com/openai/v1/models';
export const GROQ_MODEL = 'llama-3.1-8b-instant';

type GroqMessage = { role: 'system' | 'user'; content: string };

interface GroqJsonOptions {
	model?: string;
	maxCompletionTokens?: number;
}

export interface GroqModelInfo {
	id: string;
	family: string;
	contextWindow: number;
}

const TEXT_BLOCKLIST = ['whisper', 'tts', 'speech', 'transcribe', 'moderation', 'embedding'];

function normalizeFamily(id: string) {
	const normalized = id.toLowerCase();
	const primary = normalized.split('/').pop() ?? normalized;
	const withoutSuffix = primary
		.replace(/[-_](instant|versatile|preview|latest|thinking|reasoning|instruct|it)$/g, '')
		.replace(/[-_](v|ver)?\d+(\.\d+)*$/g, '')
		.replace(/[-_]?\d+(\.\d+)?b/g, '');
	return withoutSuffix.replace(/[-_]+/g, '-').trim() || primary;
}

function chooseRepresentative(models: Array<{ id: string; context_window?: number }>) {
	const sorted = [...models].sort((a, b) => (b.context_window ?? 0) - (a.context_window ?? 0));
	return sorted[0];
}

export async function listGroqModels(): Promise<GroqModelInfo[]> {
	const apiKey = env.GROQ_API_KEY;
	if (!apiKey) {
		return [{ id: GROQ_MODEL, family: normalizeFamily(GROQ_MODEL), contextWindow: 0 }];
	}

	const response = await fetch(GROQ_MODELS_URL, {
		headers: { Authorization: `Bearer ${apiKey}` }
	});

	if (!response.ok) {
		return [{ id: GROQ_MODEL, family: normalizeFamily(GROQ_MODEL), contextWindow: 0 }];
	}

	const payload = (await response.json()) as {
		data?: Array<{ id: string; context_window?: number }>;
	};
	const rawModels = (payload.data ?? []).filter((model) => {
		const id = model.id.toLowerCase();
		if (TEXT_BLOCKLIST.some((keyword) => id.includes(keyword))) {
			return false;
		}
		return true;
	});

	if (rawModels.length === 0) {
		return [{ id: GROQ_MODEL, family: normalizeFamily(GROQ_MODEL), contextWindow: 0 }];
	}

	const families = new Map<string, Array<{ id: string; context_window?: number }>>();
	for (const model of rawModels) {
		const family = normalizeFamily(model.id);
		const existing = families.get(family) ?? [];
		existing.push(model);
		families.set(family, existing);
	}

	return Array.from(families.entries())
		.map(([family, familyModels]) => {
			const selected = chooseRepresentative(familyModels);
			return {
				id: selected.id,
				family,
				contextWindow: selected.context_window ?? 0
			};
		})
		.sort((a, b) => b.contextWindow - a.contextWindow || a.family.localeCompare(b.family));
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

export async function groqJson<T>(
	messages: GroqMessage[],
	temperature = 0.2,
	model = GROQ_MODEL,
	options: GroqJsonOptions = {}
): Promise<T> {
	const apiKey = env.GROQ_API_KEY;
	if (!apiKey) {
		throw new Error('GROQ_API_KEY is not configured.');
	}

	const response = await fetch(GROQ_API_URL, {
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
		throw new Error(`Groq request failed: ${response.status} ${message}`);
	}

	const payload = (await response.json()) as {
		choices?: Array<{ message?: { content?: string } }>;
	};
	const content = payload.choices?.[0]?.message?.content;
	if (!content) {
		throw new Error('Groq returned an empty response.');
	}

	const parsed = safeJsonParse<T>(content);
	if (!parsed) {
		throw new Error('Groq did not return valid JSON.');
	}

	return parsed;
}
