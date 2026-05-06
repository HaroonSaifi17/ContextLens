import { groqJson, listGroqModels, type GroqModelInfo } from '$lib/server/groq';
import { COPILOT_REFERENCE_MODEL, hasOpenAiCompatibleKey, openAiJson } from '$lib/server/openai';
import { runTrustEfficiency } from '$lib/metrics';
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

interface QueryGenOutput {
	queries?: Array<{ query: string; targetPosition?: 'beginning' | 'middle' | 'end' | 'global' }>;
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
	provider?: GroqModelInfo['provider'];
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

function sliceDocumentBand(text: string, startRatio: number, endRatio: number) {
	const start = Math.floor(text.length * startRatio);
	const end = Math.floor(text.length * endRatio);
	return text.slice(start, end).replace(/\s+/g, ' ').trim().slice(0, 2500);
}

function fallbackResearchQueries(fullText: string) {
	const beginning = sliceDocumentBand(fullText, 0, 0.18);
	const middle = sliceDocumentBand(fullText, 0.42, 0.58);
	const end = sliceDocumentBand(fullText, 0.82, 1);
	const probes = [
		['beginning', beginning],
		['middle', middle],
		['end', end]
	] as const;

	return probes
		.flatMap(([position, excerpt]) => {
			const sentence = excerpt.split(/(?<=[.!?])\s+/).find((item) => item.length > 80) ?? excerpt;
			return [
				`What specific claim or event is described in the ${position} section around: "${sentence.slice(0, 140)}"?`,
				`Which evidence from the ${position} section best supports its central point?`
			];
		})
		.slice(0, 6);
}

export async function generateResearchQueries(fullText: string, count = 8) {
	const boundedCount = clamp(Math.round(count), 5, 10);
	const promptContext = [
		`[BEGINNING]\n${sliceDocumentBand(fullText, 0, 0.18)}`,
		`[MIDDLE]\n${sliceDocumentBand(fullText, 0.42, 0.58)}`,
		`[END]\n${sliceDocumentBand(fullText, 0.82, 1)}`
	].join('\n\n');

	try {
		const output = await groqJson<QueryGenOutput>(
			[
				{
					role: 'system',
					content:
						'Return JSON only: { "queries": [{ "query": string, "targetPosition": "beginning"|"middle"|"end"|"global" }] }. Generate high-quality benchmark questions that require document-specific evidence and cover beginning, middle, and end positions.'
				},
				{
					role: 'user',
					content: `Generate ${boundedCount} research benchmark queries for this document sample:\n\n${promptContext}`
				}
			],
			0.3,
			'openai/gpt-oss-120b',
			{ maxCompletionTokens: 700 }
		);
		const queries = (output.queries ?? [])
			.map((item) => item.query?.trim())
			.filter(Boolean)
			.slice(0, boundedCount);
		return queries.length >= 5 ? queries : fallbackResearchQueries(fullText).slice(0, boundedCount);
	} catch {
		return fallbackResearchQueries(fullText).slice(0, boundedCount);
	}
}

export async function listExperimentModels() {
	const models = await listGroqModels();
	return [
		...models,
		...(hasOpenAiCompatibleKey()
			? [
					{
						id: COPILOT_REFERENCE_MODEL,
						family: 'copilot-free-gpt-4o-mini',
						contextWindow: 128000,
						provider: 'OpenAI-Compatible' as const
					}
				]
			: [])
	];
}

function selectJsonProvider(provider?: GroqModelInfo['provider']) {
	return provider === 'OpenAI-Compatible' ? openAiJson : groqJson;
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

	const providerJson = selectJsonProvider(args.provider);
	const output = await providerJson<LlmOutput>(
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

	const baseRun = {
		pipeline: args.pipeline,
		modelFamily: args.modelFamily,
		modelName: args.modelId,
		provider: args.provider ?? 'Groq',
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

	return {
		...baseRun,
		trustEfficiency: Number(runTrustEfficiency(baseRun).toFixed(4))
	};
}
