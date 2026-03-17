import { json, type RequestHandler } from '@sveltejs/kit';
import { convexClient, convexFunctions } from '$lib/server/convex';

interface RunRecord {
	_id: string;
	sessionId: string;
	query: string;
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
}

interface SessionRecord {
	_id: string;
	filename: string;
	previewText: string;
	createdAt: number;
}

export const GET: RequestHandler = async () => {
	try {
		const client = convexClient();
		const [runs, sessions] = await Promise.all([
			client.query(convexFunctions.getAllRuns, {}),
			client.query(convexFunctions.listSessions, {})
		]);

		const sessionMap = new Map<string, SessionRecord>();
		for (const session of sessions as SessionRecord[]) {
			sessionMap.set(String(session._id), session);
		}

		return json({
			runs: (runs as RunRecord[]).map((run) => ({
				sessionId: String(run.sessionId),
				sessionName: sessionMap.get(String(run.sessionId))?.filename ?? 'Unknown session',
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
