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
	provider: 'Groq' | 'OpenAI-Compatible';
}

const TEXT_BLOCKLIST = [
	'whisper',
	'tts',
	'speech',
	'transcribe',
	'moderation',
	'embedding',
	'compound'
];
const GROQ_RESEARCH_MODELS: GroqModelInfo[] = [
	{
		id: 'llama-3.3-70b-versatile',
		family: 'llama-3.3-70b',
		contextWindow: 131072,
		provider: 'Groq'
	},
	{
		id: 'llama-3.1-8b-instant',
		family: 'llama-3.1-8b',
		contextWindow: 131072,
		provider: 'Groq'
	},
	{
		id: 'meta-llama/llama-4-scout-17b-16e-instruct',
		family: 'llama-4-scout-17b',
		contextWindow: 131072,
		provider: 'Groq'
	},
	{
		id: 'qwen/qwen3-32b',
		family: 'qwen3-32b',
		contextWindow: 131072,
		provider: 'Groq'
	},
	{
		id: 'openai/gpt-oss-120b',
		family: 'gpt-oss-120b',
		contextWindow: 131072,
		provider: 'Groq'
	}
];

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
		return GROQ_RESEARCH_MODELS;
	}

	const response = await fetch(GROQ_MODELS_URL, {
		headers: { Authorization: `Bearer ${apiKey}` }
	});

	if (!response.ok) {
		return GROQ_RESEARCH_MODELS;
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
		return GROQ_RESEARCH_MODELS;
	}

	const families = new Map<string, Array<{ id: string; context_window?: number }>>();
	for (const model of rawModels) {
		const family = normalizeFamily(model.id);
		const existing = families.get(family) ?? [];
		existing.push(model);
		families.set(family, existing);
	}

	const discovered = Array.from(families.entries())
		.map(([family, familyModels]) => {
			const selected = chooseRepresentative(familyModels);
			return {
				id: selected.id,
				family,
				contextWindow: selected.context_window ?? 0,
				provider: 'Groq' as const
			};
		})
		.sort((a, b) => b.contextWindow - a.contextWindow || a.family.localeCompare(b.family));

	const byId = new Map<string, GroqModelInfo>(discovered.map((model) => [model.id, model]));
	for (const model of GROQ_RESEARCH_MODELS) {
		byId.set(model.id, {
			...model,
			contextWindow: byId.get(model.id)?.contextWindow || model.contextWindow
		});
	}
	return Array.from(byId.values()).sort(
		(a, b) => b.contextWindow - a.contextWindow || a.family.localeCompare(b.family)
	);
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

async function groqCompatibleJson<T>(
	messages: GroqMessage[],
	temperature = 0.2,
	model = GROQ_MODEL,
	options: GroqJsonOptions = {}
): Promise<T> {
	const apiKey = env.GROQ_API_KEY;
	if (!apiKey) {
		throw new Error('Groq API key is not configured.');
	}

	let attempts = 0;
	let baseDelay = 2000;
	const maxAttempts = 4; // Limited to 3-5 retries

	while (true) {
		attempts++;
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
				...(options.maxCompletionTokens ? { max_tokens: options.maxCompletionTokens } : {}),
				messages
			})
		});

		if (!response.ok) {
			const message = await response.text();

			if (response.status === 429) {
				if (attempts >= maxAttempts) {
					throw new Error(
						`Groq request failed after ${attempts} attempts: ${response.status} ${message}`
					);
				}

				let retryDelay = baseDelay;
				const retryAfter = response.headers.get('retry-after');

				if (retryAfter) {
					const parsed = parseFloat(retryAfter);
					if (!isNaN(parsed)) retryDelay = parsed * 1000;
				} else {
					const match = message.match(/try again in ([\d.]+)s/);
					if (match) {
						retryDelay = parseFloat(match[1]) * 1000;
					}
				}

				// Add a 1s buffer to ensure we clear the limit window
				retryDelay += 1000;
				
				if (retryDelay > 60000) {
					throw new Error(
						`Groq rate limit retry time (${Math.round(retryDelay / 1000)}s) exceeds maximum allowed wait (60s).`
					);
				}

				console.warn(
					`[Groq] Rate limited. Retrying in ${retryDelay}ms... (Attempt ${attempts}/${maxAttempts})`
				);
				await new Promise((resolve) => setTimeout(resolve, retryDelay));
				baseDelay *= 1.5;
				continue;
			}

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
}

export async function groqJson<T>(
	messages: GroqMessage[],
	temperature = 0.2,
	model = GROQ_MODEL,
	options: GroqJsonOptions = {}
): Promise<T> {
	return groqCompatibleJson(messages, temperature, model, options);
}
