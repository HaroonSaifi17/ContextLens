import { json, type RequestHandler } from '@sveltejs/kit';
import { convexClient, convexFunctions } from '$lib/server/convex';

interface RunRecord {
	pipeline: 'no_context' | 'full_context' | 'rag' | 'baseline';
	modelFamily?: string;
	modelName?: string;
	answer: string;
	confidence: number;
	hallucinationCount: number;
	hallucinations: Array<{ claim: string; reason: string }>;
	sentences?: Array<{ text: string; grounded: boolean; score: number; reason: string }>;
	citations: Array<{ chunkOrder: number; text: string }>;
	positionBins?: Array<{ bin: number; rangeLabel: string; hits: number }>;
	contextChars?: number;
	contextChunks?: number;
	contextCoverage?: number;
	noiseInjected?: boolean;
	latencyMs: number;
	createdAt: number;
	query: string;
}

export const GET: RequestHandler = async ({ params }) => {
	try {
		const sessionId = params.sessionId;
		if (!sessionId) {
			return json({ error: 'sessionId is required.' }, { status: 400 });
		}

		const client = convexClient();
		const runs = (await client.query(convexFunctions.getRuns, {
			sessionId: sessionId as never
		})) as RunRecord[];

		return json({
			runs: runs.map((run) => ({
				pipeline: run.pipeline,
				modelFamily: run.modelFamily ?? 'legacy',
				modelName: run.modelName ?? 'llama-3.1-8b-instant',
				provider: 'Groq',
				answer: run.answer,
				confidence: run.confidence,
				hallucinationCount: run.hallucinationCount,
				hallucinations: run.hallucinations,
				sentences: run.sentences ?? [],
				citations: run.citations,
				positionBins: run.positionBins ?? [],
				contextChars: run.contextChars ?? 0,
				contextChunks: run.contextChunks ?? 0,
				contextCoverage: run.contextCoverage ?? 0,
				noiseInjected: run.noiseInjected ?? false,
				latencyMs: run.latencyMs,
				createdAt: run.createdAt,
				query: run.query
			}))
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to load runs.';
		return json({ error: message }, { status: 500 });
	}
};
