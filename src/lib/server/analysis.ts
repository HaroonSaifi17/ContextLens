import { groqJson, listGroqModels } from '$lib/server/groq';
import type {
	Citation,
	GroundedSentence,
	HallucinationFlag,
	PipelineRun,
	PipelineType,
	PositionBin
} from '$lib/types';

interface ChunkRecord {
	order: number;
	text: string;
	tokens: string[];
}

interface LlmOutput {
	answer: string;
	confidence: number;
	sentences?: Array<{ text: string; grounded: boolean; score: number; reason: string }>;
	hallucinations?: Array<{ claim: string; reason: string }>;
	citations?: Array<{ chunkOrder: number; text: string }>;
}

export interface PreparedContext {
	text: string;
	chunks: ChunkRecord[];
	positionBins: PositionBin[];
	citations: Citation[];
	contextChars: number;
	contextChunks: number;
	coverage: number;
}

interface RunPipelineArgs {
	pipeline: PipelineType;
	query: string;
	context: PreparedContext;
	modelId: string;
	modelFamily: string;
	modelContextWindow?: number;
	noiseInjected: boolean;
}

const CHARS_PER_TOKEN = 4;
const PROMPT_RESERVE_TOKENS = 850;
const MAX_CONTEXT_CAP = 12000;

function clamp(value: number, min: number, max: number) {
	return Math.max(min, Math.min(max, value));
}

function tokenize(text: string) {
	return new Set((text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).slice(0, 200));
}

function scoreChunk(queryTokens: Set<string>, chunk: ChunkRecord) {
	let overlap = 0;
	for (const token of chunk.tokens) {
		if (queryTokens.has(token)) {
			overlap += 1;
		}
	}
	return overlap;
}

function normalizeClaims(items?: Array<{ claim: string; reason: string }>): HallucinationFlag[] {
	return (items ?? [])
		.map((item) => ({ claim: item.claim?.trim(), reason: item.reason?.trim() }))
		.filter((item) => Boolean(item.claim && item.reason))
		.slice(0, 12) as HallucinationFlag[];
}

function normalizeSentences(
	items?: Array<{ text: string; grounded: boolean; score: number; reason: string }>
): GroundedSentence[] {
	return (items ?? [])
		.map((item) => ({
			text: (item.text ?? '').trim(),
			grounded: Boolean(item.grounded),
			score: clamp(Number(item.score) || 0, 0, 100),
			reason: (item.reason ?? '').trim()
		}))
		.filter((item) => item.text.length > 0)
		.slice(0, 16);
}

function normalizeCitations(
	items: Array<{ chunkOrder: number; text: string }> | undefined
): Citation[] {
	return (items ?? [])
		.filter((item) => Number.isFinite(item.chunkOrder) && typeof item.text === 'string')
		.map((item) => ({ chunkOrder: item.chunkOrder, text: item.text.trim() }))
		.filter((item) => item.text.length > 0)
		.slice(0, 6);
}

function fallbackSentences(answer: string) {
	const candidates = answer
		.split(/(?<=[.!?])\s+/)
		.map((line) => line.trim())
		.filter(Boolean)
		.slice(0, 10);

	return candidates.map((text) => ({
		text,
		grounded: true,
		score: 60,
		reason: 'Auto-classified due to missing per-sentence output.'
	}));
}

function clampConfidence(value: number) {
	if (!Number.isFinite(value)) {
		return 50;
	}
	return clamp(Math.round(value), 0, 100);
}

function maxContextCharsForModel(modelContextWindow?: number) {
	if (!modelContextWindow || modelContextWindow <= 0) {
		return 5500;
	}
	const usableTokens = Math.max(1000, modelContextWindow - PROMPT_RESERVE_TOKENS);
	return Math.min(MAX_CONTEXT_CAP * CHARS_PER_TOKEN, usableTokens * CHARS_PER_TOKEN);
}

function modelPromptTokenCap(modelId: string) {
	const id = modelId.toLowerCase();
	if (id.includes('kimi-k2')) {
		return 1200;
	}
	if (id.includes('gpt-oss-120b')) {
		return 1700;
	}
	if (id.includes('gpt-oss-20b')) {
		return 2300;
	}
	if (id.includes('llama-3.3-70b') || id.includes('llama-4')) {
		return 2000;
	}
	return 3000;
}

function shortenContextText(context: PreparedContext, maxChars: number): PreparedContext {
	if (context.text.length <= maxChars) {
		return context;
	}

	if (context.chunks.length === 0) {
		const shortened = context.text.slice(0, maxChars);
		return {
			...context,
			text: shortened,
			contextChars: shortened.length,
			coverage:
				context.contextChars === 0
					? 0
					: clamp(Math.round((shortened.length / context.contextChars) * 100), 1, 100)
		};
	}

	let running = '';
	const selected: ChunkRecord[] = [];
	for (const chunk of context.chunks) {
		const next = running
			? `${running}\n\n[Chunk ${chunk.order}] ${chunk.text}`
			: `[Chunk ${chunk.order}] ${chunk.text}`;
		if (next.length > maxChars && selected.length > 0) {
			break;
		}
		selected.push(chunk);
		running = next.slice(0, maxChars);
		if (running.length >= maxChars) {
			break;
		}
	}

	const coverage =
		context.chunks.length === 0
			? 0
			: clamp(Math.round((selected.length / context.chunks.length) * 100), 1, 100);
	return {
		...context,
		text: running,
		chunks: selected,
		positionBins: buildPositionBins(selected),
		citations: mapDefaultCitations(selected),
		contextChars: running.length,
		contextChunks: selected.length,
		coverage
	};
}

function buildBinRange(total: number, bin: number, binCount: number) {
	const start = Math.floor((bin / binCount) * total);
	const end = Math.floor(((bin + 1) / binCount) * total);
	return `${Math.round((start / Math.max(total, 1)) * 100)}-${Math.round((end / Math.max(total, 1)) * 100)}%`;
}

function buildPositionBins(chunks: ChunkRecord[]) {
	const binCount = 8;
	const total = Math.max(chunks.length, 1);
	const bins: PositionBin[] = [];

	for (let index = 0; index < binCount; index += 1) {
		bins.push({
			bin: index,
			rangeLabel: buildBinRange(total, index, binCount),
			hits: 0
		});
	}

	for (const chunk of chunks) {
		const normalized = clamp(Math.floor((chunk.order / total) * binCount), 0, binCount - 1);
		bins[normalized].hits += 1;
	}

	return bins;
}

function mapDefaultCitations(chunks: ChunkRecord[]) {
	return chunks
		.slice(0, 4)
		.map((chunk) => ({ chunkOrder: chunk.order, text: chunk.text.slice(0, 260) }));
}

export function makeNoContext(query: string): PreparedContext {
	return {
		text: `Question only mode:\n${query}`,
		chunks: [],
		positionBins: buildPositionBins([]),
		citations: [],
		contextChars: 0,
		contextChunks: 0,
		coverage: 0
	};
}

export function makeFullContext(fullText: string, chunks: ChunkRecord[]): PreparedContext {
	return {
		text: fullText,
		chunks,
		positionBins: buildPositionBins(chunks),
		citations: mapDefaultCitations(chunks),
		contextChars: fullText.length,
		contextChunks: chunks.length,
		coverage: 100
	};
}

export function retrieveChunks(query: string, chunks: ChunkRecord[], limit = 6): ChunkRecord[] {
	const queryTokens = tokenize(query);
	if (queryTokens.size === 0) {
		return chunks.slice(0, limit);
	}

	return chunks
		.map((chunk) => ({ chunk, score: scoreChunk(queryTokens, chunk) }))
		.sort((a, b) => b.score - a.score || a.chunk.order - b.chunk.order)
		.filter((entry, index) => entry.score > 0 || index < limit)
		.slice(0, limit)
		.map((entry) => entry.chunk);
}

export function makeRagContext(
	query: string,
	allChunks: ChunkRecord[],
	limit = 6
): PreparedContext {
	const ragChunks = retrieveChunks(query, allChunks, limit);
	const ragText = ragChunks.map((chunk) => `[Chunk ${chunk.order}] ${chunk.text}`).join('\n\n');
	const coverage =
		allChunks.length === 0
			? 0
			: clamp(Math.round((ragChunks.length / allChunks.length) * 100), 1, 100);

	return {
		text: ragText,
		chunks: ragChunks,
		positionBins: buildPositionBins(ragChunks),
		citations: mapDefaultCitations(ragChunks),
		contextChars: ragText.length,
		contextChunks: ragChunks.length,
		coverage
	};
}

export function injectNoise(context: PreparedContext, enabled: boolean): PreparedContext {
	if (!enabled) {
		return context;
	}

	const noise =
		'\n\n[NOISE BLOCK] Random catalog entries: mango prices, weather snippets, unrelated recipe steps, train schedule fragments, and arbitrary numeric tables not connected to the question.';

	const noisyText = `${context.text}${noise.repeat(4)}`;

	return {
		...context,
		text: noisyText,
		contextChars: noisyText.length
	};
}

export async function listExperimentModels() {
	const models = await listGroqModels();
	return models;
}

export async function runPipeline(args: RunPipelineArgs): Promise<PipelineRun> {
	const startedAt = Date.now();
	const windowCharBudget = maxContextCharsForModel(args.modelContextWindow);
	const tpmCharBudget = modelPromptTokenCap(args.modelId) * CHARS_PER_TOKEN;
	const charBudget = Math.min(windowCharBudget, tpmCharBudget);
	const sizedContext = shortenContextText(args.context, charBudget);
	const completionTokens = Math.max(
		300,
		Math.min(900, Math.floor((args.modelContextWindow ?? 4000) * 0.18))
	);

	const output = await groqJson<LlmOutput>(
		[
			{
				role: 'system',
				content:
					'You are a strict reliability evaluator. Return JSON: answer (string), confidence (0-100), sentences (array of {text,grounded,score,reason}), hallucinations (array of {claim,reason}), citations (array of {chunkOrder,text}). Grounded=false means unsupported by context. Use short factual language.'
			},
			{
				role: 'user',
				content: `Pipeline: ${args.pipeline}\nQuestion: ${args.query}\n\nContext:\n${sizedContext.text || '[no context provided]'}`
			}
		],
		args.pipeline === 'rag' ? 0.1 : 0.2,
		args.modelId,
		{
			model: args.modelId,
			maxCompletionTokens: completionTokens
		}
	);

	const answer = output.answer?.trim() || 'No answer generated.';
	const sentences = normalizeSentences(output.sentences);
	const resolvedSentences = sentences.length > 0 ? sentences : fallbackSentences(answer);
	const hallucinations = normalizeClaims(output.hallucinations);
	const citations =
		normalizeCitations(output.citations).length > 0
			? normalizeCitations(output.citations)
			: args.context.citations;

	return {
		pipeline: args.pipeline,
		modelFamily: args.modelFamily,
		modelName: args.modelId,
		provider: 'Groq',
		answer,
		confidence: clampConfidence(output.confidence),
		hallucinationCount: hallucinations.length,
		hallucinations,
		sentences: resolvedSentences,
		citations,
		positionBins: sizedContext.positionBins,
		contextChars: sizedContext.contextChars,
		contextChunks: sizedContext.contextChunks,
		contextCoverage: sizedContext.coverage,
		noiseInjected: args.noiseInjected,
		latencyMs: Date.now() - startedAt
	};
}
